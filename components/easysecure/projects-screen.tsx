"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, HardHat, MapPin, Plus, X } from "lucide-react"
import { createProject } from "@/app/actions/projects"
import { logout } from "@/app/actions/auth"
import { BrandMark } from "@/components/easysecure/brand-mark"

type Project = {
  id: number
  name: string
  location: string | null
  client: string | null
  start_date: string | null
  end_date: string | null
  status: string
  worker_count?: number
  open_findings?: number
  expiring_docs?: number
}

type User = { name?: string | null; email: string; role?: string | null }

function statusMeta(status: string) {
  switch (status) {
    case "closing":
    case "completed":
      return { label: status === "completed" ? "Finalizado" : "Cierre", color: "var(--success)" }
    case "paused":
      return { label: "En pausa", color: "var(--muted-foreground)" }
    default:
      return { label: "En ejecución", color: "var(--brand)" }
  }
}

function progressFor(p: Project): number {
  if (p.start_date && p.end_date) {
    const start = new Date(p.start_date).getTime()
    const end = new Date(p.end_date).getTime()
    if (end > start) {
      const pct = ((Date.now() - start) / (end - start)) * 100
      return Math.max(0, Math.min(100, Math.round(pct)))
    }
  }
  if (p.status === "completed") return 100
  if (p.status === "closing") return 90
  return 0
}

function projectCode(p: Project): string {
  const year = p.start_date ? new Date(p.start_date).getFullYear() : new Date().getFullYear()
  return `OBRA-${year}-${String(p.id).padStart(3, "0")}`
}

