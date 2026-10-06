"use client"

/**
 * Tarjeta de una sugerencia de IA (o del motor de reglas) con aprobación
 * humana obligatoria. Muestra qué propone, por qué (evidencia verificable:
 * elemento, distancia, capa y relación de nivel), quién la generó y su
 * estado. Si el rol puede revisarla ofrece:
 *   - "Anotar en tareas de la próxima revisión" (create_task) o "Aprobar";
 *   - "Editar y aprobar" (diálogo de edición o revisión de elementos);
 *   - "Descartar" (con motivo opcional).
 * La autorización real está en el servidor (ai.review / ai.review_critical).
 */
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"
import { toast } from "sonner"
import {
  CheckCircle2,
  ClipboardPlus,
  Layers,
  ListChecks,
  Loader2,
  MapPin,
  Pencil,
  ShieldAlert,
  TriangleAlert,
  XCircle,
} from "lucide-react"
import { approveObraSuggestion, rejectObraSuggestion } from "@/app/actions/obra/suggestions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { describeCorrelation, formatDistanceCl } from "@/lib/obra/correlation"
import { can, canReviewSuggestion } from "@/lib/obra/permissions"
import {
  DISCIPLINE_COLORS,
  DISCIPLINE_LABELS,
  ELEMENT_TYPE_LABELS,
  OBRA_ROLE_LABELS,
  SEVERITY_LABELS,
  SUGGESTION_KIND_LABELS,
  type AiSuggestion,
  type Correlation,
  type ObraRole,
  type PlanLayer,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { GeneratorBadge, PriorityBadge, SeverityBadge, SuggestionStatusBadge } from "./badges"
import { countByType, ExtractionReviewDialog, type ApproveSuggestionResult } from "./extraction-review"
import { elementColor } from "./plan-canvas"
import { SuggestionEditDialog } from "./suggestion-edit-dialog"
import { callAction, formatDateCL, formatDateTimeCL } from "./task-card"

export const RELATION_LABELS: Record<Correlation["relation"], string> = {
  mismo_nivel: "Mismo nivel",
  nivel_inferior: "Nivel inferior",
  nivel_superior: "Nivel superior",
}

const KIND_ICONS = {
  create_task: ClipboardPlus,
  plan_elements: Layers,
  update_finding_severity: TriangleAlert,
} as const

const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"

/** Enlace al plano de una sugerencia (hallazgo o capa), o null. */
export function suggestionPlanHref(s: Pick<AiSuggestion, "finding_id" | "layer_id" | "kind">, projectId: number): string | null {
  if (s.finding_id != null) return `/obra/${projectId}/planos?finding=${s.finding_id}`
  if (s.layer_id != null) return `/obra/${projectId}/planos?layer=${s.layer_id}`
  return null
}

/** Mensaje para quien no puede aprobar (o null si sí puede). */
export function reviewBlockedText(role: ObraRole, s: Pick<AiSuggestion, "severity">): string | null {
  if (!can(role, "ai.review")) return "Pendiente de aprobación por gerente, jefe de obra o prevencionista."
  if (s.severity === "critical" && !can(role, "ai.review_critical")) {
    return "Es una sugerencia crítica: debe aprobarla un perfil autorizado para decisiones críticas."
  }
  return null
}

export type SuggestionCardProps = {
  suggestion: AiSuggestion
  role: ObraRole
  projectId: number
  /** Capa de la sugerencia (para revisar elementos sobre su imagen). */
  layer?: PlanLayer | null
  /** Muestra el enlace "Ver en plano". */
  showPlanLink?: boolean
  /** Versión resumida (textos recortados). */
  compact?: boolean
  /** Se llama con la sugerencia actualizada (y el resultado de aplicarla, si se aprobó). */
  onChanged?: (suggestion: AiSuggestion, result?: ApproveSuggestionResult) => void
  className?: string
}

export function SuggestionCard({
  suggestion,
  role,
  projectId,
  layer,
  showPlanLink = false,
  compact = false,
  onChanged,
  className,
}: SuggestionCardProps) {
  const router = useRouter()
  const baseId = useId()
  const [prev, setPrev] = useState(suggestion)
  const [s, setS] = useState(suggestion)
  if (suggestion !== prev) {
    setPrev(suggestion)
    setS(suggestion)
  }
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [expanded, setExpanded] = useState(!compact)

  const pending = s.status === "pending"
  const canReview = pending && canReviewSuggestion(role, s.severity)
  const blocked = pending ? reviewBlockedText(role, s) : null
  const KindIcon = KIND_ICONS[s.kind] ?? ClipboardPlus
  const correlations = Array.isArray(s.evidence?.correlations) ? s.evidence.correlations : []
  const notes = Array.isArray(s.evidence?.notes) ? s.evidence.notes.filter((n) => typeof n === "string" && n.trim()) : []
  const confidence = typeof s.confidence === "number" ? Math.round(s.confidence * 100) : null
  const planHref = showPlanLink ? suggestionPlanHref(s, projectId) : null
  const task = s.payload.kind === "create_task" ? s.payload.data : null
  const severityChange = s.payload.kind === "update_finding_severity" ? s.payload.data : null
  const planElements = s.payload.kind === "plan_elements" ? s.payload.data : null
  const elementCounts = planElements && Array.isArray(planElements.elements) ? countByType(planElements.elements) : []
  const elementTotal = elementCounts.reduce((n, c) => n + c.count, 0)
  const longRationale = (s.rationale ?? "").length > 240
  const working = busy !== null

  function afterApprove(result: ApproveSuggestionResult) {
    const updated = result.suggestion
    setS(updated)
    onChanged?.(updated, result)
    if (updated.kind === "create_task") {
      const ins = result.inspection ?? null
      toast.success(
        ins ? `Tarea anotada en «${ins.title}» (${formatDateCL(ins.scheduled_for)}).` : "Tarea anotada en la próxima revisión.",
        {
          description: updated.title,
          action: {
            label: "Ver tareas",
            onClick: () => router.push(`/obra/${projectId}/tareas${ins ? `?revision=${ins.id}` : ""}`),
          },
        },
      )
    } else if (updated.kind === "plan_elements") {
      const n =
        updated.payload.kind === "plan_elements" && Array.isArray(updated.payload.data.elements)
          ? updated.payload.data.elements.length
          : 0
      toast.success(`Se incorporaron ${n} elemento${n === 1 ? "" : "s"} al plano.`, {
        action:
          updated.layer_id != null
            ? { label: "Ver plano", onClick: () => router.push(`/obra/${projectId}/planos?layer=${updated.layer_id}`) }
            : undefined,
      })
    } else {
      const to = updated.payload.kind === "update_finding_severity" ? updated.payload.data.to : null
      toast.success(to ? `Severidad del hallazgo actualizada a «${SEVERITY_LABELS[to]}».` : "Cambio de severidad aplicado.")
    }
  }

  async function approve() {
    setBusy("approve")
    const res = await callAction(() => approveObraSuggestion(s.id))
    setBusy(null)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    afterApprove(res.data)
  }

  async function reject() {
    setBusy("reject")
    const res = await callAction(() => rejectObraSuggestion(s.id, reason.trim() || undefined))
    setBusy(null)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    setS(res.data)
    setRejectOpen(false)
    setReason("")
    onChanged?.(res.data)
    toast.success("Sugerencia descartada. Quedó registrada en la auditoría.")
  }

  const spinner = <Loader2 className="h-4 w-4 animate-spin" aria-hidden />

  return (
    <article
      aria-labelledby={`${baseId}-title`}
      className={cn(
        "rounded-[14px] border bg-card p-3.5",
        pending && s.severity === "critical" ? "border-sev-critical/50" : "border-border",
        s.status === "superseded" && "opacity-75",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn(chip, "bg-secondary text-foreground")}>
          <KindIcon className="h-3 w-3" aria-hidden />
          {SUGGESTION_KIND_LABELS[s.kind] ?? s.kind}
        </span>
        <SuggestionStatusBadge status={s.status} />
        <GeneratorBadge generator={s.generator} />
        {task ? <PriorityBadge priority={task.priority} /> : <SeverityBadge severity={s.severity} />}
        {confidence != null ? (
          <span className={cn(chip, "border border-border text-muted-foreground")} title="Confianza de la sugerencia">
            Confianza {confidence} %
          </span>
        ) : null}
      </div>

      <h3 id={`${baseId}-title`} className="mt-2 break-words font-display text-[15px] font-semibold leading-snug">
        {s.title}
      </h3>

      {s.rationale ? (
        <div className="mt-1.5">
          <p
            className={cn(
              "whitespace-pre-line break-words text-[13px] text-muted-foreground",
              !expanded && longRationale && "line-clamp-3",
            )}
          >
            {s.rationale}
          </p>
          {longRationale ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 min-h-8 text-[12.5px] font-semibold text-[#b8841a] outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-expanded={expanded}
            >
              {expanded ? "Ver menos" : "Ver más"}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Qué se aplicaría */}
      {task ? (
        <ul className="mt-2.5 space-y-1 text-[12.5px] text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">Responsable sugerido: </span>
            {task.assigned_role ? OBRA_ROLE_LABELS[task.assigned_role] : "sin definir"}
          </li>
          <li>
            <span className="font-semibold text-foreground">Plazo: </span>
            {task.due_in_days === 0 ? "hoy mismo" : `${task.due_in_days} día${task.due_in_days === 1 ? "" : "s"} desde la aprobación`}
          </li>
          {Array.isArray(task.checklist) && task.checklist.length > 0 ? (
            <li>
              <details className="group">
                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 font-semibold text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  Checklist ({task.checklist.length} ítem{task.checklist.length === 1 ? "" : "s"})
                  <span className="text-muted-foreground group-open:hidden">· ver</span>
                </summary>
                <ol className="ml-5 list-decimal space-y-0.5 pb-1">
                  {task.checklist.map((item, i) => (
                    <li key={`${i}-${item}`} className="break-words">
                      {item}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ) : null}
        </ul>
      ) : null}

      {severityChange ? (
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground">Severidad del hallazgo:</span>
          <SeverityBadge severity={severityChange.from} />
          <span aria-hidden>→</span>
          <span className="sr-only">pasa a</span>
          <SeverityBadge severity={severityChange.to} />
        </p>
      ) : null}

      {planElements ? (
        <div className="mt-2.5 space-y-2">
          <ul className="flex flex-wrap gap-1.5" aria-label="Elementos propuestos por tipo">
            {elementCounts.map((c) => (
              <li key={c.type} className={cn(chip, "border border-border bg-card text-foreground")}>
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: elementColor({ element_type: c.type }, layer ?? null) }}
                  aria-hidden
                />
                {ELEMENT_TYPE_LABELS[c.type] ?? c.type}: {c.count}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="h-10 rounded-[10px]" onClick={() => setReviewOpen(true)}>
            <Layers className="h-4 w-4" aria-hidden />
            {canReview ? `Revisar los ${elementTotal} elementos` : "Ver elementos propuestos"}
          </Button>
        </div>
      ) : null}

      {/* Evidencia verificable */}
      {correlations.length > 0 ? (
        <div className="mt-3 rounded-[10px] bg-secondary/60 px-3 py-2">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Evidencia en planos</p>
          <ul className="mt-1 space-y-1.5">
            {correlations.slice(0, compact ? 2 : 5).map((c) => (
              <li key={`${c.element_id}-${c.rule_id}`} className="flex gap-2 text-[12.5px]">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: DISCIPLINE_COLORS[c.discipline] ?? DISCIPLINE_COLORS.otro }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="break-words">{describeCorrelation(c)}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {DISCIPLINE_LABELS[c.discipline] ?? c.discipline} · {RELATION_LABELS[c.relation] ?? c.relation} ·{" "}
                    {formatDistanceCl(c.distance_m)} en planta
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[12px] italic text-muted-foreground">
          {notes.slice(0, 3).map((n) => (
            <li key={n} className="break-words">
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Estado de la revisión */}
      {s.status === "approved" ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-[10px] bg-success-tint px-2.5 py-2 text-[12.5px]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 break-words">
            Aprobada por {s.reviewed_by_name || "un revisor"}
            {s.reviewed_at ? ` el ${formatDateTimeCL(s.reviewed_at)}` : ""}.
            {s.review_notes ? <span className="block text-muted-foreground">Nota: {s.review_notes}</span> : null}
            {s.applied_entity_type === "task" ? (
              <Link href={`/obra/${projectId}/tareas`} className="mt-0.5 block font-semibold text-[#b8841a] hover:underline">
                Ver la tarea creada
              </Link>
            ) : null}
          </span>
        </p>
      ) : null}
      {s.status === "rejected" ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-[10px] bg-danger-tint px-2.5 py-2 text-[12.5px]">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
          <span className="min-w-0 break-words">
            Descartada por {s.reviewed_by_name || "un revisor"}
            {s.reviewed_at ? ` el ${formatDateTimeCL(s.reviewed_at)}` : ""}.
            {s.review_notes ? <span className="block text-muted-foreground">Motivo: {s.review_notes}</span> : null}
          </span>
        </p>
      ) : null}
      {s.status === "superseded" ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Se reemplazó por un análisis más reciente del mismo hallazgo o capa. No requiere acción.
        </p>
      ) : null}

      {/* Acciones */}
      {pending ? (
        canReview ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              type="button"
              className="h-10 w-full rounded-[10px] sm:w-auto"
              disabled={working}
              onClick={approve}
            >
              {busy === "approve" ? spinner : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {s.kind === "create_task" ? "Anotar en tareas de la próxima revisión" : "Aprobar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-[10px]"
              disabled={working}
              onClick={() => (s.kind === "plan_elements" ? setReviewOpen(true) : setEditOpen(true))}
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Editar y aprobar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-[10px] text-danger hover:text-danger"
              disabled={working}
              onClick={() => setRejectOpen(true)}
            >
              <XCircle className="h-4 w-4" aria-hidden />
              Descartar
            </Button>
            {planHref ? <PlanLink href={planHref} /> : null}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <p className="flex min-w-0 flex-1 items-start gap-1.5 text-[12.5px] text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {blocked}
            </p>
            {planHref ? <PlanLink href={planHref} /> : null}
          </div>
        )
      ) : planHref ? (
        <div className="mt-2 flex justify-end">
          <PlanLink href={planHref} />
        </div>
      ) : null}

      {s.kind !== "plan_elements" ? (
        <SuggestionEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          suggestion={s}
          role={role}
          onApproved={afterApprove}
        />
      ) : (
        <ExtractionReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          suggestion={s}
          layer={layer ?? null}
          canReview={canReview}
          onApproved={afterApprove}
        />
      )}

      <Dialog open={rejectOpen} onOpenChange={(o) => !working && setRejectOpen(o)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>¿Descartar esta sugerencia?</DialogTitle>
            <DialogDescription className="break-words">
              «{s.title}» no se aplicará. La decisión queda registrada en la auditoría.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${baseId}-reason`}>Motivo (opcional)</Label>
            <Textarea
              id={`${baseId}-reason`}
              value={reason}
              maxLength={1000}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: La tubería ya fue reparada la semana pasada."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-10" disabled={working} onClick={() => setRejectOpen(false)}>
              Volver
            </Button>
            <Button type="button" variant="destructive" className="h-10" disabled={working} onClick={reject}>
              {busy === "reject" ? spinner : <XCircle className="h-4 w-4" aria-hidden />}
              Descartar sugerencia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

function PlanLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-[#b8841a] outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <MapPin className="h-4 w-4" aria-hidden />
      Ver en plano
    </Link>
  )
}
