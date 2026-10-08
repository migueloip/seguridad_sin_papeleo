# AGENTS.md - Seguridad Sin Papeleo

## Dev Commands
- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run lint` - Run ESLint
- `npm run typecheck` - `tsc --noEmit -p .` (lo mismo que verifica `npm run build`)
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
# Opcional: origen público http(s) para los enlaces de invitación a una obra
# (si falta: URL de Netlify y luego los headers host/x-forwarded-* de la petición)
APP_URL=
# Opcional: correos (separados por coma) con rol admin global. Solo los obtiene
# la cuenta que se registra con ese correo o ya lo tiene: updateProfile no deja
# ponérselo después (lib/admin-emails.ts). Los correos no se verifican.
ADMIN_EMAILS=
```

## Testing
- Uses **vitest** (not jest)
- Test files: `*.test.ts`, `*.test.tsx`
- Run single test: `npx vitest run lib/utils.test.ts`
- `lib/ai.test.ts` llama de verdad a `generateText` con los 4 proveedores
  (Google, OpenAI, Anthropic, compatible OpenAI) contra un servidor HTTP local:
  si falla tras actualizar dependencias de IA, revisa sus versiones (abajo).

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
- AI: `ai` 5 + proveedores de **su misma línea** (ai-v5): `@ai-sdk/google` 2.x,
  `@ai-sdk/openai` 2.x, `@ai-sdk/anthropic` 2.x, `@ai-sdk/openai-compatible`
  1.x y `@ai-sdk/react` 2.x. Las versiones mayores siguientes son para `ai` 6
  (modelos con especificación "v3"): con `ai` 5 fallan en tiempo de ejecución
  con "Unsupported model version". No subirlas por separado.

## Build & Deploy
- `npm run build` produces `.next` directory
- El build **verifica tipos** (`typescript.ignoreBuildErrors: false` en
  `next.config.ts`) sobre todo el `include` de `tsconfig.json`, tests incluidos:
  cualquier error de `npm run typecheck` rompe el build.
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
- Tipos: la extensión de tipos de `postgres` vive en `types/postgres.d.ts` (ya
  no existe `lib/db.d.ts`). Sin parámetro de tipo una consulta devuelve
  `readonly unknown[]`: tipar siempre con `sql<Fila[]>`. Para leer `.count`
  usar `sql<RowList<Row[]>>` (`import type { Row, RowList } from "postgres"`);
  para `sql.json(x)` con un `interface`, castear a
  `Parameters<typeof sql.json>[0]` o declarar el tipo con `type`.
- Tables: projects, workers, documents, findings, plans, reports, etc.

## Deploy
- `netlify.toml` configura el build para Netlify. Si despliegas en Vercel o
  similar, ajustar variables `NEXT_PUBLIC_*` según el provider de Vercel.
- El script `scripts/patch-pascal.mjs` corre como `postinstall` y parchea
  `@pascal-app/viewer` para (a) inicializar WebGPU antes del primer render y
  (b) servir assets de `/items/*` desde el origen local en vez de la CDN
  oficial `editor.pascal.app`.
- Hoy ningún archivo importa `@pascal-app/*` (solo aparecen en
  `transpilePackages` y en el `postinstall`). `@pascal-app/editor` publica
  `.tsx` sin compilar: importarlo mete ~88 errores de tipos del propio paquete
  y rompe el build.

## Codebase Structure
- Components: `components/` + `components/ui/` (shadcn)
- Server Actions: `app/actions/` — cada export de un archivo `"use server"` es
  un endpoint público invocable sin pasar por la UI. Nunca exportar desde ahí
  algo que devuelva secretos: la configuración sensible (API key de IA, clave
  SMTP) se lee en servidor con `readSetting`/`getAiSettings` de
  `lib/settings.ts`; las acciones de `app/actions/settings.ts` la enmascaran.
  `updateSetting`/`updateSettings` solo escriben las claves de la lista blanca
  `WRITABLE_SETTING_KEYS` (en ese archivo): `updateSettings` ignora las demás y
  `updateSetting` lanza error. Una clave de configuración nueva hay que sumarla
  ahí.
