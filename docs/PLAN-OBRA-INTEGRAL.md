# Plan — Obra Integral

> De herramienta del prevencionista a plataforma para toda la obra: del gerente
> a cada trabajador, con planos por especialidad que la IA cruza con los
> hallazgos, y con **toda decisión de IA sujeta a aprobación humana**.

## 1. Visión

Hoy Easysecure ayuda a un prevencionista a gestionar documentos, hallazgos,
checklists e informes. La meta es cubrir **cada parte de la obra**:

- **Cada persona** tiene una vista y permisos acordes a su rol (gerente, jefe de
  obra, prevencionista, supervisor/capataz, trabajador, visita/ITO).
- **Cada especialidad** tiene su plano como capa: arquitectura (muros),
  estructura, alcantarillado, agua potable, aguas lluvia, eléctrico, gas,
  climatización y red contra incendio, alineadas en un marco común por nivel.
- **Cada hallazgo** queda ubicado en el plano. El sistema cruza su posición con
  todas las capas y explica el contexto. Ejemplo:
  *"Grieta en el muro del eje B. A 1,2 m, en el mismo nivel, pasa el colector
  de alcantarillado Ø160 (capa Alcantarillado N1). Posible filtración que
  socava la fundación."* Debajo aparece el botón **"Anotar en tareas de la
  próxima revisión"**.
- **Cada decisión sugerida por IA** (crear una tarea, incorporar tuberías
  detectadas en un plano, subir la severidad de un hallazgo) queda *pendiente*
  hasta que una persona con el rol adecuado la aprueba, la edita o la rechaza.
  Todo queda auditado.

## 2. Principios de diseño

1. **Humano en el circuito (obligatorio).** La IA nunca escribe en tareas,
   hallazgos ni planos. Escribe *sugerencias* (`obra_ai_suggestions`). Aplicar
   una sugerencia exige un humano con permiso `ai.review`, y además
   `ai.review_critical` si la severidad es crítica. La BD lo refuerza con un
   CHECK: no hay sugerencia aprobada o rechazada sin `reviewed_at`. Se aplica en
   una transacción con `SELECT … FOR UPDATE` (sin dobles aprobaciones) y
   `obra_tasks.suggestion_id UNIQUE` (sin tareas duplicadas).
2. **La geometría prueba, la IA explica.** La relación "grieta ↔ alcantarillado
   a 1,2 m" la calcula un motor geométrico determinista
   (`lib/obra/correlation.ts`) sobre elementos confirmados por humanos. El LLM
   solo redacta y prioriza sobre esas correlaciones verificables; no puede
   inventar tuberías. Sin IA configurada, el motor de reglas genera igualmente
   las sugerencias (`generator = 'reglas'`).
3. **Tenant = dueño del proyecto.** Para no romper los módulos existentes
   (filtrados por `user_id`), el dueño del proyecto es gerente implícito y los
   registros heredados (p.ej. `findings`) se guardan con su `user_id`. El resto
   del equipo entra por `obra_members`.
4. **Autorización por entidad, nunca por parámetro del cliente.** Toda acción
   que recibe un id (tarea, sugerencia, capa, elemento, hallazgo) resuelve el
   `project_id` desde la BD y autoriza contra ese proyecto. Sin acceso se
   responde "no encontrado" para no revelar que existe.
5. **Lógica en `lib/obra/server/*`, acciones finas.** Los archivos con
   `"use server"` solo exportan acciones (cada export es un endpoint público).
   La lógica recibe `actorUserId` explícito y se reutiliza desde la API móvil
   (Bearer) y desde los tests.

## 3. Roles y permisos

Fuente: `lib/obra/permissions.ts`.

| Permiso | Gerente | Jefe obra | Prevencionista | Supervisor | Trabajador | Visita |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver obra, planos | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Gestionar equipo (`members.manage`) | ✓ | ✓ (no nombra gerentes) | | | | |
| Subir/alinear/editar planos (`plans.manage`) | ✓ | ✓ | ✓ | | | |
| Ver hallazgos (`findings.view`) | ✓ | ✓ | ✓ | ✓ | solo los suyos | ✓ |
| Reportar hallazgo en plano (`findings.report`) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Ver todas las tareas (`tasks.view_all`) | ✓ | ✓ | ✓ | ✓ | las suyas / de su rol | ✓ |
| Crear/editar tareas (`tasks.manage`) | ✓ | ✓ | ✓ | | | |
| Cerrar tareas | todas | todas | todas | todas | las suyas | |
| Pedir análisis IA (`ai.request`) | ✓ | ✓ | ✓ | ✓ | | |
| Aprobar sugerencias IA (`ai.review`) | ✓ | ✓ | ✓ | | | |
| Aprobar sugerencias **críticas** | ✓ | ✓ | ✓ | | | |
| Programar/cerrar revisiones | ✓ | ✓ | ✓ | | | |
| Ver auditoría | ✓ | ✓ | ✓ | | | ✓ |

