"use client"

/**
 * Bandeja de aprobaciones de IA (/obra/[id]/aprobaciones): sugerencias
 * pendientes, aprobadas, rechazadas o todas, filtrables por tipo y ordenadas
 * con las críticas primero. Cada una se aprueba, se edita y aprueba o se
 * descarta desde su tarjeta (SuggestionCard), con enlace al plano.
 */
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Inbox, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react"
import { listObraSuggestions } from "@/app/actions/obra/suggestions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { can } from "@/lib/obra/permissions"
import {
  SUGGESTION_KIND_LABELS,
  SUGGESTION_KINDS,
  type AiSuggestion,
  type ObraRole,
  type PlanLayer,
  type Severity,
  type SuggestionKind,
  type SuggestionStatus,
} from "@/lib/obra/types"
import { SuggestionCard } from "./suggestion-card"
import { callAction } from "./task-card"

type Tab = "pending" | "approved" | "rejected" | "all"

const TABS: { value: Tab; label: string; status: SuggestionStatus[] | undefined }[] = [
  { value: "pending", label: "Pendientes", status: ["pending"] },
  { value: "approved", label: "Aprobadas", status: ["approved"] },
  { value: "rejected", label: "Rechazadas", status: ["rejected"] },
  { value: "all", label: "Todas", status: undefined },
]

const ALL_KINDS = "all"
const LIST_LIMIT = 200
const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }

const EMPTY_TEXT: Record<Tab, string> = {
  pending:
    "No hay sugerencias pendientes. Cuando alguien reporte un hallazgo en el plano o se pida un análisis con IA, las propuestas aparecerán aquí para tu decisión.",
  approved: "Aún no se ha aprobado ninguna sugerencia.",
  rejected: "No hay sugerencias descartadas.",
  all: "Todavía no hay sugerencias en esta obra.",
}

/** Críticas primero; a igual severidad, las más recientes. */
export function sortSuggestions(list: AiSuggestion[]): AiSuggestion[] {
  return [...list].sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id - a.id,
  )
}

export type ApprovalsContentProps = {
  projectId: number
  role: ObraRole
  /** Pendientes cargadas en el servidor. */
  initialSuggestions: AiSuggestion[]
  /** Capas de la obra (para revisar elementos detectados sobre su lámina). */
  layers: PlanLayer[]
}

