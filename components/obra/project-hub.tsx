"use client"

/**
 * Hub de Obra integral (/obra): tarjetas de cada obra donde el usuario es
 * dueño o integrante, con su rol y los indicadores que le importan.
 */
import Link from "next/link"
import { CalendarCheck, ChevronRight, ClipboardList, FolderPlus, HardHat, ShieldCheck, TriangleAlert } from "lucide-react"
import { can } from "@/lib/obra/permissions"
import type { ObraProjectSummary } from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { RoleBadge } from "./badges"
import { formatDateCL } from "./task-card"

export function ProjectHub({ projects, today }: { projects: ObraProjectSummary[]; today: string }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">Obra integral</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Tareas, revisiones, planos por especialidad y aprobaciones de IA de cada obra en la que participas.
          </p>
        </div>
        {projects.length > 0 ? (
          <Link
            href="/proyectos"
            className="inline-flex h-10 items-center gap-2 rounded-[11px] border border-border bg-card px-4 text-[13px] font-semibold outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <FolderPlus className="h-4 w-4" aria-hidden />
            Crear o administrar obras
          </Link>
        ) : null}
      </div>

      {projects.length === 0 ? (
        <EmptyHub />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <li key={p.project_id} className="min-w-0">
              <ProjectCard project={p} today={today} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProjectCard({ project: p, today }: { project: ObraProjectSummary; today: string }) {
  const role = p.role
  // Sin ai.review el servidor envía pending_suggestions = 0 y el indicador no se muestra.
  const showApprovals = can(role, "ai.review")
  const showFindings = can(role, "findings.view")
  return (
    <Link
      href={`/obra/${p.project_id}`}
      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-[18px] outline-none transition-all hover:-translate-y-0.5 hover:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label={`Entrar a la obra ${p.project_name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-display text-[17px] font-semibold tracking-[-0.01em]">{p.project_name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RoleBadge role={role} />
            {p.is_owner ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                Dueño
              </span>
            ) : null}
          </div>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-secondary" aria-hidden>
          <HardHat className="h-5 w-5 text-muted-foreground" />
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="mis tareas" value={p.my_open_tasks} />
        <Stat label="abiertas" value={p.open_tasks} />
        <Stat label="vencidas" value={p.overdue_tasks} danger={p.overdue_tasks > 0} />
      </dl>

      <ul className="mt-3 space-y-1.5 text-[13px]">
        {showApprovals ? (
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn(p.pending_suggestions > 0 ? "font-semibold" : "text-muted-foreground")}>
              {p.pending_suggestions === 0
                ? "Sin aprobaciones pendientes"
                : `${p.pending_suggestions} aprobaci${p.pending_suggestions === 1 ? "ón pendiente" : "ones pendientes"}`}
            </span>
          </li>
        ) : null}
        {showFindings ? (
          <li className="flex items-center gap-2">
            <TriangleAlert
              className={cn("h-4 w-4 shrink-0", p.critical_findings > 0 ? "text-danger" : "text-muted-foreground")}
              aria-hidden
            />
            <span className={cn(p.critical_findings > 0 ? "font-semibold text-danger" : "text-muted-foreground")}>
              {p.critical_findings} hallazgo{p.critical_findings === 1 ? "" : "s"} crítico{p.critical_findings === 1 ? "" : "s"}
              <span className="font-normal text-muted-foreground"> · {p.open_findings} abierto{p.open_findings === 1 ? "" : "s"}</span>
            </span>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">
            {p.next_inspection_date
              ? `Próxima revisión: ${formatDateCL(p.next_inspection_date)}${p.next_inspection_date === today ? " (hoy)" : ""}`
              : "Sin revisión programada"}
          </span>
        </li>
      </ul>

      <span className="mt-auto flex items-center gap-1 pt-4 text-[13px] font-semibold text-[#b8841a]">
        <ClipboardList className="h-4 w-4" aria-hidden />
        Entrar a la obra
        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  )
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex flex-col-reverse rounded-[10px] bg-secondary/70 px-2.5 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("font-display text-[19px] font-bold leading-tight", danger && "text-danger")}>{value}</dd>
    </div>
  )
}

function EmptyHub() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-[16px] bg-secondary">
        <HardHat className="h-7 w-7 text-muted-foreground" aria-hidden />
      </span>
      <p className="font-display text-lg font-semibold">Todavía no participas en ninguna obra</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Si trabajas en una obra, pide a su administrador que te agregue al equipo con tu correo. Apenas lo haga, la obra
        aparecerá aquí.
      </p>
      <p className="mt-4 max-w-md text-sm text-muted-foreground">¿Eres responsable de una obra? Créala en Proyectos.</p>
      <Link
        href="/proyectos"
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-[11px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <FolderPlus className="h-4 w-4" aria-hidden />
        Ir a Proyectos
      </Link>
    </div>
  )
}
