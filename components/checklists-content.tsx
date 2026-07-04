"use client"

import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  Plus,
  ClipboardCheck,
  Clock,
  X,
  Pencil,
  Trash2,
  Loader2,
  Camera,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react"
import {
  createChecklistTemplate,
  getChecklistTemplate,
  updateChecklistTemplate,
  deleteChecklistTemplate,
  completeChecklist,
  extractChecklistFromImage,
  type ChecklistTemplateRow,
  type ChecklistItemInput,
  type ChecklistResponse,
  type CompletedChecklistRow,
} from "@/app/actions/checklists"

type ProjectOption = { id: number; name: string }

function fmtDate(s: string | null): string {
  if (!s) return "Sin aplicar"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "Sin aplicar"
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
}

const inputClass =
  "h-11 w-full rounded-[10px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,8,5,0.6)] p-4 backdrop-blur-[3px] sm:p-6"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[88vh] w-full ${wide ? "max-w-[640px]" : "max-w-[460px]"} flex-col rounded-[18px] bg-card p-6 sm:p-7`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-[21px] font-bold">{title}</div>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  )
}

export function ChecklistsContent({
  initial,
  projects,
  initialHistory,
}: {
  initial: ChecklistTemplateRow[]
  projects: ProjectOption[]
  initialHistory: CompletedChecklistRow[]
}) {
  const [list, setList] = useState<ChecklistTemplateRow[]>(initial)
  const [history, setHistory] = useState<CompletedChecklistRow[]>(initialHistory)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: "", description: "" })
  const [isPending, startTransition] = useTransition()

  // Editor de ítems
  const [editorFor, setEditorFor] = useState<{ id: number; name: string } | null>(null)
  const [editorItems, setEditorItems] = useState<ChecklistItemInput[]>([])
  const [isEditorLoading, setIsEditorLoading] = useState(false)
  const [isSavingItems, startSaveItems] = useTransition()
  const [isExtracting, startExtract] = useTransition()
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  // Aplicación
  const [applyFor, setApplyFor] = useState<{ id: number; name: string } | null>(null)
  const [applyItems, setApplyItems] = useState<ChecklistItemInput[]>([])
  const [responses, setResponses] = useState<Record<string, ChecklistResponse>>({})
  const [applyMeta, setApplyMeta] = useState({ projectId: "", inspector: "", location: "", notes: "" })
  const [createFindings, setCreateFindings] = useState(true)
  const [isApplying, startApply] = useTransition()

  const [deleteFor, setDeleteFor] = useState<{ id: number; name: string } | null>(null)

  const handleCreate = () => {
    if (!form.name.trim()) {
      toast.error("El nombre es requerido")
      return
    }
    startTransition(async () => {
      try {
        const { id } = await createChecklistTemplate({
          name: form.name.trim(),
          description: form.description || undefined,
          items: { items: [] },
        })
        setList((prev) => [
          { id, name: form.name.trim(), description: form.description || null, item_count: 0, runs: 0, last_completed: null },
          ...prev,
        ])
        const name = form.name.trim()
        setForm({ name: "", description: "" })
        setShowNew(false)
        toast.success("Plantilla creada", { description: "Ahora agrega sus ítems de revisión." })
        openEditor(id, name)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al crear la plantilla")
      }
    })
  }

  const openEditor = (id: number, name: string) => {
    setEditorFor({ id, name })
    setEditorItems([])
    setIsEditorLoading(true)
    getChecklistTemplate(id)
      .then((t) => setEditorItems(t?.items || []))
      .catch(() => toast.error("No se pudo cargar la plantilla"))
      .finally(() => setIsEditorLoading(false))
  }

  const saveItems = () => {
    if (!editorFor) return
    const cleaned = editorItems
      .map((it, i) => ({ id: it.id || `item-${i + 1}`, text: it.text.trim() }))
      .filter((it) => it.text.length > 0)
    startSaveItems(async () => {
      try {
        const ok = await updateChecklistTemplate(editorFor.id, { items: cleaned })
        if (!ok) throw new Error()
        setList((prev) => prev.map((c) => (c.id === editorFor.id ? { ...c, item_count: cleaned.length } : c)))
        setEditorFor(null)
        toast.success("Ítems guardados")
      } catch {
        toast.error("No se pudieron guardar los ítems")
      }
    })
  }

  const importFromPhoto = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || "")
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) {
        toast.error("No se pudo leer la imagen")
        return
      }
      startExtract(async () => {
        try {
          const res = await extractChecklistFromImage(m[2], m[1])
          const items = res.items?.items || []
          if (!items.length) {
            toast.error("La IA no encontró ítems en la imagen (revisa la API Key en Configuración)")
            return
          }
          setEditorItems((prev) => {
            const base = prev.filter((p) => p.text.trim().length > 0)
            const next = items.map((it, i) => ({ id: `item-${Date.now()}-${i}`, text: it.text }))
            return [...base, ...next]
          })
          toast.success(`${items.length} ítems importados desde la foto`)
        } catch {
          toast.error("Error al procesar la imagen con IA")
        }
      })
    }
    reader.readAsDataURL(file)
  }

  const openApply = (id: number, name: string) => {
    setApplyFor({ id, name })
    setApplyItems([])
    setResponses({})
    setApplyMeta({ projectId: "", inspector: "", location: "", notes: "" })
    setCreateFindings(true)
    getChecklistTemplate(id)
      .then((t) => {
        const items = t?.items || []
        if (!items.length) {
          toast.error("Esta plantilla no tiene ítems. Agrégalos primero con el lápiz.")
          setApplyFor(null)
          return
        }
        setApplyItems(items)
      })
      .catch(() => {
        toast.error("No se pudo cargar la plantilla")
        setApplyFor(null)
      })
  }

  const setAnswer = (itemId: string, ok: boolean | null) => {
    setResponses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ok } }))
  }
  const setNote = (itemId: string, note: string) => {
    setResponses((prev) => ({ ...prev, [itemId]: { ok: prev[itemId]?.ok ?? null, note } }))
  }

  const answered = Object.values(responses).filter((r) => r.ok !== null && r.ok !== undefined).length
  const failedCount = Object.values(responses).filter((r) => r.ok === false).length

  const submitApply = () => {
    if (!applyFor) return
    if (answered === 0) {
      toast.error("Responde al menos un ítem")
      return
    }
    startApply(async () => {
      try {
        const result = await completeChecklist({
          templateId: applyFor.id,
          projectId: applyMeta.projectId ? Number(applyMeta.projectId) : null,
          inspectorName: applyMeta.inspector || undefined,
          location: applyMeta.location || undefined,
          notes: applyMeta.notes || undefined,
          responses,
          createFindings,
        })
        const projectName = projects.find((p) => String(p.id) === applyMeta.projectId)?.name || null
        setHistory((prev) => [
          {
            id: result.id,
            template_name: applyFor.name,
            project_name: projectName,
            inspector_name: applyMeta.inspector || null,
            location: applyMeta.location || null,
            completed_at: new Date().toISOString(),
            passed: Object.values(responses).filter((r) => r.ok === true).length,
            failed: failedCount,
            skipped: applyItems.length - answered,
          },
          ...prev,
        ])
        setList((prev) =>
          prev.map((c) =>
            c.id === applyFor.id
              ? { ...c, runs: c.runs + 1, last_completed: new Date().toISOString() }
              : c,
          ),
        )
        setApplyFor(null)
        toast.success("Checklist aplicado", {
          description:
            result.findingsCreated > 0
              ? `Se crearon ${result.findingsCreated} hallazgo${result.findingsCreated === 1 ? "" : "s"} de los ítems con problema.`
              : "Sin hallazgos nuevos.",
        })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al aplicar el checklist")
      }
    })
  }

  const confirmDelete = () => {
    if (!deleteFor) return
    startTransition(async () => {
      const res = await deleteChecklistTemplate(deleteFor.id)
      if (res.ok) {
        setList((prev) => prev.filter((c) => c.id !== deleteFor.id))
        toast.success("Plantilla eliminada")
      } else {
        toast.error(res.error || "No se pudo eliminar")
      }
      setDeleteFor(null)
    })
  }

  return (
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">Checklists</h1>
          <p className="text-sm text-muted-foreground">
            Listas de verificación e inspecciones de terreno
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="flex h-[42px] items-center gap-2 rounded-[11px] bg-primary px-[17px] text-sm font-semibold text-white transition-colors hover:bg-[#241f17]"
        >
          <Plus className="h-[17px] w-[17px] text-brand" />
          Nueva plantilla
        </button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Aún no tienes plantillas de checklist. Crea la primera con “Nueva plantilla”.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((c) => (
            <div key={c.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-sev-medium-tint">
                    <ClipboardCheck className="h-[21px] w-[21px]" style={{ color: "var(--sev-medium)" }} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-display text-base font-semibold tracking-[-0.01em]">
                      {c.name}
                    </div>
                    <div className="text-[13px] text-muted-foreground">
                      {c.item_count} ítem{c.item_count === 1 ? "" : "s"} · {c.runs} aplicaci
                      {c.runs === 1 ? "ón" : "ones"}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditor(c.id, c.name)}
                    title="Editar ítems"
                    aria-label={`Editar ítems de ${c.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteFor({ id: c.id, name: c.name })}
                    title="Eliminar plantilla"
                    aria-label={`Eliminar ${c.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger-tint hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Última: {fmtDate(c.last_completed)}
                </span>
                <button
                  type="button"
                  onClick={() => openApply(c.id, c.name)}
                  className="h-[34px] rounded-[9px] bg-primary px-3.5 text-xs font-semibold text-brand transition-colors hover:bg-[#241f17]"
                >
                  Aplicar ahora
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Historial */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Últimas aplicaciones
          </div>
          <div className="divide-y divide-border">
            {history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{h.template_name}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {[h.project_name, h.inspector_name].filter(Boolean).join(" · ") || "—"}
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {h.passed}
                </span>
                <span className={`flex items-center gap-1 text-xs font-semibold ${h.failed > 0 ? "text-danger" : "text-muted-foreground"}`}>
                  <XCircle className="h-3.5 w-3.5" /> {h.failed}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{fmtDate(h.completed_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal nueva plantilla */}
      {showNew && (
        <ModalShell
          title="Nueva plantilla"
          subtitle="Crea la plantilla y luego agrega sus ítems de revisión."
          onClose={() => setShowNew(false)}
        >
          <label className="mb-1.5 block text-[13px] font-semibold">Nombre</label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ej: Inspección diaria de andamios"
            className={`mb-4 ${inputClass}`}
          />
          <label className="mb-1.5 block text-[13px] font-semibold">Descripción</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Objetivo del checklist"
            className="mb-5 min-h-[80px] w-full rounded-[10px] border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <div className="flex justify-end gap-2.5">
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
              {isPending ? "Creando…" : "Crear plantilla"}
            </button>
          </div>
        </ModalShell>
      )}

      {/* Modal editor de ítems */}
      {editorFor && (
        <ModalShell
          title={`Ítems — ${editorFor.name}`}
          subtitle="Cada ítem es un punto a verificar en terreno."
          onClose={() => setEditorFor(null)}
          wide
        >
          {isEditorLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {editorItems.map((it, i) => (
                  <div key={it.id || i} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {i + 1}.
                    </span>
                    <input
                      value={it.text}
                      onChange={(e) =>
                        setEditorItems((prev) => prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)))
                      }
                      placeholder="Punto a verificar…"
                      className="h-10 flex-1 rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                    />
                    <button
                      type="button"
                      onClick={() => setEditorItems((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Eliminar ítem"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger-tint hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {editorItems.length === 0 && (
                  <div className="rounded-[10px] border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Sin ítems todavía. Agrégalos a mano o impórtalos desde una foto.
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEditorItems((prev) => [...prev, { id: `item-${Date.now()}`, text: "" }])
                  }
                  className="flex h-10 items-center gap-2 rounded-[10px] border border-border px-3.5 text-sm font-semibold hover:border-brand hover:bg-secondary"
                >
                  <Plus className="h-4 w-4" /> Ítem
                </button>
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={isExtracting}
                  className="flex h-10 items-center gap-2 rounded-[10px] border border-border px-3.5 text-sm font-semibold hover:border-brand hover:bg-secondary disabled:opacity-60"
                >
                  {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {isExtracting ? "Analizando…" : "Importar desde foto (IA)"}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importFromPhoto(f)
                    e.target.value = ""
                  }}
                />
              </div>
              <div className="mt-5 flex justify-end gap-2.5">
                <button
                  onClick={() => setEditorFor(null)}
                  className="h-11 rounded-[10px] border border-border px-4 text-sm font-semibold transition-colors hover:bg-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveItems}
                  disabled={isSavingItems}
                  className="h-11 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isSavingItems ? "Guardando…" : "Guardar ítems"}
                </button>
              </div>
            </>
          )}
        </ModalShell>
      )}

      {/* Modal aplicar checklist */}
      {applyFor && applyItems.length > 0 && (
        <ModalShell
          title={`Aplicar — ${applyFor.name}`}
          subtitle="Marca cada ítem según lo observado en terreno."
          onClose={() => setApplyFor(null)}
          wide
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Proyecto</label>
              <select
                value={applyMeta.projectId}
                onChange={(e) => setApplyMeta({ ...applyMeta, projectId: e.target.value })}
                className="h-10 w-full rounded-[10px] border border-border bg-card px-2.5 text-sm outline-none focus:border-brand"
              >
                <option value="">Sin proyecto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Inspector</label>
              <input
                value={applyMeta.inspector}
                onChange={(e) => setApplyMeta({ ...applyMeta, inspector: e.target.value })}
                placeholder="Nombre"
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">Ubicación</label>
              <input
                value={applyMeta.location}
                onChange={(e) => setApplyMeta({ ...applyMeta, location: e.target.value })}
                placeholder="Sector, nivel…"
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="space-y-2.5">
            {applyItems.map((it, i) => {
              const r = responses[it.id || ""] || { ok: null }
              return (
                <div key={it.id || i} className="rounded-[12px] border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i + 1}.</span>
                      {it.text}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setAnswer(it.id || "", true)}
                        title="Conforme"
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                          r.ok === true
                            ? "border-success bg-success text-white"
                            : "border-border text-muted-foreground hover:border-success hover:text-success"
                        }`}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnswer(it.id || "", false)}
                        title="Con problema"
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                          r.ok === false
                            ? "border-danger bg-danger text-white"
                            : "border-border text-muted-foreground hover:border-danger hover:text-danger"
                        }`}
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnswer(it.id || "", null)}
                        title="No aplica"
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                          r.ok === null && it.id && it.id in responses
                            ? "border-primary bg-primary text-white"
                            : "border-border text-muted-foreground hover:border-primary"
                        }`}
                      >
                        <MinusCircle className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {r.ok === false && (
                    <input
                      value={r.note || ""}
                      onChange={(e) => setNote(it.id || "", e.target.value)}
                      placeholder="Describe el problema (será la descripción del hallazgo)…"
                      className="mt-2 h-9 w-full rounded-[9px] border border-danger/30 bg-danger-tint/40 px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-danger"
                    />
                  )}
                </div>
              )
            })}
          </div>

          <textarea
            value={applyMeta.notes}
            onChange={(e) => setApplyMeta({ ...applyMeta, notes: e.target.value })}
            placeholder="Notas generales de la inspección (opcional)"
            className="mt-4 min-h-[64px] w-full rounded-[10px] border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
              <input
                type="checkbox"
                checked={createFindings}
                onChange={(e) => setCreateFindings(e.target.checked)}
                className="h-4 w-4 accent-[#16130e]"
              />
              Crear hallazgos de los ítems con problema
              {failedCount > 0 && (
                <span className="rounded-full bg-danger-tint px-2 py-0.5 text-[11px] font-semibold text-danger">
                  {failedCount}
                </span>
              )}
            </label>
            <div className="flex gap-2.5">
              <button
                onClick={() => setApplyFor(null)}
                className="h-11 rounded-[10px] border border-border px-4 text-sm font-semibold transition-colors hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={submitApply}
                disabled={isApplying}
                className="h-11 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isApplying ? "Guardando…" : `Guardar (${answered}/${applyItems.length})`}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Confirmación de borrado */}
      {deleteFor && (
        <ModalShell
          title="Eliminar plantilla"
          subtitle={`“${deleteFor.name}” se eliminará. Las aplicaciones ya registradas se conservan en el historial.`}
          onClose={() => setDeleteFor(null)}
        >
          <div className="flex justify-end gap-2.5">
            <button
              onClick={() => setDeleteFor(null)}
              className="h-11 rounded-[10px] border border-border px-4 text-sm font-semibold transition-colors hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              onClick={confirmDelete}
              disabled={isPending}
              className="h-11 rounded-[10px] bg-danger px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isPending ? "Eliminando…" : "Eliminar"}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
