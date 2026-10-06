# AGENTS.md - Seguridad Sin Papeleo

## Dev Commands
- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run lint` - Run ESLint
- `npm run test` - Run vitest (not jest)
- `npm run test:obra:int` - Tests de integración del módulo Obra contra Postgres real
  (usa `TEST_DATABASE_ADMIN_URL`; por defecto `postgres://postgres:postgres@localhost:5432/postgres`)
- `npm run seed:obra-demo -- --owner-email <correo>` - Obra demo "Edificio Demo Los Aromos"

## Required Environment Variables
```
DATABASE_URL=
DIRECT_URL=
ADMIN_PASSWORD=
CONFIG_ENCRYPTION_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
# Opcional (módulo Obra): "0" desactiva la migración 006 automática al primer uso
OBRA_AUTO_MIGRATE=
```

## Testing
- Uses **vitest** (not jest)
- Test files: `*.test.ts`, `*.test.tsx`
- Run single test: `npx vitest run lib/utils.test.ts`

## Dependencies
- Next.js 16 + React 19
- Supabase (PostgreSQL)
- Tailwind CSS 4
- shadcn/ui (Radix UI primitives)
- Server Actions (`app/actions/*`)
- PDF parsing: pdfjs-dist
- OCR: tesseract.js
- 3D: react-three/fiber, three.js
- 2D canvas: konva
- AI: @ai-sdk/google

## Build & Deploy
- `npm run build` produces `.next` directory
- Deployed on Netlify (see `netlify.toml`)
- Ignore generated 3D files: `public/architect3d/**`

## Database
- SQL migrations in `scripts/*.sql` (001-006). La 006 (Obra Integral) es un
  espejo generado de `lib/obra/schema.ts` (ver sección "Módulo Obra Integral").
- Provider: **Supabase** (Postgres) — el `lib/db.ts` detecta hostnames de
  Supabase pooler / db.*.supabase.co y aplica `sslmode=require` y puerto 6543
  automáticamente.
- También compatible con **Neon** — el wrapper `withRetry` en
  `app/actions/auth.ts` maneja los errores típicos de Neon (`P1017`,
  "Tenant or user not found") con reintentos. Si migras solo a Supabase, ese
  retry sigue siendo útil para reconexiones del pooler.
- Driver: `postgres` v3 (no Prisma, no Drizzle). Las queries usan template
  literals con parametrización: `sql\`SELECT ... WHERE x = ${value}\``. Nunca
  concatenar strings.
- Tables: projects, workers, documents, findings, plans, reports, etc.

## Deploy
- `netlify.toml` configura el build para Netlify. Si despliegas en Vercel o
  similar, ajustar variables `NEXT_PUBLIC_*` según el provider de Vercel.
- El script `scripts/patch-pascal.mjs` corre como `postinstall` y parchea
  `@pascal-app/viewer` para (a) inicializar WebGPU antes del primer render y
  (b) servir assets de `/items/*` desde el origen local en vez de la CDN
  oficial `editor.pascal.app`.

## Codebase Structure
- Components: `components/` + `components/ui/` (shadcn)
- Server Actions: `app/actions/` — cada export de un archivo `"use server"` es
  un endpoint público invocable sin pasar por la UI. Nunca exportar desde ahí
  algo que devuelva secretos: la configuración sensible (API key de IA, clave
  SMTP) se lee en servidor con `readSetting`/`getAiSettings` de
  `lib/settings.ts`; las acciones de `app/actions/settings.ts` la enmascaran.
- Core logic: `src/`
- Database: `lib/db.ts`
- Auth: `lib/auth.ts`, `lib/mobile-auth.ts`

## Módulo Obra Integral (`/obra`)
Plan y contratos completos: `docs/PLAN-OBRA-INTEGRAL.md`. Resumen para agentes:

### Estructura
- `lib/obra/*.ts` (puros, usables en cliente salvo `access.ts` y `schema.ts`):
  `types.ts` (catálogos y DTOs, el contrato compartido), `permissions.ts`
  (matriz rol→permiso, `can`), `geometry.ts` (marcos de capa y distancias),
  `rules.ts` + `correlation.ts` (motor determinista hallazgo→elementos
  cercanos), `classify.ts`, `metrics.ts`, `suggestions.ts` (esquemas zod de
  payloads y transiciones), `dxf.ts` (importación DXF ASCII),
  `client-files.ts` (imagen/PDF → data URL en el navegador).
- Solo servidor: `lib/obra/access.ts` (sesión → acceso, errores, auditoría),
  `lib/obra/schema.ts` (DDL 006) y `lib/obra/server/*.ts` (lógica sin
  `"use server"`; cada función recibe `actorUserId` explícito y se reutiliza
  desde acciones, API móvil y tests).
- `app/actions/obra/*.ts`: acciones `"use server"` finas
  (`requireSessionUserId` → `lib/obra/server/*` → `revalidatePath` →
  `ActionResult<T>` con `toActionError`). Cada export es un endpoint público:
  solo funciones async.