export function ApprovalsContent({ projectId, role, initialSuggestions, layers }: ApprovalsContentProps) {
  const [tab, setTab] = useState<Tab>("pending")
  const [lists, setLists] = useState<Record<Tab, AiSuggestion[] | null>>({
    pending: initialSuggestions,
    approved: null,
    rejected: null,
    all: null,
  })
  const [loading, setLoading] = useState<Tab | null>(null)
  const [errors, setErrors] = useState<Record<Tab, string | null>>({ pending: null, approved: null, rejected: null, all: null })
  const [kind, setKind] = useState<string>(ALL_KINDS)
  const canReview = can(role, "ai.review")
  const layersById = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers])

  async function load(t: Tab) {
    const def = TABS.find((x) => x.value === t)
    setLoading(t)
    setErrors((prev) => ({ ...prev, [t]: null }))
    const res = await callAction(() =>
      listObraSuggestions(projectId, def?.status ? { status: def.status, limit: LIST_LIMIT } : { limit: LIST_LIMIT }),
    )
    setLoading((cur) => (cur === t ? null : cur))
    if (res.ok === false) {
      toast.error(res.error)
      // Sin lista que mostrar, la pestaña muestra el error y "Reintentar" (no un "Cargando…" eterno).
      setErrors((prev) => ({ ...prev, [t]: res.error }))
      return
    }
    setLists((prev) => ({ ...prev, [t]: res.data }))
  }

  function changeTab(v: string) {
    const t = v as Tab
    setTab(t)
    if (lists[t] === null && loading !== t) void load(t)
  }

  function onChanged(updated: AiSuggestion) {
    // Se actualiza en la pestaña visible (para ver quién decidió) y las demás se recargan al abrirlas.
    setLists((prev) => {
      const next: Record<Tab, AiSuggestion[] | null> = { pending: null, approved: null, rejected: null, all: null }
      for (const t of TABS) {
        if (t.value !== tab) continue
        const list = prev[t.value]
        next[t.value] = list ? list.map((s) => (s.id === updated.id ? updated : s)) : list
      }
      return next
    })
  }

  const pendingCount = lists.pending ? lists.pending.filter((s) => s.status === "pending").length : null
  const criticalPending = lists.pending
    ? lists.pending.filter((s) => s.status === "pending" && s.severity === "critical").length
    : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Aprobaciones de IA</h2>
          <p className="text-sm text-muted-foreground">
            {pendingCount == null
              ? "Revisa lo que proponen la IA y el motor de reglas."
              : pendingCount === 0
                ? "No tienes decisiones pendientes."
                : `${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}`}
            {criticalPending > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-danger">
                  {criticalPending} crítica{criticalPending === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <Button type="button" variant="outline" className="h-10 rounded-[10px]" onClick={() => void load(tab)} disabled={loading !== null}>
          {loading === tab ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          Actualizar
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-[14px] border border-brand/40 bg-brand/10 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#b8841a]" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">Ninguna sugerencia de la IA se aplica sin tu aprobación.</p>
          <p className="text-muted-foreground">
            Cada decisión queda registrada en{" "}
            {can(role, "audit.view") ? (
              <Link href={`/obra/${projectId}/auditoria`} className="font-semibold text-[#b8841a] hover:underline">
                Auditoría
              </Link>
            ) : (
              "Auditoría"
            )}
            .{" "}
            {canReview
              ? "Al aprobar una tarea, se anota en la próxima revisión (la que está en curso o la siguiente programada). Si no hay ninguna, o si la tarea vence antes, se crea una revisión para la fecha que corresponde."
              : "Puedes ver las sugerencias, pero solo el gerente, el jefe de obra o el prevencionista pueden aprobarlas o descartarlas."}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={changeTab} className="gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TabsList className="h-11 w-full overflow-x-auto sm:w-fit">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="h-full px-3">
                {t.label}
                {t.value === "pending" && pendingCount ? (
                  <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                    {pendingCount}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="w-full space-y-1 sm:w-[300px]">
            <Label htmlFor="approvals-kind" className="text-xs text-muted-foreground">
              Tipo de sugerencia
            </Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="approvals-kind" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_KINDS} className="min-h-10">
                  Todos los tipos
                </SelectItem>
                {SUGGESTION_KINDS.map((k) => (
                  <SelectItem key={k} value={k} className="min-h-10">
                    {SUGGESTION_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {TABS.map((t) => {
          const list = lists[t.value]
          const filtered = list ? sortSuggestions(kind === ALL_KINDS ? list : list.filter((s) => s.kind === (kind as SuggestionKind))) : null
          return (
            <TabsContent key={t.value} value={t.value} className="space-y-3">
              {filtered === null && errors[t.value] && loading !== t.value ? (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>No se pudieron cargar las sugerencias</AlertTitle>
                  <AlertDescription>
                    <p>{errors[t.value]}</p>
                    <Button type="button" variant="outline" className="mt-2 h-10" onClick={() => void load(t.value)}>
                      <RefreshCw className="h-4 w-4" aria-hidden />
                      Reintentar
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : filtered === null ? (
                <div
                  className="flex items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 py-10 text-sm text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Cargando sugerencias…
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-card px-5 py-12 text-center">
                  <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] bg-secondary">
                    <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
                  </span>
                  <p className="max-w-lg text-sm text-muted-foreground">
                    {kind !== ALL_KINDS && list && list.length > 0
                      ? "No hay sugerencias de este tipo en esta pestaña."
                      : EMPTY_TEXT[t.value]}
                  </p>
                  {t.value === "pending" ? (
                    <Button asChild variant="outline" className="mt-4 h-10">
                      <Link href={`/obra/${projectId}/planos`}>Ir a los planos</Link>
                    </Button>
                  ) : null}
                </div>
              ) : (
                <>
                  {list && list.length >= LIST_LIMIT ? (
                    <p className="text-[12.5px] text-muted-foreground">
                      Se muestran las {LIST_LIMIT} más recientes.
                    </p>
                  ) : null}
                  <div className="grid gap-3 xl:grid-cols-2">
                    {filtered.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        suggestion={s}
                        role={role}
                        projectId={projectId}
                        layer={s.layer_id != null ? layersById.get(s.layer_id) ?? null : null}
                        showPlanLink
                        onChanged={onChanged}
                      />
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
