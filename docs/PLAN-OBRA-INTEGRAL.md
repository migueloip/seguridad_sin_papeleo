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
| Gestionar equipo e invitar (`members.manage`) | ✓ | ✓ (no invita ni nombra gerentes) | | | | |
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
   Una lámina que cabe en la acción (data URL ≤ 4,5 M caracteres ≈ 3,2 MB) se
   envía inline. Si es más grande (hasta 25 MB y 6000 px por lado), el navegador
   la **sube directo a Supabase Storage**: pide un ticket
   (`createObraLayerUploadTicket`, con cuota por persona y por obra; URL
   firmada de 2 h para `obra/<proyecto>/uploads/<uuid>.<ext>`), hace PUT con
   barra de progreso (se puede cancelar) y crea la capa con `image_upload` y
   una copia reducida para la IA. El servidor exige que el ticket sea de quien
   crea la capa, verifica que el objeto exista, su tamaño, tipo y magic bytes
   (si no calzan lo borra) y que ninguna otra capa use esa ruta; si la capa no
   se crea por un error de validación, borra el objeto, y los objetos de
   tickets vencidos que no llegaron a una capa se limpian solos. Sin Supabase
   el diálogo reduce la lámina al elegirla; si falla la red, explica el motivo
   y ofrece reducirla y crearla inline.
2. Indica disciplina, nivel (0 = primer piso, −1 = subterráneo) y ancho real de
   la lámina en metros. Si varias capas del mismo nivel no calzan, se alinean
   con desplazamiento y rotación (`LayerFrame`), usando una vista superpuesta
   con opacidad. Las capas DXF guardan su origen CAD (`cad_origin`): una nueva
   capa DXF del mismo nivel y escala nace alineada con la primera.
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
3. Quien tenga `ai.request` puede pedir **"Analizar con IA"** (o volver a
   analizar con reglas; re-analizar escribe, así que exige `ai.request`): el LLM
   recibe las correlaciones (no el plano libre), redacta hipótesis y checklist y
   propone prioridad. Esto reemplaza las sugerencias pendientes anteriores
   (`superseded`), salvo que el análisis termine con reglas: entonces se
   conservan las pendientes redactadas por IA. No se vuelven a sugerir
   correlaciones que ya tienen una tarea abierta, y la regla de contexto (redes
   cercanas a cualquier hallazgo) solo se muestra como evidencia, sin tarea.
   Hay un límite de uso de IA por persona y hora y por obra y día.
4. En el panel del hallazgo, cada sugerencia muestra la evidencia (elemento,
   distancia, capa, relación de nivel) y tres botones:
   **Anotar en tareas de la próxima revisión** (aprueba), **Editar y aprobar**
   y **Descartar** (pide motivo).
   La bandeja de aprobaciones (`/obra/[id]/aprobaciones`) reúne las pendientes
   de toda la obra; solo la ven (y solo cuentan sus pendientes) los roles con
   `ai.review`.
5. Al aprobar se crea la tarea en la **próxima revisión**, con el mismo
   criterio que muestran el resumen y la página Revisiones (en curso → programada
   desde hoy → programada atrasada; `pickNextInspection`). Si no existe, se crea
   una "Revisión semanal" a 7 días; si la tarea vence antes que la próxima
   programada, una "Revisión prioritaria" para su vencimiento. La tarea lleva
   vencimiento (contado en la hora de Chile), rol sugerido y checklist, y queda
   auditada. Al aprobar se valida con datos frescos: un cambio de severidad no
   se aplica si el hallazgo cambió o se resolvió, y editar no puede cambiar el
   hallazgo de una tarea ni la capa de unos elementos. La tarea queda con
   origen `ia` si la sugerencia la redactó la IA, o `reglas` si salió del motor
   de reglas (aunque el revisor la edite): la tarjeta muestra "Sugerida por IA ·
   aprobada por X" o "Sugerencia automática (reglas) · aprobada por X".

### 4.3 Revisiones
Las revisiones (`obra_inspections`) agrupan las tareas a verificar en terreno.
Al cerrar una se registra un resumen y, opcionalmente, las tareas abiertas pasan
a la siguiente.