- Rutas: `app/obra/**` (páginas), `components/obra/**` (UI),
  `app/api/obra/layers/[id]/image` (imagen de capa) y
  `app/api/obra/findings/[id]/photo?index=N` (foto de hallazgo), ambas con
  control de acceso de obra; `app/api/mobile/obra/**` (tareas con Bearer).
- Componentes cliente: nunca importar `lib/obra/server/*`, `lib/obra/access.ts`,
  `lib/db` ni `lib/auth` (rompe el build).

### Reglas de autorización
- Toda función de servidor autoriza con
  `requireProjectPermissionForUser(actorUserId, projectId, permiso)`.
- Si recibe el id de una entidad (tarea, sugerencia, capa, elemento, hallazgo,
  revisión), primero lee su `project_id` en la BD y autoriza contra ESE
  proyecto; si no existe o no hay acceso → `ObraAccessError(404)` (no revelar
  que existe). Toda referencia cruzada (`finding_id`, `layer_id`,
  `inspection_id`, `assigned_user_id`...) debe pertenecer al mismo proyecto.
- Tenant = dueño del proyecto (`projects.user_id`): es gerente implícito y los
  registros en tablas heredadas (`findings`) se guardan con su `user_id`. El
  resto del equipo entra por `obra_members`.
- Errores: `ObraValidationError` (mensaje mostrable en español) y
  `ObraAccessError` (401/403/404). Nunca devolver mensajes internos de la BD.
- La UI oculta acciones con `can(role, permiso)`, pero la autorización real es
  siempre la del servidor.

### Humano en el circuito (HITL)
- La IA nunca escribe en tareas, hallazgos ni planos: crea filas en
  `obra_ai_suggestions` (`pending`). Sin IA configurada, el motor de reglas
  genera las mismas sugerencias (`generator = 'reglas'`).
- Aplicar una sugerencia exige `ai.review` (y `ai.review_critical` si es
  crítica), se hace en una transacción con `SELECT … FOR UPDATE` y queda
  auditada. La BD lo refuerza: CHECK `obra_suggestion_reviewed_by_human` y
  `obra_tasks.suggestion_id UNIQUE`.
- "Anotar en tareas de la próxima revisión" crea la tarea en la próxima
  revisión abierta, con el criterio único `pickNextInspection`
  (`lib/obra/metrics.ts`, espejo SQL `nextInspectionOrder`): en curso → programada
  desde hoy → programada atrasada. Si no hay, una "Revisión semanal" a 7 días; si
  la tarea vence antes que la próxima programada, una "Revisión prioritaria" para
  su vencimiento. Cerrar una revisión toma el mismo advisory lock (`7262007`).
- Re-analizar un hallazgo (`analyzeFinding`) exige `ai.request` aunque sea sin
  IA (reemplaza pendientes). No repite correlaciones con tarea abierta, no crea
  tareas desde la regla de contexto y un análisis por reglas no reemplaza las
  pendientes redactadas por IA.
- "Hoy" es el día de Chile (`todayISO`, America/Santiago), no el del proceso.
- La IA usa la configuración de IA del dueño del proyecto (`/configuracion`),
  con límite de uso por persona/hora y obra/día (`assertAiQuota`). Una URL base
  de IA propia solo se combina con la key propia (`lib/ai-settings.ts`).

### Migración 006
- Automática: `ensureObraSchema()` la aplica una vez por proceso al primer uso
  del módulo, con advisory lock (`7262006`). `OBRA_AUTO_MIGRATE=0` la desactiva.
- Manual: `POST /api/admin/migrate?scope=obra` (sesión de admin) o
  `psql -f scripts/006-obra-integral.sql`. El seed demo también la aplica si falta.
- `scripts/006-obra-integral.sql` se GENERA desde `lib/obra/schema.ts`
  (no editar a mano): `UPDATE_OBRA_SQL=1 npx vitest run lib/obra/schema.test.ts`.

### Tests
- Unitarios puros: `npx vitest run lib/obra`.
- Integración con Postgres real (`tests/obra/*.int.test.ts`, se saltan sin la
  variable). Cada archivo crea su propia BD `ssp_test_<nombre>` desde
  `tests/obra/baseline.sql` + 006 (ver `tests/obra/helpers.ts`), así que corren
  en paralelo:
  ```bash
  TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run tests/obra
  # o: npm run test:obra:int
  ```
  Usar `// @vitest-environment node`, `vi.mock("@/lib/auth", ...)` con
  `authMock` + `actAs(userId)` y un nombre de BD único por archivo.

### Datos demo
- `DATABASE_URL=... npm run seed:obra-demo -- --owner-email <correo>` crea
  (idempotente, sin borrar nada) la obra "Edificio Demo Los Aromos" para ese
  usuario (debe existir), con miembros demo `*.demo@losaromos.test` (clave
  aleatoria por cuenta que se muestra solo al crearlas; `--reset-passwords`
  genera otras), capas del nivel 1 con elementos, un hallazgo junto al colector,
  una revisión y tareas. Se niega a correr contra una BD no local o con
  `NODE_ENV=production` salvo con `--allow-remote`.