export function ProjectsScreen({
  projects: initial,
  user,
}: {
  projects: Project[]
  user: User
}) {
  const [projects, setProjects] = useState<Project[]>(initial)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: "", location: "", client: "" })
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const initials = (user.name || user.email || "U").slice(0, 2).toUpperCase()

  const handleCreate = () => {
    if (!form.name.trim()) {
      toast.error("El nombre del proyecto es requerido")
      return
    }
    startTransition(async () => {
      try {
        const created = (await createProject({
          name: form.name.trim(),
          location: form.location || undefined,
          client: form.client || undefined,
        })) as unknown as Project
        setProjects((prev) => [
          { ...created, worker_count: 0, open_findings: 0, expiring_docs: 0 },
          ...prev,
        ])
        setForm({ name: "", location: "", client: "" })
        setShowNew(false)
        toast.success("Proyecto creado")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al crear el proyecto")
      }
    })
  }

  return (
    <div className="min-h-screen bg-[#16130e] text-[#f6f4ee]">
      <div className="mx-auto max-w-[1180px] px-6 pb-16 pt-10 md:px-10">
        {/* Top bar */}
        <div className="mb-11 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size={38} />
            <span className="font-display text-xl font-bold tracking-tight">Easysecure</span>
          </div>
          <div className="flex items-center gap-3.5">
            <div className="text-right">
              <div className="text-[13px] font-semibold">{user.name || user.email}</div>
              <div className="text-xs text-[#f6f4ee]/50">{user.role || "usuario"}</div>
            </div>
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#2a251d] text-sm font-semibold text-brand">
              {initials}
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#f6f4ee]/60 transition-colors hover:bg-white/5 hover:text-[#f6f4ee]"
              >
                Salir
              </button>
            </form>
          </div>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <div className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-brand">
            Tus obras
          </div>
          <h1 className="mb-2 font-display text-[38px] font-bold tracking-[-0.03em]">
            Selecciona un proyecto
          </h1>
          <p className="text-[15px] text-[#f6f4ee]/55">
            Cada proyecto guarda sus propios hallazgos, documentos, planos y personal.
          </p>
          <Link
            href="/obra"
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-[11px] border border-brand/40 bg-brand/10 px-4 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <HardHat className="h-4 w-4 shrink-0" />
            <span>Obra integral: equipo, planos por especialidad y tareas</span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </div>

        {/* Grid */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const meta = statusMeta(p.status)
            const progress = progressFor(p)
            const findingsColor = (p.open_findings ?? 0) > 2 ? "var(--danger)" : "var(--brand)"
            return (
              <button
                key={p.id}
                onClick={() => router.push(`/proyectos/${p.id}/documentos`)}
                className="group overflow-hidden rounded-[18px] border border-[#2e2920] bg-[#1f1b14] text-left transition-all hover:-translate-y-0.5 hover:border-brand"
              >
                <div className="relative h-[118px] overflow-hidden bg-[#262017]">
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(135deg,rgba(243,164,10,.1) 0 14px,transparent 14px 28px)",
                    }}
                  />
                  <div className="absolute left-3.5 top-3.5 font-mono text-[11px] tracking-[0.1em] text-[#f6f4ee]/55">
                    {projectCode(p)}
                  </div>
                  <div
                    className="absolute bottom-3.5 left-3.5 inline-flex items-center gap-1.5 rounded-full bg-[#16130e]/80 px-2.5 py-1.5 text-[11px] font-semibold"
                    style={{ color: meta.color }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: meta.color }}
                    />
                    {meta.label}
                  </div>
                </div>
                <div className="p-[18px]">
                  <div className="mb-1.5 font-display text-[17px] font-semibold tracking-[-0.01em]">
                    {p.name}
                  </div>
                  <div className="mb-4 flex items-center gap-1.5 text-[13px] text-[#f6f4ee]/50">
                    <MapPin className="h-3.5 w-3.5" />
                    {p.location || "Sin ubicación"}
                  </div>
                  <div className="mb-1.5 flex items-center justify-between text-xs text-[#f6f4ee]/50">
                    <span>Avance de obra</span>
                    <span className="font-semibold text-[#f6f4ee]">{progress}%</span>
                  </div>
                  <div className="mb-4 h-1.5 overflow-hidden rounded-md bg-[#2e2920]">
                    <div className="h-full rounded-md bg-brand" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex gap-2">
                    <Stat value={p.open_findings ?? 0} label="hallazgos" color={findingsColor} />
                    <Stat value={p.expiring_docs ?? 0} label="por vencer" color="var(--warning)" />
                    <Stat value={p.worker_count ?? 0} label="personas" />
                  </div>
                </div>
              </button>
            )
          })}

          {/* Nuevo proyecto */}
          <button
            onClick={() => setShowNew(true)}
            className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-[#3a342a] text-[#f6f4ee]/50 transition-colors hover:border-brand hover:text-brand"
          >
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[#1f1b14]">
              <Plus className="h-6 w-6" />
            </span>
            <span className="text-[15px] font-semibold">Nuevo proyecto</span>
            <span className="max-w-[160px] text-center text-xs leading-relaxed">
              Crea una obra y configura su equipo
            </span>
          </button>
        </div>
      </div>

      {/* Modal nuevo proyecto */}
      {showNew && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,8,5,0.6)] p-6 backdrop-blur-[3px]"
          onClick={() => setShowNew(false)}
        >
          <div
            className="w-full max-w-[480px] rounded-[18px] bg-card p-7 text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-[21px] font-bold">Nuevo proyecto</div>
                <p className="mb-5 mt-1 text-sm text-muted-foreground">
                  Define los datos básicos de la obra.
                </p>
              </div>
              <button
                onClick={() => setShowNew(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <Field label="Nombre del proyecto">
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Edificio Vista Norte"
                className="h-11 w-full rounded-[10px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ubicación">
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Comuna, ciudad"
                  className="h-11 w-full rounded-[10px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </Field>
              <Field label="Cliente / tipo de obra">
                <input
                  value={form.client}
                  onChange={(e) => setForm({ ...form, client: e.target.value })}
                  placeholder="Edificación, montaje…"
                  className="h-11 w-full rounded-[10px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </Field>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                onClick={() => setShowNew(false)}
                className="h-11 rounded-[10px] border border-border px-4 text-sm font-semibold transition-colors hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={isPending}
                className="h-11 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isPending ? "Creando…" : "Crear proyecto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="flex-1 rounded-[9px] bg-[#16130e] px-2.5 py-2.5">
      <div className="font-display text-[17px] font-bold" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-[11px] text-[#f6f4ee]/45">{label}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-[13px] font-semibold">{label}</label>
      {children}
    </div>
  )
}