- Retorno tras login: `/auth/login?next=…` y `/auth/register?next=…` solo
  aceptan rutas relativas seguras (`safeNextPath` de `lib/safe-redirect.ts`;
  rechaza `//host`, `/\host`, esquemas y rutas que se normalizan a otro host).
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
  `client-files.ts` (imagen/PDF → data URL o archivo para subida directa, y
  PUT a la URL firmada con progreso, en el navegador), `heatmap.ts` (mapa de
  calor de hallazgos) y `scene3d.ts` (escena de la vista 3D).
- Solo servidor: `lib/obra/access.ts` (sesión → acceso, errores, auditoría),
  `lib/obra/schema.ts` (DDL 006) y `lib/obra/server/*.ts` (lógica sin
  `"use server"`; cada función recibe `actorUserId` explícito y se reutiliza
  desde acciones, API móvil y tests).
- `app/actions/obra/*.ts`: acciones `"use server"` finas
  (`requireSessionUserId` → `lib/obra/server/*` → `revalidatePath` →
  `ActionResult<T>` con `toActionError`). Cada export es un endpoint público:
  solo funciones async.
- Rutas: `app/obra/**` (páginas), `components/obra/**` (UI),
  `app/api/obra/layers/[id]/image` (imagen de capa: 302 a una URL firmada de
  2 min, redirección cacheada 60 s, si está en el bucket; bytes si es inline) y
  `app/api/obra/findings/[id]/photo?index=N` (foto de hallazgo), ambas con
  control de acceso de obra; `app/api/mobile/obra/**` (tareas con Bearer).
- Rutas del bucket (`obra/<p>/…`): NO son secretas (viajan en las URL
  firmadas) y no dan acceso por sí solas. Las referencias `obra-storage:` de
  `findings.photos` solo las crea el servidor: `createFinding` y
  `/api/mobile/sync` descartan las que manda el cliente
  (`dropClientObraStorageRefs`; al editar se conservan las que el hallazgo ya
  tenía), y `/api/findings/photo` / `readFindingPhoto` solo sirven
  `obra/<p>/hallazgos/<24 hex>.<ext>` del MISMO proyecto del hallazgo (y, en la
  ruta heredada, de un proyecto del usuario) (`findingPhotoRefProjectId`).
- El asistente IA genérico (`/api/assistant`, cajón del header) no se ofrece
  dentro de `/obra/<id>`: lee datos por `user_id` de quien pregunta y no
  conoce la obra (`components/dashboard-layout.tsx`).
- `app/invitacion/[token]` (+ `components/obra/invitation-accept.tsx`): página
  **pública** (`middleware.ts`, también para sus server actions) donde la
  persona invitada acepta con su sesión o creando su cuenta. Envía
  `referrer: no-referrer` y `robots: noindex`; login y registro usan
  `referrer: same-origin` porque su URL puede llevar `?next=/invitacion/<token>`.
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
  resto del equipo entra por `obra_members`, **solo aceptando una invitación**
  (`lib/obra/server/invitations.ts`; ya no existe el alta directa con clave
  temporal):
  - Crear/regenerar/revocar/listar exige `members.manage` + `canAssignRole`
    (un jefe de obra no invita gerentes). La respuesta es idéntica tenga o no
    cuenta ese correo (no revela cuentas). Una invitación abierta por correo y obra.
  - Token: 32 bytes aleatorios en base64url; en la BD solo su SHA-256. El
    enlace `/invitacion/<token>` se muestra una sola vez, vence a los
    `INVITATION_TTL_DAYS` (7) días y regenerarlo invalida el anterior. Nunca
    guardar ni auditar el token.
  - Aceptar: con sesión cuyo correo coincide (`acceptInvitationAsUser`) o
    creando la cuenta con su propia contraseña (`acceptInvitationWithNewAccount`,
    rol `'user'`, abre sesión). Bloquea la fila (`FOR UPDATE`): un solo
    resultado por invitación. El estado (pendiente/aceptada/revocada/vencida)
    se calcula en SQL contra la hora de la BD.
  - El enlace es un **token al portador**: los correos no se verifican. Si el
    correo invitado ya tiene cuenta, solo esa cuenta acepta (y `updateProfile`
    no deja ponerse un correo con invitación pendiente:
    `hasOpenInvitationForEmail`); si no la tiene, quien tenga el enlace crea la
    cuenta de ese correo. Compartirlo solo con la persona; revocarlo si se filtra.
  - La invitación vale mientras quien la envió pueda otorgar ese rol:
    `removeMember` revoca sus invitaciones abiertas y `updateMemberRole` las que
    el rol nuevo ya no puede otorgar (`revokeInvitationsSentBy`, audit
    `invitation.revoked` con `reason`); al aceptar se revalida con la fila
    bloqueada (`inviterStillAllowed`: dueño o integrante con
    `canAssignRole(rol, rol invitado)`) y, si no, se anula (actor null,
    `reason: "inviter_lost_permission"`) y no entra nadie.
  - La vista previa pública (`getInvitationPreview`) solo trae datos (obra,
    correo, nombre, quién invita) si está pendiente; si no, `{ status }`.
  - La URL del enlace: `APP_URL`, luego `URL` (Netlify), luego los headers de
    la petición; solo http(s). La calcula la acción y la pasa como `baseUrl`.
