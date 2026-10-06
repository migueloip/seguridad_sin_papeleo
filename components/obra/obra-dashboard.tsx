"use client"

/**
 * Resumen de una obra según el rol (/obra/[projectId]).
 *
 * Mismo contenido para todos, distinto orden y énfasis:
 * - Gerente: primero el índice de riesgo y las aprobaciones (críticas arriba).
 * - Jefe de obra / Prevencionista: primero aprobaciones y próxima revisión.
 * - Supervisor: reportar hallazgo, sus tareas y la próxima revisión.
 * - Trabajador: botón grande para reportar y "Mis tareas".
 * - Visita / ITO: lectura de indicadores y auditoría.
 */
import Link from "next/link"
import { Fragment, type ReactNode } from "react"
import {
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Gauge,
  History,
  Layers,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  UsersRound,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { RISK_LEVEL_LABELS, todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import {
  SEVERITY_LABELS,
  SUGGESTION_KIND_LABELS,
  TASK_STATUS_LABELS,
  type ObraDashboard,
  type ObraRole,
  type RiskLevel,
  type Severity,
  type TaskStatus,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { AuditItem } from "./audit-content"
import { GeneratorBadge, SeverityBadge } from "./badges"
import { InspectionStatusBadge, inspectionWhen } from "./inspections-content"
import { formatDateCL, TaskCard, TimeAgo } from "./task-card"

type SectionKey =
  | "report"
  | "kpis"
  | "risk"
  | "approvals"
  | "next_inspection"
  | "my_tasks"
  | "findings"
  | "tasks_status"
  | "activity"

/** Filas por rol (cada fila: 1 o 2 secciones; en pantallas grandes van lado a lado). */
const LAYOUTS: Record<ObraRole, SectionKey[][]> = {
  gerente: [["risk", "approvals"], ["kpis"], ["findings", "tasks_status"], ["activity", "next_inspection"], ["my_tasks"]],
  jefe_obra: [["approvals", "next_inspection"], ["kpis"], ["tasks_status", "risk"], ["my_tasks", "findings"], ["activity"]],
  prevencionista: [["approvals", "next_inspection"], ["kpis"], ["findings", "tasks_status"], ["my_tasks", "risk"], ["activity"]],
  supervisor: [["report"], ["my_tasks", "next_inspection"], ["kpis"], ["tasks_status", "findings"], ["risk"]],
  trabajador: [["report"], ["my_tasks"], ["next_inspection"]],
  visita: [["kpis"], ["risk", "findings"], ["tasks_status", "next_inspection"], ["activity"]],
}

const ROLE_HINTS: Record<ObraRole, string> = {
  gerente: "Riesgo de la obra, decisiones pendientes y avance del equipo.",
  jefe_obra: "Aprobaciones pendientes, próxima revisión y avance de las tareas.",
  prevencionista: "Aprobaciones pendientes, próxima revisión y hallazgos abiertos.",
  supervisor: "Tus tareas, las de la obra y la próxima revisión.",
  trabajador: "Tus tareas de hoy y cómo avisar si ves algo peligroso.",
  visita: "Indicadores de seguridad y actividad de la obra (solo lectura).",
}

const RISK_COLORS: Record<RiskLevel, { color: string; tint: string }> = {
  bajo: { color: "var(--success)", tint: "var(--success-tint)" },
  medio: { color: "var(--sev-medium)", tint: "var(--sev-medium-tint)" },
  alto: { color: "var(--sev-high)", tint: "var(--sev-high-tint)" },
  critico: { color: "var(--danger)", tint: "var(--danger-tint)" },
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"]
const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "var(--sev-critical)",
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
}

const STATUS_ORDER: TaskStatus[] = ["pendiente", "en_progreso", "hecha", "cancelada"]
const STATUS_COLORS: Record<TaskStatus, string> = {
  pendiente: "var(--muted-foreground)",
  en_progreso: "var(--warning)",
  hecha: "var(--success)",
  cancelada: "var(--border)",
}

const linkCls =
  "inline-flex min-h-10 items-center gap-1 rounded-[10px] px-2 text-[13px] font-semibold text-[#b8841a] outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"

export function ObraDashboardContent({ dashboard, today: todayProp }: { dashboard: ObraDashboard; today?: string }) {
  const today = todayProp ?? todayISO()
  const { access } = dashboard
  const role = access.role
  const pid = access.project_id
  const base = `/obra/${pid}`

  const visible = (k: SectionKey): boolean => {
    if (k === "report") return can(role, "findings.report")
    if (k === "approvals") return can(role, "ai.review")
    if (k === "activity") return can(role, "audit.view")
    if (k === "findings") return can(role, "findings.view")
    return true
  }

  const sections: Record<SectionKey, () => ReactNode> = {
    report: () => <ReportCta href={`${base}/planos?reportar=1`} />,
    kpis: () => <Kpis dashboard={dashboard} base={base} />,
    risk: () => <RiskPanel dashboard={dashboard} />,
    approvals: () => <ApprovalsPanel dashboard={dashboard} base={base} />,
    next_inspection: () => <NextInspectionPanel dashboard={dashboard} base={base} today={today} />,
    my_tasks: () => <MyTasksPanel dashboard={dashboard} base={base} today={today} />,
    findings: () => <FindingsPanel dashboard={dashboard} base={base} />,
    tasks_status: () => <TasksStatusPanel dashboard={dashboard} base={base} />,
    activity: () => <ActivityPanel dashboard={dashboard} base={base} />,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">Resumen</h2>
          <p className="text-sm text-muted-foreground">{ROLE_HINTS[role]}</p>
        </div>
        {can(role, "findings.report") && role !== "trabajador" && role !== "supervisor" ? (
          <Link
            href={`${base}/planos?reportar=1`}
            className="inline-flex h-10 items-center gap-2 rounded-[11px] border border-border bg-card px-4 text-[13px] font-semibold outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <TriangleAlert className="h-4 w-4 text-danger" aria-hidden />
            Reportar hallazgo en el plano
          </Link>
        ) : null}
      </div>

      {LAYOUTS[role].map((row, i) => {
        const keys = row.filter(visible)
        if (keys.length === 0) return null
        return (
          <div key={i} className={cn("grid items-start gap-4", keys.length > 1 && "lg:grid-cols-2")}>
            {keys.map((k) => (
              <Fragment key={k}>{sections[k]()}</Fragment>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function Panel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className,
  labelId,
}: {
  title: string
  subtitle?: string
  icon?: LucideIcon
  action?: ReactNode
  children: ReactNode
  className?: string
  labelId: string
}) {
  return (
    <section aria-labelledby={labelId} className={cn("min-w-0 rounded-2xl border border-border bg-card p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={labelId} className="flex items-center gap-2 font-display text-base font-semibold">
            {Icon ? <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> : null}
            {title}
          </h3>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function ReportCta({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="group relative flex min-h-[84px] items-center gap-4 overflow-hidden rounded-2xl bg-primary p-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <span
        className="absolute inset-0"
        aria-hidden
        style={{ backgroundImage: "repeating-linear-gradient(135deg,rgba(243,164,10,.08) 0 16px,transparent 16px 32px)" }}
      />
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-brand">
        <TriangleAlert className="h-6 w-6 text-primary" aria-hidden />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block font-display text-lg font-bold leading-tight text-white">Reportar una condición insegura</span>
        <span className="block text-sm text-white/65">Marca el lugar en el plano, describe lo que viste y agrega una foto.</span>
      </span>
      <ChevronRight className="relative h-6 w-6 shrink-0 text-brand transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

function KpiCard({
  title,
  value,
  footer,
  accent,
  icon: Icon,
  href,
}: {
  title: string
  value: number
  footer: ReactNode
  accent: string
  icon: LucideIcon
  href?: string
}) {
  const body = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
        <Icon className="h-[18px] w-[18px]" style={{ color: accent }} aria-hidden />
      </div>
      <div className="font-display text-[30px] font-bold leading-none tracking-[-0.02em]">{value}</div>
      <div className="mt-1.5 text-xs">{footer}</div>
      <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: accent }} aria-hidden />
    </>
  )
  const cls =
    "relative block overflow-hidden rounded-2xl border border-border bg-card p-[18px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-brand/60")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function Kpis({ dashboard, base }: { dashboard: ObraDashboard; base: string }) {
  const { counts, access, findings_by_severity: fbs } = dashboard
  const role = access.role
  const overdue = counts.overdue_tasks
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title={can(role, "tasks.view_all") ? "Tareas abiertas" : "Tareas abiertas para ti"}
        value={counts.open_tasks}
        icon={ClipboardList}
        accent={overdue > 0 ? "var(--danger)" : "var(--brand)"}
        href={`${base}/tareas`}
        footer={
          overdue > 0 ? (
            <span className="font-semibold text-danger">
              {overdue} vencida{overdue === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-success">Ninguna vencida</span>
          )
        }
      />
      <KpiCard
        title="Mis tareas"
        value={counts.my_open_tasks}
        icon={UserRound}
        accent="var(--brand)"
        href={`${base}/tareas?mine=1`}
        footer={<span className="text-muted-foreground">asignadas a ti o a tu rol</span>}
      />
      {can(role, "findings.view") ? (
        <KpiCard
          title="Hallazgos abiertos"
          value={counts.open_findings}
          icon={TriangleAlert}
          accent={fbs.critical > 0 ? "var(--danger)" : "var(--warning)"}
          href={`${base}/planos`}
          footer={
            <span className={fbs.critical > 0 ? "font-semibold text-danger" : "text-muted-foreground"}>
              {fbs.critical} crítico{fbs.critical === 1 ? "" : "s"} · {counts.pinned_findings} en el plano
            </span>
          }
        />
      ) : (
        <KpiCard
          title="Planos de la obra"
          value={counts.layers}
          icon={Layers}
          accent="var(--chart-3)"
          href={`${base}/planos`}
          footer={<span className="text-muted-foreground">{counts.elements} elementos dibujados</span>}
        />
      )}
      {/* Solo quien decide las sugerencias (ai.review) ve su conteo: para los demás el servidor envía 0. */}
      {can(role, "ai.review") ? (
        <KpiCard
          title="Aprobaciones IA pendientes"
          value={counts.pending_suggestions}
          icon={ShieldCheck}
          accent={counts.pending_critical_suggestions > 0 ? "var(--danger)" : "var(--chart-2)"}
          href={`${base}/aprobaciones`}
          footer={
            counts.pending_critical_suggestions > 0 ? (
              <span className="font-semibold text-danger">
                {counts.pending_critical_suggestions} crítica{counts.pending_critical_suggestions === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="text-muted-foreground">ninguna crítica</span>
            )
          }
        />
      ) : (
        <KpiCard
          title="Equipo"
          value={counts.members}
          icon={UsersRound}
          accent="var(--chart-2)"
          href={`${base}/equipo`}
          footer={<span className="text-muted-foreground">personas con acceso</span>}
        />
      )}
    </div>
  )
}

function RiskPanel({ dashboard }: { dashboard: ObraDashboard }) {
  const { risk, findings_by_severity: fbs, counts, access } = dashboard
  const c = RISK_COLORS[risk.level] ?? RISK_COLORS.medio
  const score = Math.max(0, Math.min(100, Math.round(risk.score)))
  return (
    <Panel
      labelId="dash-risk"
      title="Índice de riesgo"
      icon={Gauge}
      subtitle="De 0 a 100, según hallazgos abiertos, tareas vencidas y aprobaciones críticas pendientes."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="font-display text-[46px] font-bold leading-none tracking-[-0.03em]" style={{ color: c.color }}>
          {score}
        </div>
        <span
          className="mb-1 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: c.tint, color: c.color }}
        >
          Riesgo {RISK_LEVEL_LABELS[risk.level]?.toLowerCase() ?? risk.level}
        </span>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label={`Índice de riesgo ${score} de 100, nivel ${RISK_LEVEL_LABELS[risk.level] ?? risk.level}`}
      >
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: c.color }} />
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
        <RiskFactor label="Hallazgos críticos" value={fbs.critical} danger={fbs.critical > 0} />
        <RiskFactor label="Hallazgos altos" value={fbs.high} danger={fbs.high > 0} />
        {can(access.role, "tasks.view_all") ? (
          <RiskFactor label="Tareas vencidas" value={counts.overdue_tasks} danger={counts.overdue_tasks > 0} />
        ) : null}
        {can(access.role, "ai.review") ? (
          <RiskFactor
            label="Aprobaciones críticas"
            value={counts.pending_critical_suggestions}
            danger={counts.pending_critical_suggestions > 0}
          />
        ) : null}
      </ul>
    </Panel>
  )
}

function RiskFactor({ label, value, danger }: { label: string; value: number; danger: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-[10px] bg-secondary/70 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", danger && "text-danger")}>{value}</span>
    </li>
  )
}

function ApprovalsPanel({ dashboard, base }: { dashboard: ObraDashboard; base: string }) {
  const { pending_suggestions: list, counts } = dashboard
  const critical = counts.pending_critical_suggestions
  return (
    <Panel
      labelId="dash-approvals"
      title="Aprobaciones pendientes"
      icon={ShieldCheck}
      subtitle="Ninguna sugerencia de IA se aplica sin que una persona la apruebe."
      action={
        counts.pending_suggestions > 0 ? (
          <Link href={`${base}/aprobaciones`} className={linkCls}>
            Ver todas ({counts.pending_suggestions})
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null
      }
    >
      {critical > 0 ? (
        <p className="mb-3 flex items-center gap-2 rounded-[10px] bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger" role="status">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          {critical === 1 ? "Hay 1 sugerencia crítica esperando revisión." : `Hay ${critical} sugerencias críticas esperando revisión.`}
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          No hay sugerencias por revisar. Cuando se reporte un hallazgo cerca de una instalación del plano, aquí aparecerán
          las tareas sugeridas para aprobar.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((s) => (
            <li
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-[12px] border p-3",
                s.severity === "critical" ? "border-danger/40 bg-danger-tint/40" : "border-border",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold">{s.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <SeverityBadge severity={s.severity} />
                  <GeneratorBadge generator={s.generator} />
                  <span className="text-[11px] text-muted-foreground">
                    {SUGGESTION_KIND_LABELS[s.kind] ?? s.kind} · <TimeAgo iso={s.created_at} />
                  </span>
                </div>
              </div>
              <Link
                href={`${base}/aprobaciones`}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={`Revisar sugerencia: ${s.title}`}
              >
                Revisar
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function NextInspectionPanel({ dashboard, base, today }: { dashboard: ObraDashboard; base: string; today: string }) {
  const i = dashboard.next_inspection
  const canManage = can(dashboard.access.role, "inspections.manage")
  const done = i ? i.task_count - i.open_task_count : 0
  const pct = i && i.task_count > 0 ? Math.round((done / i.task_count) * 100) : 0
  return (
    <Panel
      labelId="dash-next-inspection"
      title={i?.status === "en_curso" ? "Revisión en curso" : "Próxima revisión"}
      icon={CalendarCheck}
      action={
        <Link href={`${base}/revisiones`} className={linkCls}>
          Revisiones
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      {i ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words font-display text-lg font-semibold">{i.title}</p>
            <InspectionStatusBadge inspection={i} today={today} />
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {formatDateCL(i.scheduled_for)} · {inspectionWhen(i.scheduled_for, today)}
            {i.lead_user_name ? ` · Responsable: ${i.lead_user_name}` : ""}
          </p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-bold">{i.open_task_count}</span>
            <span className="text-sm text-muted-foreground">
              tarea{i.open_task_count === 1 ? "" : "s"} abierta{i.open_task_count === 1 ? "" : "s"} de {i.task_count}
            </span>
          </div>
          {i.task_count > 0 ? (
            <Progress value={pct} className="mt-2 h-1.5 bg-secondary" aria-label={`${done} de ${i.task_count} tareas cerradas`} />
          ) : null}
          <Link href={`${base}/tareas?revision=${i.id}`} className={cn(linkCls, "mt-2 -ml-2")}>
            Ver sus tareas
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          <p>No hay revisiones programadas.</p>
          {canManage ? (
            <Link href={`${base}/revisiones`} className={cn(linkCls, "mt-1")}>
              Programar una revisión
            </Link>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

function MyTasksPanel({ dashboard, base, today }: { dashboard: ObraDashboard; base: string; today: string }) {
  const { my_tasks: tasks, counts, access } = dashboard
  const worker = access.role === "trabajador"
  return (
    <Panel
      labelId="dash-my-tasks"
      title="Mis tareas"
      icon={UserRound}
      subtitle="Asignadas a ti o a tu rol."
      action={
        counts.my_open_tasks > 0 ? (
          <Link href={`${base}/tareas?mine=1`} className={linkCls}>
            Ver todas ({counts.my_open_tasks})
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null
      }
    >
      {tasks.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          No tienes tareas abiertas.
          {worker ? " Si ves algo peligroso en la obra, repórtalo en el plano." : ""}
        </p>
      ) : (
        <div className={cn("grid gap-2.5", !worker && "xl:grid-cols-2")}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} role={access.role} currentUserId={access.user_id} today={today} compact />
          ))}
        </div>
      )}
    </Panel>
  )
}

function FindingsPanel({ dashboard, base }: { dashboard: ObraDashboard; base: string }) {
  const fbs = dashboard.findings_by_severity
  const total = SEVERITY_ORDER.reduce((acc, s) => acc + (fbs[s] ?? 0), 0)
  const max = Math.max(1, ...SEVERITY_ORDER.map((s) => fbs[s] ?? 0))
  return (
    <Panel
      labelId="dash-findings"
      title="Hallazgos abiertos por severidad"
      icon={TriangleAlert}
      subtitle={`${total} abierto${total === 1 ? "" : "s"} · ${dashboard.counts.pinned_findings} ubicado${dashboard.counts.pinned_findings === 1 ? "" : "s"} en el plano`}
      action={
        <Link href={`${base}/planos`} className={linkCls}>
          Ver en planos
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      {total === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          No hay hallazgos abiertos.
        </p>
      ) : (
        <ul className="space-y-3">
          {SEVERITY_ORDER.map((s) => {
            const n = fbs[s] ?? 0
            return (
              <li key={s}>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <span className="font-medium">{SEVERITY_LABELS[s]}</span>
                  <span className="font-semibold" style={{ color: n > 0 ? SEVERITY_COLORS[s] : undefined }}>
                    {n}
                  </span>
                </div>
                <div className="h-[7px] overflow-hidden rounded-md bg-secondary" aria-hidden>
                  <div
                    className="h-full rounded-md transition-all"
                    style={{ width: `${Math.round((n / max) * 100)}%`, background: SEVERITY_COLORS[s] }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function TasksStatusPanel({ dashboard, base }: { dashboard: ObraDashboard; base: string }) {
  const tbs = dashboard.tasks_by_status
  const total = STATUS_ORDER.reduce((acc, s) => acc + (tbs[s] ?? 0), 0)
  return (
    <Panel
      labelId="dash-tasks-status"
      title={can(dashboard.access.role, "tasks.view_all") ? "Tareas de la obra" : "Tus tareas por estado"}
      icon={ClipboardList}
      subtitle={`${total} tarea${total === 1 ? "" : "s"} en total`}
      action={
        <Link href={`${base}/tareas`} className={linkCls}>
          Ir al tablero
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      {total === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          Aún no hay tareas.
        </p>
      ) : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-secondary" aria-hidden>
            {STATUS_ORDER.map((s) =>
              (tbs[s] ?? 0) > 0 ? (
                <div key={s} style={{ width: `${((tbs[s] ?? 0) / total) * 100}%`, background: STATUS_COLORS[s] }} />
              ) : null,
            )}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
            {STATUS_ORDER.map((s) => (
              <li key={s} className="flex items-center gap-2 rounded-[10px] bg-secondary/70 px-3 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: STATUS_COLORS[s] }} aria-hidden />
                <span className="text-muted-foreground">{TASK_STATUS_LABELS[s]}</span>
                <span className="ml-auto font-semibold">{tbs[s] ?? 0}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

function ActivityPanel({ dashboard, base }: { dashboard: ObraDashboard; base: string }) {
  const list = dashboard.recent_activity
  return (
    <Panel
      labelId="dash-activity"
      title="Actividad reciente"
      icon={History}
      action={
        <Link href={`${base}/auditoria`} className={linkCls}>
          Auditoría
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      {list.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          Todavía no hay actividad registrada.
        </p>
      ) : (
        <ol className="space-y-3.5">
          {list.map((e) => (
            <li key={e.id}>
              <AuditItem entry={e} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
