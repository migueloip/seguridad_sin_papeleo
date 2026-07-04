"use client"

import Link from "next/link"
import { ShieldCheck, TriangleAlert, Clock, Plus, FileText, TrendingUp } from "lucide-react"
import type { DashboardStats } from "@/app/actions/dashboard"
import { FindingsChart } from "./findings-chart"

interface DashboardContentProps {
  stats: DashboardStats
  userName?: string | null
  projectName?: string | null
}

const SEV: Record<string, { label: string; color: string; tint: string }> = {
  critical: { label: "Crítico", color: "var(--sev-critical)", tint: "var(--sev-critical-tint)" },
  high: { label: "Alto", color: "var(--sev-high)", tint: "var(--sev-high-tint)" },
  medium: { label: "Medio", color: "var(--sev-medium)", tint: "var(--sev-medium-tint)" },
  low: { label: "Bajo", color: "var(--sev-low)", tint: "var(--sev-low-tint)" },
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"
}

function fmtDate(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })
}

export function DashboardContent({ stats, userName, projectName }: DashboardContentProps) {
  const openFindings = stats.findings.open + stats.findings.in_progress
  const compliance =
    stats.documents.total > 0
      ? Math.round((stats.documents.valid / stats.documents.total) * 100)
      : 100
  const maxRisk = Math.max(...stats.riskByLocation.map((r) => r.score), 1)

  return (
    <div className="space-y-[18px]">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">
            {greeting()}, {userName || "Usuario"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Estado general de seguridad{projectName ? ` · ${projectName}` : ""}
          </p>
        </div>
        <div className="flex gap-2.5">
          <Link
            href="/hallazgos"
            className="flex h-10 items-center gap-2 rounded-[11px] border border-border bg-card px-[15px] text-[13px] font-semibold transition-colors hover:bg-secondary"
          >
            <Plus className="h-4 w-4" />
            Nuevo hallazgo
          </Link>
          <Link
            href="/informes"
            className="flex h-10 items-center gap-2 rounded-[11px] bg-primary px-[15px] text-[13px] font-semibold text-white transition-colors hover:bg-[#241f17]"
          >
            <FileText className="h-4 w-4 text-brand" />
            Generar informe
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Índice de cumplimiento"
          icon={<ShieldCheck className="h-[18px] w-[18px]" style={{ color: "var(--success)" }} />}
          value={compliance}
          suffix="%"
          accent="var(--success)"
          footer={
            <span className="flex items-center gap-1.5 text-[var(--success)]">
              <TrendingUp className="h-3 w-3" />
              {stats.documents.valid}/{stats.documents.total} documentos vigentes
            </span>
          }
        />
        <KpiCard
          title="Hallazgos abiertos"
          icon={<TriangleAlert className="h-[18px] w-[18px]" style={{ color: "var(--danger)" }} />}
          value={openFindings}
          accent="var(--danger)"
          footer={
            <span className="flex items-center gap-1.5 text-[var(--danger)]">
              <span className="h-[7px] w-[7px] rounded-full bg-danger" />
              {stats.findings.critical} crítico{stats.findings.critical === 1 ? "" : "s"}
            </span>
          }
        />
        <KpiCard
          title="Documentos por vencer"
          icon={<Clock className="h-[18px] w-[18px]" style={{ color: "var(--warning)" }} />}
          value={stats.documents.expiring}
          accent="var(--warning)"
          footer={
            <span className="flex items-center gap-1.5 text-[var(--warning)]">
              <span className="h-[7px] w-[7px] rounded-full bg-warning" />
              {stats.documents.expired} vencido{stats.documents.expired === 1 ? "" : "s"}
            </span>
          }
        />
        {/* Días sin accidentes — tarjeta oscura */}
        <div className="relative overflow-hidden rounded-2xl bg-primary p-[18px] text-sidebar-foreground">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg,rgba(243,164,10,.08) 0 16px,transparent 16px 32px)",
            }}
          />
          <div className="relative mb-3.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-sidebar-foreground/60">
              Días sin accidentes
            </span>
            <ShieldCheck className="h-[18px] w-[18px] text-brand" />
          </div>
          <div className="relative font-display text-[32px] font-bold tracking-[-0.02em]">
            {stats.daysWithoutAccidents ?? "—"}
          </div>
          <div className="relative mt-0.5 text-xs text-sidebar-foreground/55">
            {stats.daysWithoutAccidents != null
              ? "desde el último hallazgo crítico"
              : "Sin críticos registrados"}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="font-display text-base font-semibold">Evolución de hallazgos</div>
              <div className="text-xs text-muted-foreground">
                Creados vs. resueltos · últimas 8 semanas
              </div>
            </div>
            <div className="flex gap-3.5 text-xs text-[#6f6a60]">
              <LegendDot color="var(--chart-2)" label="Creados" />
              <LegendDot color="var(--chart-1)" label="Resueltos" />
            </div>
          </div>
          <FindingsChart data={stats.findingsWeekly} />
        </Panel>

        <Panel>
          <div className="font-display text-base font-semibold">Riesgo por zona</div>
          <div className="mb-4 text-xs text-muted-foreground">Nivel de exposición actual</div>
          <div className="flex flex-col gap-3.5">
            {stats.riskByLocation.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin hallazgos abiertos</p>
            ) : (
              stats.riskByLocation.map((z) => {
                const pct = Math.round((z.score / maxRisk) * 100)
                const level =
                  z.critical > 0 || pct >= 66
                    ? { label: "Alto", color: "var(--danger)" }
                    : pct >= 33
                      ? { label: "Medio", color: "var(--warning)" }
                      : { label: "Bajo", color: "var(--success)" }
                return (
                  <Link key={z.location} href="/mapa-riesgos" className="group block">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[13px] font-medium">{z.location}</span>
                      <span className="text-xs font-semibold" style={{ color: level.color }}>
                        {level.label}
                      </span>
                    </div>
                    <div className="h-[7px] overflow-hidden rounded-md bg-secondary">
                      <div
                        className="h-full rounded-md transition-all"
                        style={{ width: `${pct}%`, background: level.color }}
                      />
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </Panel>
      </div>

      {/* Bottom */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <div className="font-display text-base font-semibold">Próximos vencimientos</div>
            <Link href="/documentos" className="text-[13px] font-semibold text-[#b8841a]">
              Ver todos
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {stats.upcomingExpirations.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No hay documentos por vencer próximamente
              </p>
            ) : (
              stats.upcomingExpirations.map((d) => {
                const urgent = d.days_until <= 7
                const color = urgent ? "var(--danger)" : "var(--warning)"
                const tint = urgent ? "var(--danger-tint)" : "var(--warning-tint)"
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 rounded-[11px] border border-secondary p-2.5"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
                      style={{ background: tint }}
                    >
                      <FileText className="h-[18px] w-[18px]" style={{ color }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{d.worker_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{d.document_type}</div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{ background: tint, color }}
                    >
                      {d.days_until === 0
                        ? "Hoy"
                        : d.days_until === 1
                          ? "Mañana"
                          : `${d.days_until} días`}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </Panel>

        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <div className="font-display text-base font-semibold">Hallazgos recientes</div>
            <Link href="/hallazgos" className="text-[13px] font-semibold text-[#b8841a]">
              Ver todos
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {stats.recentFindings.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No hay hallazgos registrados
              </p>
            ) : (
              stats.recentFindings.map((f) => {
                const sev = SEV[f.severity] || SEV.low
                return (
                  <div
                    key={f.id}
                    className="flex items-start gap-3 rounded-[11px] border border-secondary p-2.5"
                  >
                    <span
                      className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: sev.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{f.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        #{f.id} · {f.location || "Sin ubicación"}
                        {f.responsible_person ? ` · ${f.responsible_person}` : ""} · {fmtDate(f.created_at)}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{ background: sev.tint, color: sev.color }}
                    >
                      {sev.label}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-5">{children}</div>
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  )
}

function KpiCard({
  title,
  icon,
  value,
  suffix,
  accent,
  footer,
}: {
  title: string
  icon: React.ReactNode
  value: number | string
  suffix?: string
  accent: string
  footer: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-[18px]">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
        {icon}
      </div>
      <div className="font-display text-[32px] font-bold tracking-[-0.02em]">
        {value}
        {suffix ? <span className="text-[18px] text-muted-foreground">{suffix}</span> : null}
      </div>
      <div className="mt-0.5 text-xs">{footer}</div>
      <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: accent }} />
    </div>
  )
}