- Quitar un miembro (`removeMember`) deja sus tareas abiertas sin persona
  (`assigned_user_id = NULL`) y visibles para su rol (`assigned_role` se
  conserva o toma el rol del miembro); las hechas/canceladas conservan a la
  persona (historial) y reciben su rol si no tenían. El audit `member.removed`
  lleva `unassigned_tasks`, `unassigned_task_ids` (máx. 100) y, si hubo,
  `revoked_invitations`. Reabrir una tarea (`setTaskStatus` a pendiente / en
  progreso) cuya persona ya no es del equipo la deja sin persona (audit
  `unassigned_user_id`).
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
- Origen de la tarea al aprobar: `'ia'` si la sugerencia la generó la IA,
  `'reglas'` si la generó el motor de reglas (aunque el revisor la edite). La
  tarjeta muestra "Sugerida por IA · aprobada por X" o "Sugerencia automática
  (reglas) · aprobada por X". La 006 corrige tareas antiguas de reglas que
  quedaron con `'ia'`.
- Los contadores de sugerencias pendientes (hub, `GET /api/mobile/obra/tasks`,
  `getDashboard`) son 0 para roles sin `ai.review`; el índice de riesgo usa el
  conteo real (igual para todos los roles).
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
- `analyzeFindingAsSystem(projectId, findingId, { via })` (`lib/obra/server/pins.ts`)
  corre el análisis por reglas a nombre del dueño, sin sesión, para scripts
  (lo usa el seed). No es una acción; no exponerla.
- La IA usa la configuración de IA del dueño del proyecto (`/configuracion`),
  con límite de uso por persona/hora y obra/día (`assertAiQuota`). Una URL base
  de IA propia solo se combina con la key propia (`lib/ai-settings.ts`).

### Mapa de calor y vista 3D (`/obra/<id>/planos`)
- Mapa de calor (`lib/obra/heatmap.ts`): núcleo gaussiano en metros del nivel
  (σ = 1,25 m), peso por gravedad (crítica 8, alta 4, media 2, baja 1;
  resueltos/cerrados ×0,25 con el filtro «Todos»); escala absoluta hasta que una
  zona supera a un hallazgo crítico. Filtros: estado, período (días de Chile,
  hoy incluido) y categoría. Solo se ofrece con `findings.view` (quien solo ve
  sus propios reportes no lo tiene). En 2D es un `<image>` en el SVG del plano
  (`heatOverlay` de `plan-canvas.tsx`); en 3D, una textura sobre el piso de
  cada nivel con escala común. `?calor=1` lo enciende. La grilla cubre solo la
  zona con hallazgos (celda 0,25 m; si crece, el radio crece con ella). El
  período usa `FindingPin.reported_at` (fecha del reporte), no la del pin.
  Cuenta los pines que trae `listPins` (`LIMIT 2000`, los más recientes).
