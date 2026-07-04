"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Sparkles, Send, FileText, Download, Trash2 } from "lucide-react"
import { deleteReport } from "@/app/actions/reports"

type Report = {
  id: number
  report_type: string
  title: string
  date_from?: string | null
  date_to?: string | null
  created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  inspection: "Inspección",
  compliance: "Cumplimiento",
  custom: "Personalizado",
  manual: "Manual",
}

const PRESETS = ["Reporte mensual de cumplimiento", "Acta de inspección de andamios", "Resumen para gerencia"]

const TEMPLATES: { key: string; name: string; desc: string; code: string; tint: string; color: string }[] = [
  { key: "iper", name: "Matriz IPER", desc: "Identificación de peligros y evaluación de riesgos", code: "SGI-IPER-01", tint: "var(--danger-tint)", color: "var(--danger)" },
  { key: "pts", name: "PTS", desc: "Procedimiento de trabajo seguro", code: "SGI-PTS-01", tint: "#e7eefb", color: "#3b6fd4" },
  { key: "ast", name: "AST / ATS", desc: "Análisis seguro de trabajo", code: "SGI-AST-01", tint: "var(--sev-medium-tint)", color: "var(--sev-medium)" },
  { key: "accident", name: "Investigación de accidentes", desc: "Reporte e investigación de incidentes", code: "SGI-INV-01", tint: "#efe7fb", color: "#7c4dd4" },
  { key: "inspection", name: "Inspección planeada", desc: "Check de inspección de terreno", code: "SGI-INS-01", tint: "var(--success-tint)", color: "var(--success)" },
  { key: "altura", name: "Permiso de trabajo en altura", desc: "Autorización para trabajo en altura", code: "SGI-PTA-01", tint: "var(--warning-tint)", color: "var(--warning)" },
]

function fmt(s?: string | null): string {
  if (!s) return ""
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
}

export function ReportsLanding({ reports: initialReports, editorHref }: { reports: Report[]; editorHref: string }) {
  const router = useRouter()
  const [reports, setReports] = useState<Report[]>(initialReports)
  const [prompt, setPrompt] = useState("")
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [isDeleting, startDelete] = useTransition()

  // Lleva lo escrito al editor para que la IA lo use como instrucción.
  const goGenerate = (text: string) => {
    const q = text.trim()
    router.push(q ? `${editorHref}?prompt=${encodeURIComponent(q)}` : editorHref)
  }

  const handleDelete = (id: number) => {
    startDelete(async () => {
      try {
        const ok = await deleteReport(id)
        if (!ok) throw new Error()
        setReports((prev) => prev.filter((r) => r.id !== id))
        toast.success("Informe eliminado")
      } catch {
        toast.error("No se pudo eliminar el informe")
      }
      setConfirmingId(null)
    })
  }

  return (
    <div className="space-y-[18px]">
      <div>
        <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">Informes</h1>
        <p className="text-sm text-muted-foreground">Genera y exporta reportes de seguridad en PDF</p>
      </div>

      {/* Generador con IA */}
      <div className="relative overflow-hidden rounded-[18px] bg-primary p-[22px] text-sidebar-foreground">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg,rgba(243,164,10,.06) 0 20px,transparent 20px 40px)",
          }}
        />
        <div className="relative mb-4 flex items-center gap-3">
          <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-brand">
            <Sparkles className="h-5 w-5 text-primary" />
          </span>
          <div>
            <div className="font-display text-[17px] font-semibold">Generar informe con IA</div>
            <div className="text-[13px] text-sidebar-foreground/60">
              Describe lo que necesitas y la IA arma el reporte con tus datos
            </div>
          </div>
        </div>
        <div className="relative mb-3.5 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#1f1b14] py-1.5 pl-4 pr-1.5">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ej: Informe semanal de seguridad con hallazgos críticos y plan de acción"
            onKeyDown={(e) => {
              if (e.key === "Enter") goGenerate(prompt)
            }}
            className="flex-1 border-none bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40"
          />
          <button
            onClick={() => goGenerate(prompt)}
            className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-[9px] bg-brand px-4 text-[13px] font-bold text-brand-foreground"
          >
            <Send className="h-[15px] w-[15px]" />
            Generar
          </button>
        </div>
        <div className="relative flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => goGenerate(p)}
              className="rounded-[20px] border border-white/10 px-3 py-1.5 text-xs font-medium text-sidebar-foreground/70 transition-colors hover:border-brand hover:text-sidebar-foreground"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Plantillas de prevención */}
      <div className="font-display text-base font-semibold">Plantillas de prevención</div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            onClick={() => router.push(`${editorHref}?template=${t.key}`)}
            className="group flex items-start gap-3.5 rounded-[14px] border border-border bg-card p-4 text-left transition-colors hover:border-brand"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: t.tint }}
            >
              <FileText className="h-[22px] w-[22px]" style={{ color: t.color }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-semibold leading-tight">{t.name}</div>
              <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t.desc}</div>
              <div className="mt-2 font-mono text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground/70">
                {t.code}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Documentos generados */}
      <div className="font-display text-base font-semibold">Documentos generados</div>
      {reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Aún no has generado informes. Usa “Generar” para crear el primero.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {reports.map((r) => {
            const period =
              r.date_from && r.date_to
                ? `${fmt(r.date_from)} – ${fmt(r.date_to)}`
                : TYPE_LABEL[r.report_type] || r.report_type
            return (
              <div key={r.id} className="flex items-center gap-4 rounded-[14px] border border-border bg-card p-4">
                <div className="relative flex h-[54px] w-[44px] shrink-0 flex-col items-center justify-center rounded-lg bg-danger-tint">
                  <FileText className="h-[22px] w-[22px] text-[var(--danger)]" />
                  <span className="absolute bottom-1.5 font-mono text-[8px] font-bold text-[var(--danger)]">PDF</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-[15px] font-semibold">{r.title}</span>
                    <span className="shrink-0 rounded-md bg-sev-medium-tint px-2 py-0.5 text-[11px] font-semibold text-[var(--sev-medium)]">
                      {TYPE_LABEL[r.report_type] || r.report_type}
                    </span>
                  </div>
                  <div className="text-[13px] text-muted-foreground">
                    {period} · {fmt(r.created_at)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`${editorHref}?id=${r.id}`}
                    title="Abrir en el editor para exportar"
                    className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border transition-colors hover:bg-secondary"
                  >
                    <Download className="h-[17px] w-[17px]" />
                  </Link>
                  <Link
                    href={`${editorHref}?id=${r.id}`}
                    className="flex h-9 items-center rounded-[9px] border border-border px-3.5 text-[13px] font-semibold transition-colors hover:bg-secondary"
                  >
                    Abrir
                  </Link>
                  {confirmingId === r.id ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      onMouseLeave={() => setConfirmingId(null)}
                      disabled={isDeleting}
                      className="flex h-9 items-center rounded-[9px] bg-danger px-3 text-[13px] font-semibold text-white disabled:opacity-60"
                    >
                      {isDeleting ? "…" : "¿Eliminar?"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(r.id)}
                      title="Eliminar informe"
                      aria-label={`Eliminar ${r.title}`}
                      className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-border text-muted-foreground transition-colors hover:border-danger hover:bg-danger-tint hover:text-danger"
                    >
                      <Trash2 className="h-[17px] w-[17px]" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