### 4.4 Equipo e invitaciones (`/obra/[id]/equipo`)
1. Quien tiene `members.manage` invita por correo con un rol (un jefe de obra
   no puede invitar gerentes) y, opcionalmente, un trabajador vinculado. Recibe
   un enlace `/invitacion/<token>` para copiar o enviar por WhatsApp. La
   respuesta es la misma tenga o no cuenta ese correo, para no revelar quién
   está registrado.
2. El enlace se muestra una sola vez y vence a los 7 días. Se puede regenerar
   (el anterior deja de servir) o revocar. La lista muestra el estado:
   pendiente, aceptada, revocada o vencida.
3. La persona abre el enlace (página pública) y ve la obra, el rol y quién la
   invitó (solo mientras está pendiente; un enlace aceptado, revocado o
   vencido muestra solo su estado):
   - con cuenta: inicia sesión (el login vuelve a la invitación con `?next=`)
     y acepta; si entró con otro correo, no puede aceptar (y nadie puede
     cambiar su correo de perfil a uno con invitación pendiente);
   - sin cuenta: crea la suya con su propia contraseña y queda con la sesión
     abierta dentro de la obra.
   Los correos no se verifican: el enlace es un **token al portador** (si el
   correo invitado no tiene cuenta, quien tenga el enlace la crea). Se
   comparte solo con la persona y se revoca si se filtra.
4. La invitación vale mientras quien la envió pueda otorgar ese rol: al
   quitarlo del equipo o bajarle el rol se revocan sus invitaciones abiertas
   (las que ya no podría enviar), y al aceptar se vuelve a comprobar.
5. Quitar a un miembro deja sus tareas abiertas sin persona asignada, visibles
   para su rol, y lo registra en la auditoría. Si después se reabre una tarea
   cerrada que tenía asignada, queda sin persona y visible para su rol.

### 4.5 Vistas por rol (`/obra/[id]`)
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
| `obra_invitations` | Invitación por correo y rol: hash SHA-256 del token (nunca el token), vencimiento, quién invitó, y aceptación o revocación. Una abierta por correo y obra. |
| `obra_plan_layers` | Capa por especialidad y nivel: imagen (Storage o inline), copia reducida para la IA (`analysis_image_path`), marco métrico (`width_m`, `aspect`, `offset_*`, `rotation_deg`), opacidad. Borrado lógico. |
| `obra_layer_uploads` | Tickets de subida directa de láminas: ruta, quién y en qué obra, vencimiento, y si se usó en una capa o se descartó (cuota y limpieza de subidas abandonadas). |
| `obra_plan_elements` | Elementos confirmados en coordenadas normalizadas de su capa (`geometry` JSONB), tipo, atributos (Ø, profundidad, material...), origen (manual / ia / dxf). |
| `obra_finding_pins` | Ubicación de un `finding` en una capa y nivel, con su categoría. |
| `obra_ai_suggestions` | Sugerencias pendientes, aprobadas, rechazadas o reemplazadas, con payload, evidencia, generador, modelo, revisor y entidad aplicada. |
| `obra_tasks` | Tareas (origen manual, `ia`, `reglas` o de hallazgo) con prioridad, rol o persona asignada, revisión, vencimiento, checklist, ubicación y cierre. |
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
  client-files.ts   (cliente) imagen/PDF → data URL reducida o archivo para subida directa (PUT con progreso)
  server/           lógica de servidor sin "use server" (recibe actorUserId)
    members.ts invitations.ts tasks.ts inspections.ts dashboard.ts audit.ts
    layers.ts elements.ts pins.ts suggestions.ts ai.ts storage.ts