## 4. Flujos principales

### 4.1 Planos por especialidad
1. Jefe de obra o prevencionista sube una capa: imagen (PNG/JPG/WebP), PDF (se
   rasteriza en el navegador con pdf.js) o **DXF** (se leen las entidades
   vectoriales; los nombres de capa CAD se mapean a tipos, p.ej.
   `ALC-COLECTOR → tuberia_alcantarillado`).
2. Indica disciplina, nivel (0 = primer piso, −1 = subterráneo) y ancho real de
   la lámina en metros. Si varias capas del mismo nivel no calzan, se alinean
   con desplazamiento y rotación (`LayerFrame`), usando una vista superpuesta
   con opacidad.
3. Los elementos (tuberías, ductos, muros...) se obtienen así:
   - **DXF:** se importan directamente tras una vista previa que confirma un
     humano.
   - **Dibujo manual:** punto, polilínea o polígono.
   - **IA de visión:** propone elementos como *sugerencia* `plan_elements`. Un
     revisor ve la superposición, desmarca lo erróneo y aprueba.

### 4.2 Hallazgo → contexto → tarea (el caso del alcantarillado)
1. Cualquier rol con `findings.report` toca el plano y reporta: título,
   descripción, severidad, categoría (se infiere del texto si no se indica) y
   foto opcional. Se crea el `finding` (tenant = dueño) y su
   `obra_finding_pin`.
2. El motor de correlación busca elementos confirmados cercanos, en el mismo
   nivel y en los adyacentes, y aplica las reglas de `lib/obra/rules.ts`
   (grieta + alcantarillado, humedad + eléctrico, olor + gas, etc.). Ya en ese
   momento genera sugerencias `create_task` con `generator='reglas'`.
3. Quien tenga `ai.request` puede pedir **"Analizar con IA"**: el LLM recibe las
   correlaciones (no el plano libre), redacta hipótesis y checklist y propone
   prioridad. Esto reemplaza las sugerencias pendientes anteriores
   (`superseded`).
4. En el panel del hallazgo, cada sugerencia muestra la evidencia (elemento,
   distancia, capa, relación de nivel) y tres botones:
   **Anotar en tareas de la próxima revisión** (aprueba), **Editar y aprobar**
   y **Descartar** (pide motivo).
5. Al aprobar se crea la tarea en la **próxima revisión programada**. Si no
   existe, se crea una "Revisión semanal" a 7 días. La tarea lleva vencimiento,
   rol sugerido y checklist, y queda auditada.

### 4.3 Revisiones
Las revisiones (`obra_inspections`) agrupan las tareas a verificar en terreno.
Al cerrar una se registra un resumen y, opcionalmente, las tareas abiertas pasan
a la siguiente.

### 4.4 Vistas por rol (`/obra/[id]`)
- **Gerente:** índice de riesgo, hallazgos por severidad, tareas vencidas,
  aprobaciones críticas pendientes y actividad reciente.
- **Jefe de obra / Prevencionista:** bandeja de aprobaciones, próxima revisión
  y tareas por estado.
- **Supervisor:** tareas de la obra y reportar hallazgo.
- **Trabajador:** "mis tareas" (asignadas a él o a su rol) y reportar una
  condición insegura en el plano. También disponible por API móvil.
- **Visita/ITO:** solo lectura más auditoría.

## 5. Modelo de datos (migración 006)

Fuente: `lib/obra/schema.ts`. Espejo: `scripts/006-obra-integral.sql`. Se
aplica sola al primer uso, con advisory lock (desactivable con
`OBRA_AUTO_MIGRATE=0`), o con `POST /api/admin/migrate?scope=obra`.

