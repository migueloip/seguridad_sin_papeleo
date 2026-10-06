"use client"

/**
 * Equipo de la obra: integrantes con su rol, qué hace cada rol y una tabla de
 * permisos. Quien gestiona el equipo (members.manage) puede agregar
 * integrantes (con contraseña temporal si no tenían cuenta), cambiar su rol y
 * quitarlos.
 */
import { useId, useMemo, useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Check, Copy, KeyRound, Loader2, Minus, UserMinus, UserPlus, UsersRound } from "lucide-react"
import { addObraMember, removeObraMember, updateObraMemberRole } from "@/app/actions/obra/members"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { can, canAssignRole, PERMISSIONS, type Permission } from "@/lib/obra/permissions"
import {
  OBRA_ROLE_DESCRIPTIONS,
  OBRA_ROLE_LABELS,
  OBRA_ROLES,
  type ObraMember,
  type ObraRole,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { RoleBadge } from "./badges"
import { callAction } from "./task-card"

type LinkableWorker = { id: number; name: string; rut: string | null }

/** Nombre corto de cada rol (encabezados de la tabla). */
const ROLE_SHORT: Record<ObraRole, string> = {
  gerente: "Gerente",
  jefe_obra: "Jefe de obra",
  prevencionista: "Prevencionista",
  supervisor: "Supervisor",
  trabajador: "Trabajador",
  visita: "Visita / ITO",
}

/** Permisos en lenguaje simple. */
const PERMISSION_LABELS: Record<Permission, string> = {
  "project.view": "Ver la obra y su resumen",
  "members.manage": "Agregar o quitar personas del equipo",
  "plans.view": "Ver los planos",
  "plans.manage": "Subir, alinear y editar planos",
  "findings.view": "Ver todos los hallazgos",
  "findings.report": "Reportar hallazgos en el plano",
  "tasks.view_all": "Ver todas las tareas de la obra",
  "tasks.manage": "Crear, editar y cancelar tareas",
  "tasks.complete_own": "Cerrar sus propias tareas",
  "tasks.complete_any": "Cerrar cualquier tarea",
  "ai.request": "Pedir análisis con IA",
  "ai.review": "Aprobar o descartar sugerencias de IA",
  "ai.review_critical": "Aprobar sugerencias de IA críticas",
  "inspections.manage": "Programar y cerrar revisiones",
  "audit.view": "Ver la auditoría (quién hizo qué)",
}

function initials(m: Pick<ObraMember, "name" | "email">): string {
  const base = (m.name || m.email || "?").trim()
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

export function TeamContent({
  projectId,
  role,
  currentUserId,
  initialMembers,
  linkableWorkers,
}: {
  projectId: number
  role: ObraRole
  currentUserId: number
  initialMembers: ObraMember[]
  /** Trabajadores del dueño que se pueden vincular (solo si el rol gestiona el equipo). */
  linkableWorkers: LinkableWorker[] | null
}) {
  const canManage = can(role, "members.manage")

  const [prevInitial, setPrevInitial] = useState(initialMembers)
  const [members, setMembers] = useState(initialMembers)
  if (initialMembers !== prevInitial) {
    setPrevInitial(initialMembers)
    setMembers(initialMembers)
  }

  const [addOpen, setAddOpen] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [removing, setRemoving] = useState<ObraMember | null>(null)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  const assignable = OBRA_ROLES.filter((r) => canAssignRole(role, r))

  function canEditMember(m: ObraMember): boolean {
    if (!canManage || m.is_owner || m.user_id === currentUserId) return false
    if (m.role === "gerente" && role !== "gerente") return false
    return true
  }

  function changeRole(m: ObraMember, newRole: ObraRole) {
    if (newRole === m.role) return
    setBusyUserId(m.user_id)
    startTransition(async () => {
      const res = await callAction(() => updateObraMemberRole(projectId, m.user_id, newRole))
      setBusyUserId(null)
      if (res.ok === false) {
        toast.error(res.error)
        return
      }
      setMembers((prev) => prev.map((x) => (x.user_id === m.user_id ? res.data : x)))
      toast.success(`${m.name || m.email} ahora es ${OBRA_ROLE_LABELS[newRole]}.`)
    })
  }

  function confirmRemove() {
    const m = removing
    if (!m) return
    setBusyUserId(m.user_id)
    startTransition(async () => {
      const res = await callAction(() => removeObraMember(projectId, m.user_id))
      setBusyUserId(null)
      if (res.ok === false) {
        toast.error(res.error)
        return
      }
      setMembers((prev) => prev.filter((x) => x.user_id !== m.user_id))
      setRemoving(null)
      toast.success(`${m.name || m.email} ya no es parte del equipo.`)
    })
  }

  return (
    <div className="space-y-8">
      {/* Integrantes */}
      <section aria-labelledby="team-members-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="team-members-title" className="font-display text-xl font-bold tracking-tight">
              Equipo de la obra
            </h2>
            <p className="text-sm text-muted-foreground">
              {members.length} persona{members.length === 1 ? "" : "s"} con acceso. Cada una ve y hace lo que permite su
              rol.
            </p>
          </div>
          {canManage ? (
            <Button type="button" className="h-10 rounded-[10px]" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Agregar integrante
            </Button>
          ) : null}
        </div>

        <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
          {members.map((m) => {
            const editable = canEditMember(m)
            const busy = busyUserId === m.user_id && isPending
            const selectId = `member-role-${m.user_id}`
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 p-3.5 sm:flex-nowrap">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold"
                  aria-hidden
                >
                  {initials(m)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="break-all font-semibold">{m.name || m.email}</span>
                    {m.user_id === currentUserId ? (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">Tú</span>
                    ) : null}
                    {m.is_owner ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                        Dueño de la obra
                      </span>
                    ) : null}
                  </div>
                  {m.name ? <div className="break-all text-[13px] text-muted-foreground">{m.email}</div> : null}
                  {m.worker_name ? (
                    <div className="text-xs text-muted-foreground">Ficha de trabajador: {m.worker_name}</div>
                  ) : null}
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
                  {editable ? (
                    <>
                      <Label htmlFor={selectId} className="sr-only">
                        Rol de {m.name || m.email}
                      </Label>
                      <Select value={m.role} onValueChange={(v) => changeRole(m, v as ObraRole)} disabled={busy}>
                        <SelectTrigger id={selectId} className="h-10 min-w-0 flex-1 sm:w-[230px] sm:flex-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(assignable.includes(m.role) ? assignable : [m.role, ...assignable]).map((r) => (
                            <SelectItem key={r} value={r} className="min-h-10" disabled={!assignable.includes(r)}>
                              {OBRA_ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10 shrink-0 text-danger hover:bg-danger-tint hover:text-danger"
                        disabled={busy}
                        onClick={() => setRemoving(m)}
                        aria-label={`Quitar a ${m.name || m.email} del equipo`}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserMinus className="h-4 w-4" aria-hidden />}
                        <span className="sm:sr-only lg:not-sr-only">Quitar</span>
                      </Button>
                    </>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {canManage && members.length <= 1 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <UsersRound className="h-4 w-4" aria-hidden />
            Agrega a tu equipo para repartir tareas, reportar hallazgos desde terreno y aprobar sugerencias de IA.
          </p>
        ) : null}
      </section>

      {/* Roles */}
      <section aria-labelledby="team-roles-title" className="space-y-3">
        <h2 id="team-roles-title" className="font-display text-lg font-semibold">
          Qué hace cada rol
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {OBRA_ROLES.map((r) => (
            <div
              key={r}
              className={cn(
                "rounded-[14px] border bg-card p-4",
                r === role ? "border-brand/60" : "border-border",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <RoleBadge role={r} />
                {r === role ? <span className="text-[11px] font-semibold text-muted-foreground">Tu rol</span> : null}
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">{OBRA_ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Permisos */}
      <section aria-labelledby="team-perms-title" className="space-y-3">
        <div>
          <h2 id="team-perms-title" className="font-display text-lg font-semibold">
            Permisos por rol
          </h2>
          <p className="text-sm text-muted-foreground">Lo que cada rol puede hacer en esta obra.</p>
        </div>
        <PermissionsTable currentRole={role} />
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>El jefe de obra gestiona el equipo, pero solo un gerente puede nombrar o modificar a otro gerente.</li>
          <li>Sin «Ver todas las tareas», cada persona ve las tareas asignadas a ella o a su rol.</li>
          <li>Sin «Ver todos los hallazgos», el trabajador ve solo los hallazgos que reportó.</li>
          <li>Ninguna sugerencia de IA se aplica sola: siempre la aprueba una persona y queda en la auditoría.</li>
        </ul>
      </section>

      {canManage ? (
        <AddMemberDialog
          projectId={projectId}
          open={addOpen}
          onOpenChange={setAddOpen}
          assignable={assignable}
          workers={linkableWorkers ?? []}
          onAdded={(member, password) => {
            setMembers((prev) => [...prev.filter((x) => x.user_id !== member.user_id), member])
            setAddOpen(false)
            if (password) {
              setCredentials({ email: member.email, password })
            } else {
              toast.success(`${member.name || member.email} se agregó al equipo. Ya tenía cuenta: entra con su contraseña de siempre.`)
            }
          }}
        />
      ) : null}

      {/* Contraseña temporal (se muestra una sola vez) */}
      <Dialog open={credentials !== null} onOpenChange={(o) => !o && setCredentials(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-brand" aria-hidden />
              Cuenta creada
            </DialogTitle>
            <DialogDescription>
              Entrégale estos datos para que entre a Easysecure. La contraseña se muestra una sola vez; pídele cambiarla en
              Perfil.
            </DialogDescription>
          </DialogHeader>
          {credentials ? (
            <div className="space-y-3">
              <CopyField label="Correo" value={credentials.email} />
              <CopyField label="Contraseña temporal" value={credentials.password} mono />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" className="h-10" onClick={() => setCredentials(null)}>
              Listo, ya la anoté
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar quitar integrante */}
      <Dialog open={removing !== null} onOpenChange={(o) => !o && !isPending && setRemoving(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>¿Quitar del equipo?</DialogTitle>
            <DialogDescription className="break-words">
              {removing ? `${removing.name || removing.email} perderá el acceso a esta obra.` : ""} Sus tareas asignadas
              seguirán a su nombre hasta que las reasignes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" disabled={isPending} onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" className="h-10" disabled={isPending} onClick={confirmRemove}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserMinus className="h-4 w-4" aria-hidden />}
              Sí, quitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabla de permisos
// ---------------------------------------------------------------------------

function PermissionsTable({ currentRole }: { currentRole: ObraRole }) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-[220px] bg-card">Permiso</TableHead>
            {OBRA_ROLES.map((r) => (
              <TableHead
                key={r}
                scope="col"
                className={cn("text-center whitespace-normal", r === currentRole && "bg-brand/10 text-foreground")}
              >
                {ROLE_SHORT[r]}
                {r === currentRole ? <span className="block text-[10px] font-normal">(tu rol)</span> : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {PERMISSIONS.map((p) => (
            <TableRow key={p}>
              <TableCell className="sticky left-0 z-10 bg-card whitespace-normal font-medium">{PERMISSION_LABELS[p]}</TableCell>
              {OBRA_ROLES.map((r) => {
                const ok = can(r, p)
                return (
                  <TableCell key={r} className={cn("text-center", r === currentRole && "bg-brand/10")}>
                    {ok ? (
                      <Check className="mx-auto h-4 w-4 text-success" aria-label="Sí" />
                    ) : (
                      <Minus className="mx-auto h-4 w-4 text-muted-foreground/50" aria-label="No" />
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agregar integrante
// ---------------------------------------------------------------------------

const NO_WORKER = "none"

function AddMemberDialog({
  projectId,
  open,
  onOpenChange,
  assignable,
  workers,
  onAdded,
}: {
  projectId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  assignable: ObraRole[]
  workers: LinkableWorker[]
  onAdded: (member: ObraMember, temporaryPassword: string | null) => void
}) {
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Agregar integrante</DialogTitle>
          <DialogDescription>
            Si la persona aún no tiene cuenta en Easysecure, se crea con una contraseña temporal.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <AddMemberForm
            projectId={projectId}
            assignable={assignable}
            workers={workers}
            onCancel={() => onOpenChange(false)}
            onSavingChange={setSaving}
            onAdded={onAdded}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AddMemberForm({
  projectId,
  assignable,
  workers,
  onCancel,
  onSavingChange,
  onAdded,
}: {
  projectId: number
  assignable: ObraRole[]
  workers: LinkableWorker[]
  onCancel: () => void
  onSavingChange: (saving: boolean) => void
  onAdded: (member: ObraMember, temporaryPassword: string | null) => void
}) {
  const formId = useId()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [newRole, setNewRole] = useState<ObraRole>(assignable.includes("trabajador") ? "trabajador" : assignable[0])
  const [worker, setWorker] = useState(NO_WORKER)
  const [workerQuery, setWorkerQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filteredWorkers = useMemo(() => {
    const q = workerQuery.trim().toLowerCase()
    const list = q ? workers.filter((w) => `${w.name} ${w.rut ?? ""}`.toLowerCase().includes(q)) : workers
    // La opción elegida siempre debe estar en la lista para que el selector la muestre.
    const selected = workers.find((w) => String(w.id) === worker)
    const limited = list.slice(0, 200)
    return selected && !limited.some((w) => w.id === selected.id) ? [selected, ...limited] : limited
  }, [workers, workerQuery, worker])

  function submit(e: FormEvent) {
    e.preventDefault()
    const em = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError("Ingresa un correo electrónico válido.")
      return
    }
    const nm = name.trim()
    if (nm && nm.length < 2) {
      setError("El nombre debe tener al menos 2 caracteres.")
      return
    }
    setError(null)
    onSavingChange(true)
    startTransition(async () => {
      const res = await callAction(() =>
        addObraMember(projectId, {
          email: em,
          name: nm || undefined,
          role: newRole,
          worker_id: worker === NO_WORKER ? null : Number(worker),
        }),
      )
      onSavingChange(false)
      if (res.ok === false) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      onAdded(res.data.member, res.data.temporary_password)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-email`}>Correo electrónico</Label>
        <Input
          id={`${formId}-email`}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          placeholder="nombre@empresa.cl"
          className="h-10"
          autoFocus
          required
          aria-required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-name`}>Nombre (opcional)</Label>
        <Input
          id={`${formId}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Ej.: Juan Pérez"
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">Se usa solo si la persona aún no tiene cuenta.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-role`}>Rol en la obra</Label>
        <Select value={newRole} onValueChange={(v) => setNewRole(v as ObraRole)}>
          <SelectTrigger id={`${formId}-role`} className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assignable.map((r) => (
              <SelectItem key={r} value={r} className="min-h-10">
                {OBRA_ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{OBRA_ROLE_DESCRIPTIONS[newRole]}</p>
      </div>

      {workers.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-worker`}>Vincular con su ficha de trabajador (opcional)</Label>
          {workers.length > 15 ? (
            <Input
              value={workerQuery}
              onChange={(e) => setWorkerQuery(e.target.value)}
              placeholder="Buscar por nombre o RUT"
              aria-label="Buscar trabajador por nombre o RUT"
              className="h-10"
            />
          ) : null}
          <Select value={worker} onValueChange={setWorker}>
            <SelectTrigger id={`${formId}-worker`} className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_WORKER} className="min-h-10">
                No vincular
              </SelectItem>
              {filteredWorkers.length > 0 ? <SelectSeparator /> : null}
              {filteredWorkers.map((w) => (
                <SelectItem key={w.id} value={String(w.id)} className="min-h-10">
                  {w.name}
                  {w.rut ? ` · ${w.rut}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[10px] bg-danger-tint px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={isPending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" className="h-10" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
          Agregar
        </Button>
      </DialogFooter>
    </form>
  )
}

function CopyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const id = useId()

  function copy() {
    const done = () => {
      setCopied(true)
      toast.success(`${label} copiado.`)
      window.setTimeout(() => setCopied(false), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done, () => toast.error("No se pudo copiar. Selecciónalo y cópialo a mano."))
    } else {
      toast.error("No se pudo copiar. Selecciónalo y cópialo a mano.")
    }
  }

  return (
    <div className="space-y-1">
      <div id={id} className="text-xs font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <output
          aria-labelledby={id}
          className={cn(
            "min-w-0 flex-1 select-all break-all rounded-[10px] border border-border bg-secondary px-3 py-2.5 text-sm",
            mono && "font-mono text-base tracking-wider",
          )}
        >
          {value}
        </output>
        <Button
          type="button"
          variant="outline"
          className="h-10 shrink-0"
          onClick={copy}
          aria-label={`Copiar ${label.toLowerCase()}`}
        >
          {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          Copiar
        </Button>
      </div>
    </div>
  )
}