lib/safe-redirect.ts                      ?next= seguro para login y registro
app/actions/obra/   acciones "use server" finas (sesión → lib/obra/server)
app/invitacion/[token]/page.tsx           aceptar invitación (pública)
app/api/obra/layers/[id]/image/route.ts   imagen de capa con control de acceso (302 a URL firmada si está en Storage)
app/api/obra/findings/[id]/photo/route.ts foto de hallazgo con control de acceso
app/api/mobile/obra/...                   tareas para la app de terreno (Bearer)
app/obra/...                              páginas
components/obra/...                       UI
tests/obra/                               tests de integración con Postgres real
tests/obra/fake-supabase-storage.ts       servidor falso fiel al contrato de Supabase Storage
```

### 6.1 Contratos de `lib/obra/server/*`

Todas lanzan `ObraAccessError` (401, 403 o 404) u `ObraValidationError`
(mensaje mostrable). Las acciones `"use server"` las envuelven y devuelven
`ActionResult<T>` usando `toActionError`.

**members.ts**
- `listMyProjects(userId): ObraProjectSummary[]`
- `getAccessInfo(userId, projectId): ProjectAccess & { permissions }`
- `listMembers(userId, projectId): ObraMember[]` (`project.view`; el dueño aparece primero con `is_owner`)
- `updateMemberRole(userId, projectId, memberUserId, role)` y `removeMember(userId, projectId, memberUserId)`
  (no se puede tocar al dueño; solo un gerente modifica a otro gerente; quitar
  deja sus tareas abiertas sin persona y visibles para su rol; ambos revocan
  las invitaciones abiertas de esa persona que ya no podría enviar:
  `revokeInvitationsSentBy`)
- `listLinkableWorkers(userId, projectId): { id, name, rut }[]` (trabajadores del dueño)
  y `assertLinkableWorker(q, access, workerId)`
- Ya no existe `addMember`: se entra al equipo solo aceptando una invitación.

**invitations.ts**
- `createInvitation(userId, projectId, { email, name?, role, worker_id? }, baseUrl): InvitationLink`
  (`members.manage` + `canAssignRole`; misma respuesta tenga o no cuenta el correo;
  reemplaza una invitación vencida del mismo correo)
- `regenerateInvitationLink(userId, invitationId, baseUrl): InvitationLink` (invalida el enlace anterior)
- `revokeInvitation(userId, invitationId): ObraInvitation` y `listInvitations(userId, projectId): ObraInvitation[]` (máx. 200)
- `getInvitationPreview(token): InvitationPreview | null` (pública: obra, rol,
  correo, quién invita y vencimiento solo si está pendiente; si no, `{ status }`)
- `acceptInvitationAsUser(userId, token): { project_id }` (el correo de la sesión debe coincidir)
- `acceptInvitationWithNewAccount(token, { name, password }): { user_id, project_id }`
  (nombre 2–120, contraseña 8–256; falla si el correo ya tiene cuenta)
- Ambas aceptaciones revalidan, con la fila bloqueada, que quien invitó siga
  pudiendo otorgar el rol (dueño o integrante con `canAssignRole`); si no, la
  anulan ("Esta invitación ya no es válida…").
- `hasOpenInvitationForEmail(email)`: la usa `updateProfile` para no dejar
  tomar el correo de una invitación pendiente.
- `baseUrl` lo calcula la acción: `APP_URL`, luego `URL` (Netlify), luego los
  headers de la petición; solo http(s).

**tasks.ts**
- `listTasks(userId, projectId, { status?, mine?, inspection_id? }): ObraTask[]`
  (sin `tasks.view_all` solo ve las asignadas a él o a su rol sin persona)
- `createTask(userId, projectId, TaskInput, tx?): ObraTask` (`tasks.manage`;
  valida que hallazgo, capa, revisión y usuario asignado pertenezcan al proyecto)
- `updateTask(userId, taskId, Partial<TaskInput>): ObraTask` (`tasks.manage`)
- `setTaskStatus(userId, taskId, status, notes?): ObraTask`
  (`tasks.manage`, `tasks.complete_any`, o `tasks.complete_own` si es suya; al
  reabrir, si la persona asignada ya no es del equipo, queda sin persona)
- `toggleChecklistItem(userId, taskId, index, done): ObraTask` (mismos permisos que el estado)

**inspections.ts**
- `listInspections(userId, projectId): ObraInspection[]`
- `createInspection(userId, projectId, { title, scheduled_for, lead_user_id?, notes? })` (`inspections.manage`)
- `updateInspection(userId, inspectionId, patch)` y `closeInspection(userId, inspectionId, { summary, carry_over_open_tasks })`
- `getOrCreateNextInspection(tx, projectId, actorUserId, { excludeId?, dueBy? }): ObraInspection` (interna, se usa al aprobar y al trasladar; con `dueBy` crea una "Revisión prioritaria" si la próxima programada es posterior)

**dashboard.ts / audit.ts**
- `getDashboard(userId, projectId): ObraDashboard` (los contadores de
  sugerencias pendientes son 0 sin `ai.review`; el índice de riesgo usa el real)
- `listAudit(userId, projectId, { limit?, before_id? }): AuditEntry[]` (`audit.view`)

**layers.ts / elements.ts / storage.ts**
- `listLayers(userId, projectId)`, `createLayer(userId, projectId, { name, discipline, level, level_label?, image? | image_upload?, width_m?, aspect?, cad_origin? })`,
  `updateLayer(userId, layerId, patch)`, `deleteLayer(userId, layerId)` (borrado lógico) y `readLayerImage(userId, layerId): { bytes, mime }`
- `createLayerUploadTicket(userId, projectId, { mime, size_bytes }): LayerUploadTicket`
  (`plans.manage`; requiere Supabase; cuota `LAYER_UPLOAD_QUOTA` por persona y
  hora y por obra y día; registra el ticket en `obra_layer_uploads` y antes
  limpia hasta 20 subidas abandonadas con `sweepAbandonedLayerUploads`) y
  `getLayerImageSignedUrl(userId, layerId, expiresIn)` (`plans.view`; null si la imagen es inline)
- `image_upload: { path, width_px, height_px, analysis_data_url? }` exige la
  ruta exacta de un ticket PROPIO sin usar del mismo proyecto, verifica el
  objeto y toma el lock `7262008` para que dos capas no compartan imagen. Si
  falla por validación (p.ej. proporción > 100) borra el objeto y descarta el
  ticket; si falla por red o BD lo conserva (permite reintentar). La copia
  reducida (≤ `AI_IMAGE_MAX_BYTES`) queda en `analysis_image_path` y es la que
  usa `requestLayerExtraction`.
- `listElements(userId, projectId, { level?, layer_id? })`, `createElements(userId, layerId, drafts, source)`,
  `updateElement(userId, elementId, patch)`, `deleteElement(userId, elementId)` y `requestLayerExtraction(userId, layerId)` (crea una sugerencia `plan_elements`)

**pins.ts**
- `listPins(userId, projectId, { level? })` (sin `findings.view` solo los propios)
- `reportFindingOnPlan(userId, projectId, { layer_id, x, y, title, description?, severity, category?, photo_data_url? })`
  crea el finding y el pin, y ejecuta el análisis por reglas
- `pinExistingFinding(userId, projectId, { finding_id, layer_id, x, y, category? })`
- `analyzeFinding(userId, findingId, { use_ai })` (`ai.request`) reemplaza las pendientes y crea hasta 3 `create_task` (más `update_finding_severity` si corresponde)
- `analyzeFindingAsSystem(projectId, findingId, { via? }): { created }` (sin
  sesión, a nombre del dueño, solo por reglas y solo si el hallazgo aún no
  tiene sugerencias; para scripts como el seed, no es una acción)
- `getFindingContext(userId, findingId): { pin, correlations, suggestions, tasks }`

**suggestions.ts**
- `listSuggestions(userId, projectId, { status?, finding_id?, limit? })` (las huérfanas, cuyo hallazgo se borró, no aparecen como pendientes)
- `countPendingSuggestions(userId, projectId): number` (contador de la pestaña; 0 si el rol no revisa)
- `approveSuggestion(userId, suggestionId, { edited_payload?, notes? })`: transacción con `FOR UPDATE`; aplica según el tipo y audita
  (la tarea queda con origen `ia` o `reglas` según el generador; el audit lleva `task_origin`)
- `rejectSuggestion(userId, suggestionId, reason?)`

## 7. Seguridad (incluido en esta entrega)

Además del módulo nuevo se corrigen los hallazgos del análisis previo:

- `app/actions/plans.ts`: todas las consultas quedan filtradas por `user_id`
  (antes un usuario podía leer, borrar o sobrescribir planos ajenos).
- `/api/chat`, `/api/autodesk/token`, `/api/planos/cad-to-image` y las acciones
  de `document-processing.ts` y `ocr.ts` exigen sesión válida. Antes bastaba una
  cookie cualquiera y se podía gastar la cuota de IA o pedir tokens de Autodesk.
- `/api/findings/photo` solo descarga del origen de Supabase configurado (sin
  SSRF) y responde con `Cache-Control: private`. También sirve las fotos que
  Obra guarda en el bucket privado (`obra-storage:<ruta>`).
- `app/actions/settings.ts` ya no devuelve claves sensibles: `getSetting`
  rechaza `ai_api_key`/`smtp_pass` y `getSettings` las enmascara. La lectura
  en servidor (y `getAiSettings`) vive en `lib/settings.ts`, fuera de
  `"use server"`. Las rutas `/api/settings/*` exigen sesión y no devuelven
  mensajes internos.
- La configuración de IA se resuelve en `lib/ai-settings.ts`: una URL base
  propia (`ai_base_url` del usuario) solo se usa con la API key propia, nunca
  con la global ni con la del entorno (antes un usuario podía apuntarla a un
  servidor suyo y recibir la key del servidor), y en producción debe ser https
  hacia un host público (sin SSRF a la red interna).

Segunda ronda (cierre de pendientes de la fase 1):

- **Invitaciones en vez de alta directa.** Agregar por correo revelaba si la
  persona tenía cuenta y la sumaba sin su consentimiento, y la clave temporal
  no vencía y la conocía quien invitaba. Ahora el token solo se guarda como
  SHA-256, vence a los 7 días, se acepta de forma explícita y la respuesta no
  distingue correos con o sin cuenta.
- **Retorno tras login** (`?next=`): solo rutas relativas seguras
  (`lib/safe-redirect.ts`), sin redirecciones abiertas.
- **Configuración:** `updateSetting`/`updateSettings` solo escriben claves de
  una lista blanca (`WRITABLE_SETTING_KEYS`); antes una llamada directa a la
  acción podía sembrar claves arbitrarias.
- **`/api/planos/cad-to-image`:** cuerpo con límite (413), JSON inválido 400,
  timeout de 60 s (504), errores del conversor solo en el log (502 genérico) y
  respuesta validada como `data:image/*` de máximo 30 MB.
- **`/api/autodesk/token`:** scope mínimo `viewables:read`, credenciales en
  `Authorization: Basic`, respuesta solo `{ access_token, expires_in }` con
  `no-store`; 502 ante fallas del proveedor y 503 sin configuración.
- **Planos en Storage:** bucket privado con límites de tamaño y tipo; la
  subida directa se verifica por magic bytes, exige un ticket propio (con
  cuota) y limpia los objetos abandonados; la imagen se sirve por URL firmada
  de 2 min (redirección cacheada 60 s). La ruta del objeto no es secreta: las
  referencias `obra-storage:` que llegan del cliente se descartan y las rutas
  de fotos solo sirven fotos de hallazgos del mismo proyecto.
- **Invitaciones:** dejan de servir si quien las envió sale del equipo o ya no
  puede otorgar ese rol; la vista previa de una cerrada no trae datos
  personales; `updateProfile` no deja tomar un correo con invitación
  pendiente ni uno de `ADMIN_EMAILS`.
- **Asistente IA genérico** oculto dentro de `/obra/<id>` (no conoce la obra).
- **pdf.js:** el worker se carga desde el bundle propio (sin unpkg).
- **Contadores de aprobaciones** ocultos para roles que no revisan.

## 8. Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Roles y equipo, planos por especialidad (imagen/PDF/DXF), elementos, hallazgos en plano, motor de correlación, sugerencias con aprobación, tareas, revisiones, auditoría, dashboards por rol, API móvil de tareas, correcciones de seguridad | **Hecho** |
| 1.1 | Pendientes de la fase 1: invitaciones con enlace (y página `/invitacion`), retorno seguro tras login, desasignar tareas al quitar miembros, subida directa de planos grandes a Storage con URL firmada, origen `reglas` en tareas, contadores de aprobaciones por permiso, seed con sugerencias pendientes, build con verificación de tipos (`npm run typecheck`), lista blanca de configuración, proveedores de IA alineados con `ai` 5 | **Hecho** |
| 2 | Abrir módulos heredados (documentos, personal, checklists) a los miembros según rol; notificaciones por correo/push de aprobaciones y tareas | Pendiente |
| 3 | Vista 3D por niveles con capas apiladas (muros, estructura y redes a su altura, rayos X, «solo muros», pines de hallazgos) y mapa de calor de hallazgos en 2D y 3D con filtros por estado, período y categoría | **Hecho** |
| 3.1 | Cortes por eje en 3D; lámina de imagen como textura del piso; alturas reales por elemento (cota de clave/radier) | Pendiente |
| 4 | IA proactiva: comparar fotos sucesivas del mismo pin (evolución de grieta), predicción de vencimientos y riesgos por cuadrilla, siempre como sugerencias | Pendiente |
| 5 | Offline completo en la app de terreno (IndexedDB) para reportar hallazgos sin señal | Pendiente |

Pendientes conocidos (técnicos, fuera de las fases):

- Índice `UNIQUE` sobre `obra_plan_layers(image_path)` como defensa adicional
  al lock `7262008` (hoy hay un índice normal).
- Láminas subidas directo antes de la copia reducida: la detección con IA
  responde que pesan demasiado; hay que volver a subirlas.
- Verificar el correo (confirmación por correo) para que la invitación deje de
  ser un token al portador y `ADMIN_EMAILS` no dependa del primer registro.
- Validar la imagen completa (decodificarla) y no solo su cabecera.
- Asistente IA de la obra (con `project.view`, datos por `project_id` y la
  configuración de IA del dueño), en vez de ocultar el genérico en `/obra/<id>`.
- `PLAN_UPLOAD_MAX_BYTES` está duplicado en `storage.ts` y `client-files.ts`
  (un test exige que coincidan); moverlo a `types.ts`.
- Sin cliente en el repo: `/api/autodesk/token`, `/api/planos/cad-to-image` y
  `AiReportChat` (con `/api/chat`); conectarlos o eliminarlos. Las
  dependencias `@pascal-app/*` tampoco se importan.
- `components/reports-content.tsx` carga html2pdf desde unpkg sin `integrity`.

## 9. Pruebas

- **Unitarias (puras):** permisos, geometría, reglas y correlación, clasificador,
  DXF, payloads y transiciones, archivos del cliente (`client-files.test.ts`),
  `safeNextPath` (`app/actions/auth.test.ts`) y los 4 proveedores de IA contra
  un servidor HTTP local (`lib/ai.test.ts`). `npm run test`.
- **Integración con Postgres real** (`tests/obra/*.int.test.ts`): se ejecutan
  solo con `TEST_DATABASE_ADMIN_URL`. Cubren autorización por rol, aislamiento
  entre proyectos (IDOR), doble aprobación, sugerencia aplicada una sola vez,
  próxima revisión automática, auditoría, invitaciones (estados, aceptación
  concurrente, correo distinto, roles, invitador que sale o baja de rol),
  quitar miembros y reabrir sus tareas, subida directa contra
  `tests/obra/fake-supabase-storage.ts` (tickets propios, cuota, limpieza, copia
  para la IA), rutas `obra-storage:` inyectadas (`review-fixes.int.test.ts`) y
  el seed demo.
- **Componentes (jsdom):** cancelar la subida directa, copia para la IA, modo
  sin subida directa y refresco de la invitación (`components/obra/review-ui.test.tsx`).
- **Tipos:** `npm run typecheck`; `npm run build` también falla ante cualquier
  error de tipos.

```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run tests/obra
```