| Tabla | Propósito |
|---|---|
| `obra_members` | (proyecto, usuario, rol, trabajador vinculado). El dueño es implícito. |
| `obra_plan_layers` | Capa por especialidad y nivel: imagen (Storage o inline), marco métrico (`width_m`, `aspect`, `offset_*`, `rotation_deg`), opacidad. Borrado lógico. |
| `obra_plan_elements` | Elementos confirmados en coordenadas normalizadas de su capa (`geometry` JSONB), tipo, atributos (Ø, profundidad, material...), origen (manual / ia / dxf). |
| `obra_finding_pins` | Ubicación de un `finding` en una capa y nivel, con su categoría. |
| `obra_ai_suggestions` | Sugerencias pendientes, aprobadas, rechazadas o reemplazadas, con payload, evidencia, generador, modelo, revisor y entidad aplicada. |
| `obra_tasks` | Tareas (manuales, de IA o de hallazgo) con prioridad, rol o persona asignada, revisión, vencimiento, checklist, ubicación y cierre. |
| `obra_inspections` | Revisiones programadas o cerradas. |
| `obra_audit_log` | Quién hizo qué y cuándo (aprobaciones, rechazos, equipo, tareas, planos). |

Coordenadas: un punto `(x, y) ∈ [0,1]²` de una capa pasa a metros del nivel
así:

```
local = (x·width_m, y·width_m·aspect)
mundo = rotar(local, rotation_deg) + (offset_x_m, offset_y_m)
```

## 6. Arquitectura y archivos

```
lib/obra/
  types.ts          catálogos + tipos (contrato compartido, usable en cliente)
  permissions.ts    matriz rol→permiso, canReviewSuggestion, canAssignRole
  schema.ts         DDL 006 + applyObraSchema
  access.ts         sesión→acceso al proyecto, requireProjectPermission(ForUser), writeAudit, errores
  geometry.ts       marcos, distancias punto-segmento/polígono, validación de geometrías
  rules.ts          reglas de correlación (categoría × tipo de elemento)
  correlation.ts    motor determinista hallazgo→correlaciones; correlación→payload de tarea
  classify.ts       texto del hallazgo → categoría
  metrics.ts        índice de riesgo, utilidades de fecha
  suggestions.ts    esquemas zod de payloads, transiciones de estado
  dxf.ts            parser DXF mínimo + mapeo de capas CAD → tipos
  client-files.ts   (cliente) imagen/PDF → PNG data URL reducida
  server/           lógica de servidor sin "use server" (recibe actorUserId)
    members.ts tasks.ts inspections.ts dashboard.ts audit.ts
    layers.ts elements.ts pins.ts suggestions.ts ai.ts storage.ts
app/actions/obra/   acciones "use server" finas (sesión → lib/obra/server)
app/api/obra/layers/[id]/image/route.ts   imagen de capa con control de acceso
app/api/mobile/obra/...                   tareas para la app de terreno (Bearer)
app/obra/...                              páginas
components/obra/...                       UI
tests/obra/                               tests de integración con Postgres real
```

### 6.1 Contratos de `lib/obra/server/*`

Todas lanzan `ObraAccessError` (401, 403 o 404) u `ObraValidationError`
(mensaje mostrable). Las acciones `"use server"` las envuelven y devuelven
`ActionResult<T>` usando `toActionError`.

**members.ts**
- `listMyProjects(userId): ObraProjectSummary[]`
- `getAccessInfo(userId, projectId): ProjectAccess & { permissions }`
- `listMembers(userId, projectId): ObraMember[]` (`project.view`; el dueño aparece primero con `is_owner`)
- `addMember(userId, projectId, { email, name?, role, worker_id? }): { member, temporary_password | null }`
  (`members.manage` + `canAssignRole`; si el email no existe, crea el usuario con una contraseña temporal que se muestra una sola vez)
- `updateMemberRole(userId, projectId, memberUserId, role)` y `removeMember(userId, projectId, memberUserId)`
  (no se puede tocar al dueño; solo un gerente modifica a otro gerente)
- `listLinkableWorkers(userId, projectId): { id, name, rut }[]` (trabajadores del dueño)

**tasks.ts**
- `listTasks(userId, projectId, { status?, mine?, inspection_id? }): ObraTask[]`
  (sin `tasks.view_all` solo ve las asignadas a él o a su rol sin persona)
- `createTask(userId, projectId, TaskInput, tx?): ObraTask` (`tasks.manage`;
  valida que hallazgo, capa, revisión y usuario asignado pertenezcan al proyecto)
- `updateTask(userId, taskId, Partial<TaskInput>): ObraTask` (`tasks.manage`)
- `setTaskStatus(userId, taskId, status, notes?): ObraTask`
  (`tasks.manage`, `tasks.complete_any`, o `tasks.complete_own` si es suya)
- `toggleChecklistItem(userId, taskId, index, done): ObraTask` (mismos permisos que el estado)