- Vista 3D (`components/obra/plan-3d.tsx`, cargada con `next/dynamic` sin SSR;
  `?vista=3d`): levanta solo elementos vectoriales (DXF o dibujados) con
  `buildScene3D` (puro, probado): X = x, Z = y del plano, Y = altura; niveles
  cada `LEVEL_HEIGHT_M` (2,8 m). Alturas convencionales por tipo (muros 2,5 m,
  alcantarillado −0,6 m, agua/electricidad por el cielo, gas 0,3 m);
  `attributes.depth_m` manda; el Ø sale del atributo o de la etiqueta ("Ø110").
  Grupos «Capas 3D» (muros, estructura y cada red; «Solo muros»), rayos X,
  todos los niveles, planta/perspectiva. Respeta capas y disciplinas ocultas
  del panel. Reportar y dibujar siguen siendo en 2D (cambiar de modo vuelve al
  2D). Sin WebGL muestra un aviso. Al cambiar `transparent` de un material de
  three.js hay que recrearlo (`key`), no basta con el prop. Con rayos X lo
  translúcido no atrapa clics (pasan a los tubos de atrás). Un tubo cuenta 2
  piezas por tramo en el tope `MAX_PRIMITIVES`.

### Planos y Supabase Storage
- Bucket privado `obra-planos` (`lib/obra/server/storage.ts`): se crea o se
  corrige (privado, `file_size_limit`, `allowed_mime_types`) una vez por
  proceso; si es público y no se puede corregir, no se usa.
- Lámina que cabe inline (data URL ≤ 4,5 M caracteres ≈ 3,2 MB): va en la
  acción `createObraLayer({ image })`. Si no cabe, **subida directa**:
  `createObraLayerUploadTicket(projectId, { mime, size_bytes })` (`plans.manage`;
  cuota `LAYER_UPLOAD_QUOTA`: 30 por persona y hora, 150 por obra y día;
  registra el permiso en `obra_layer_uploads` y devuelve URL firmada de 2 h para
  `obra/<proyecto>/uploads/<uuid>.<ext>`) → PUT del navegador al Storage
  (`x-upsert: false`, cancelable) → `createObraLayer({ image_upload: { path,
  width_px, height_px, analysis_data_url? } })`, que exige un permiso PROPIO sin
  usar para esa ruta, verifica existencia, tamaño, tipo y magic bytes (borra el
  objeto si es inválido) y que ninguna capa use ya esa ruta (lock `7262008`
  dentro de la transacción). Si la capa no se crea por un `ObraValidationError`
  (p.ej. proporción > 100), el objeto se borra y el permiso queda descartado.
  Los objetos de permisos vencidos hace > 1 h sin capa los borra
  `sweepAbandonedLayerUploads` (de a 20, al pedir cada permiso). Límites: 25 MB
  (`PLAN_UPLOAD_MAX_BYTES`, duplicado en `client-files.ts` con un test que
  exige que coincidan) y 6000 px por lado. Sin Supabase (`directUpload` false
  desde la página de planos) el diálogo reduce la lámina a inline al elegirla.
- IA de visión (`requestLayerExtraction`): nunca se envía más de
  `AI_IMAGE_MAX_BYTES` (≈ 3,7 MB). Las láminas subidas directo guardan una copia
  reducida (`analysis_data_url` → `obra_plan_layers.analysis_image_path`, la
  prepara el diálogo); sin copia y sobre el límite, mensaje claro antes de
  llamar al proveedor (`readStoredImageForAnalysis`).
- El contenido solo se valida por cabecera (magic bytes y dimensiones), no se
  decodifica entero: un PNG con datos extra detrás se acepta. Se sirve con su
  tipo de imagen (nosniff/sandbox en nuestras rutas).
- El token firmado no es de un solo uso: lo que impide reutilizarlo es que la
  ruta ya exista. Supabase autoalojado debe permitir CORS para PUT con
  `content-type` y `x-upsert`.
- `tests/obra/fake-supabase-storage.ts` (`startFakeStorage`) imita el contrato
  real de storage-api (errores HTTP 400 con `statusCode` en el cuerpo, firma
  JWT, Range, límites del bucket); reutilizarlo en tests nuevos.

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
- Si el hallazgo aún no tiene sugerencias, corre el análisis por reglas
  (`analyzeFindingAsSystem`, `via: "seed"`, empaquetado con esbuild) y deja
  sugerencias `create_task` pendientes para la bandeja de aprobaciones. Si eso
  falla, igual termina con código 0 y explica cómo generarlas desde la UI.