**inspections.ts**
- `listInspections(userId, projectId): ObraInspection[]`
- `createInspection(userId, projectId, { title, scheduled_for, lead_user_id?, notes? })` (`inspections.manage`)
- `updateInspection(userId, inspectionId, patch)` y `closeInspection(userId, inspectionId, { summary, carry_over_open_tasks })`
- `getOrCreateNextInspection(tx, projectId, actorUserId): ObraInspection` (interna, se usa al aprobar)

**dashboard.ts / audit.ts**
- `getDashboard(userId, projectId): ObraDashboard`
- `listAudit(userId, projectId, { limit?, before_id? }): AuditEntry[]` (`audit.view`)

**layers.ts / elements.ts / storage.ts**
- `listLayers(userId, projectId)`, `createLayer(userId, projectId, { name, discipline, level, level_label?, image?, width_m?, aspect? })`,
  `updateLayer(userId, layerId, patch)`, `deleteLayer(userId, layerId)` (borrado lógico) y `readLayerImage(userId, layerId): { bytes, mime }`
- `listElements(userId, projectId, { level?, layer_id? })`, `createElements(userId, layerId, drafts, source)`,
  `updateElement(userId, elementId, patch)`, `deleteElement(userId, elementId)` y `requestLayerExtraction(userId, layerId)` (crea una sugerencia `plan_elements`)

**pins.ts**
- `listPins(userId, projectId, { level? })` (sin `findings.view` solo los propios)
- `reportFindingOnPlan(userId, projectId, { layer_id, x, y, title, description?, severity, category?, photo_data_url? })`
  crea el finding y el pin, y ejecuta el análisis por reglas
- `pinExistingFinding(userId, projectId, { finding_id, layer_id, x, y, category? })`
- `analyzeFinding(userId, findingId, { use_ai })` reemplaza las pendientes y crea hasta 3 `create_task` (más `update_finding_severity` si corresponde)
- `getFindingContext(userId, findingId): { pin, correlations, suggestions, tasks }`

**suggestions.ts**
- `listSuggestions(userId, projectId, { status?, finding_id?, limit? })`
- `approveSuggestion(userId, suggestionId, { edited_payload?, notes? })`: transacción con `FOR UPDATE`; aplica según el tipo y audita
- `rejectSuggestion(userId, suggestionId, reason?)`

## 7. Seguridad (incluido en esta entrega)

Además del módulo nuevo se corrigen los hallazgos del análisis previo:

- `app/actions/plans.ts`: todas las consultas quedan filtradas por `user_id`
  (antes un usuario podía leer, borrar o sobrescribir planos ajenos).
- `/api/chat`, `/api/autodesk/token`, `/api/planos/cad-to-image` y las acciones
  de `document-processing.ts` y `ocr.ts` exigen sesión válida. Antes bastaba una
  cookie cualquiera y se podía gastar la cuota de IA o pedir tokens de Autodesk.
- `/api/findings/photo` solo descarga del origen de Supabase configurado (sin
  SSRF) y responde con `Cache-Control: private`.

## 8. Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Roles y equipo, planos por especialidad (imagen/PDF/DXF), elementos, hallazgos en plano, motor de correlación, sugerencias con aprobación, tareas, revisiones, auditoría, dashboards por rol, API móvil de tareas, correcciones de seguridad | **Esta entrega** |
| 2 | Abrir módulos heredados (documentos, personal, checklists) a los miembros según rol; notificaciones por correo/push de aprobaciones y tareas | Pendiente |
| 3 | Vista 3D por niveles (react-three/fiber ya instalado) con capas apiladas; cortes por eje | Pendiente |
| 4 | IA proactiva: comparar fotos sucesivas del mismo pin (evolución de grieta), predicción de vencimientos y riesgos por cuadrilla, siempre como sugerencias | Pendiente |
| 5 | Offline completo en la app de terreno (IndexedDB) para reportar hallazgos sin señal | Pendiente |

## 9. Pruebas

- **Unitarias (puras):** permisos, geometría, reglas y correlación, clasificador,
  DXF, payloads y transiciones. `npm run test`.
- **Integración con Postgres real** (`tests/obra/*.int.test.ts`): se ejecutan
  solo con `TEST_DATABASE_ADMIN_URL`. Cubren autorización por rol, aislamiento
  entre proyectos (IDOR), doble aprobación, sugerencia aplicada una sola vez,
  próxima revisión automática y auditoría.

```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run tests/obra
```
