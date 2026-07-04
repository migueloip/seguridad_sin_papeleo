"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, Sparkles, Send, Loader2, Pencil, Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import { createDocument, getDocumentTypes } from "@/app/actions/documents"
import { getWorkers } from "@/app/actions/workers"
import { parseDocumentDescription } from "@/app/actions/document-processing"

type DocType = { id: number; name: string }
type WorkerOpt = { id: number; name: string }
type Msg = { role: "ai" | "user"; text: string }

const SUGGESTIONS = [
  "Curso de trabajo en altura de María Soto, vigencia un año",
  "Licencia clase D de Luis Vega, vence en 6 meses",
  "Examen ocupacional de Pedro Rojas",
]

function addMonths(dateStr: string, months: number): string {
  const d = dateStr ? new Date(dateStr) : new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

const fieldCls =
  "h-11 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"

export function DocumentEditor() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [types, setTypes] = useState<DocType[]>([])
  const [workers, setWorkers] = useState<WorkerOpt[]>([])
  const [form, setForm] = useState({
    document_type_id: "",
    worker_id: "",
    issue_date: "",
    validity: "",
    notes: "",
  })
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string } | null>(null)
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "ai",
      text: "Estoy aquí para ayudarte a completar este documento. Dime de qué se trata y lo voy llenando — por ejemplo: «es un curso de trabajo en altura de María Soto, vigencia un año».",
    },
  ])
  const [input, setInput] = useState("")
  const [thinking, setThinking] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [dts, wks] = await Promise.all([getDocumentTypes(), getWorkers()])
        if (!alive) return
        setTypes(((dts as DocType[]) || []).map((d) => ({ id: Number(d.id), name: d.name })))
        setWorkers(
          ((wks as Array<{ id: number; first_name: string; last_name: string }>) || []).map((w) => ({
            id: Number(w.id),
            name: `${w.first_name} ${w.last_name}`.trim(),
          })),
        )
      } catch {}
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages, thinking])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setAttachment({ name: file.name, dataUrl: String(reader.result || "") })
    reader.readAsDataURL(file)
  }

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || thinking) return
    setMessages((m) => [...m, { role: "user", text: q }])
    setInput("")
    setThinking(true)
    try {
      const r = await parseDocumentDescription(q)
      const did: string[] = []
      setForm((prev) => {
        const next = { ...prev }
        if (r.tipoDocumento) {
          const t = types.find((x) =>
            x.name.toLowerCase().includes(r.tipoDocumento!.toLowerCase().split(" ")[0]),
          )
          if (t) {
            next.document_type_id = String(t.id)
            did.push(`tipo «${t.name}»`)
          }
        }
        if (r.nombre) {
          const first = r.nombre.toLowerCase().split(" ")[0]
          const w = workers.find((x) => x.name.toLowerCase().includes(first))
          if (w) {
            next.worker_id = String(w.id)
            did.push(`trabajador ${w.name}`)
          }
        }
        if (r.vigenciaMeses) {
          next.validity = String(r.vigenciaMeses)
          did.push(`vigencia ${r.vigenciaMeses} meses`)
        }
        if (r.notas) next.notes = r.notas
        return next
      })
      const reply = did.length
        ? `Listo, actualicé ${did.join(", ")} en el formulario. ¿Algo más que quieras ajustar?`
        : "No pude identificar campos. Asegúrate de tener configurada la API Key de IA en Configuración, o edita el formulario a mano."
      setMessages((m) => [...m, { role: "ai", text: reply }])
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "Hubo un problema al consultar la IA. Edita el formulario a mano." }])
    } finally {
      setThinking(false)
    }
  }

  const save = () => {
    if (!form.document_type_id || !form.worker_id) {
      toast.error("Selecciona el tipo de documento y el trabajador")
      return
    }
    const typeName = types.find((t) => String(t.id) === form.document_type_id)?.name || "Documento"
    const expiry = form.validity
      ? addMonths(form.issue_date || new Date().toISOString().slice(0, 10), Number(form.validity))
      : undefined
    startTransition(async () => {
      try {
        await createDocument({
          worker_id: Number(form.worker_id),
          document_type_id: Number(form.document_type_id),
          file_name: attachment?.name || typeName,
          file_url: attachment?.dataUrl,
          issue_date: form.issue_date || undefined,
          expiry_date: expiry,
          extracted_data: form.notes ? { notas: form.notes } : undefined,
        })
        toast.success("Documento guardado")
        router.push("/documentos")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo guardar el documento")
      }
    })
  }

  return (
    <div className="space-y-[18px]">
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />

      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/documentos")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-border bg-card hover:bg-secondary"
          aria-label="Volver"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Nuevo documento</h1>
          <p className="text-sm text-muted-foreground">
            Edítalo a mano o pídele a la IA que lo complete por ti
          </p>
        </div>
        <button
          onClick={save}
          disabled={isPending}
          className="flex h-[42px] shrink-0 items-center gap-2 rounded-[11px] bg-primary px-[18px] text-sm font-semibold text-white transition-colors hover:bg-[#241f17] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-brand" />}
          Guardar documento
        </button>
      </div>

      <div className="grid items-start gap-[18px] lg:grid-cols-[1.4fr_1fr]">
        {/* Formulario manual */}
        <div className="rounded-2xl border border-border bg-card p-[22px]">
          <div className="mb-[18px] flex items-center gap-2 font-display text-base font-semibold">
            <Pencil className="h-[17px] w-[17px]" />
            Edición manual
          </div>

          <label className="mb-1.5 block text-[13px] font-semibold">Tipo de documento</label>
          <select
            value={form.document_type_id}
            onChange={(e) => setForm({ ...form, document_type_id: e.target.value })}
            className={cn(fieldCls, "mb-4")}
          >
            <option value="">Seleccionar tipo…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <label className="mb-1.5 block text-[13px] font-semibold">Trabajador asignado</label>
          <select
            value={form.worker_id}
            onChange={(e) => setForm({ ...form, worker_id: e.target.value })}
            className={cn(fieldCls, "mb-4")}
          >
            <option value="">Seleccionar persona…</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold">Fecha de emisión</label>
              <input
                type="date"
                value={form.issue_date}
                onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                className={fieldCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold">Vigencia</label>
              <select
                value={form.validity}
                onChange={(e) => setForm({ ...form, validity: e.target.value })}
                className={fieldCls}
              >
                <option value="">Seleccionar…</option>
                <option value="3">3 meses</option>
                <option value="6">6 meses</option>
                <option value="12">12 meses</option>
                <option value="24">24 meses</option>
              </select>
            </div>
          </div>

          <label className="mb-1.5 block text-[13px] font-semibold">Notas y observaciones</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Observaciones del documento"
            className="mb-4 min-h-[88px] w-full rounded-[10px] border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />

          {/* Adjuntar archivo */}
          <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-border bg-[#faf8f3] p-3.5">
            <Upload className="h-[22px] w-[22px] text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">
                {attachment ? attachment.name : "Adjuntar archivo"}
              </div>
              <div className="text-xs text-muted-foreground">
                {attachment ? "Archivo listo para guardar" : "PDF o imagen del documento · o tómalo desde la app"}
              </div>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="h-[34px] shrink-0 rounded-[9px] border border-border bg-card px-3.5 text-xs font-semibold transition-colors hover:bg-secondary"
            >
              Examinar
            </button>
          </div>
        </div>

        {/* Chat IA (panel oscuro) */}
        <div className="flex h-[560px] flex-col overflow-hidden rounded-2xl bg-[#16130e]">
          <div className="flex shrink-0 items-center gap-2.5 border-b border-[#262019] px-[18px] py-4">
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-brand">
              <Sparkles className="h-[18px] w-[18px] text-[#16130e]" />
            </span>
            <div>
              <div className="font-display text-[15px] font-semibold text-[#f6f4ee]">Editar con IA</div>
              <div className="text-xs text-[#f6f4ee]/55">Completa el documento conversando</div>
            </div>
          </div>

          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[88%] whitespace-pre-wrap px-3.5 py-2.5 text-[13px] leading-relaxed",
                  m.role === "ai"
                    ? "rounded-[13px] rounded-bl-[4px] bg-white/[0.07] text-[#f6f4ee]"
                    : "self-end rounded-[13px] rounded-br-[4px] bg-[#f0ece3] text-[#26221c]",
                )}
              >
                {m.text}
              </div>
            ))}
            {thinking && (
              <div className="flex items-center gap-2 self-start rounded-[13px] rounded-bl-[4px] bg-white/[0.07] px-3.5 py-2.5 text-[13px] text-[#f6f4ee]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> Pensando…
              </div>
            )}
            {messages.length === 1 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-[16px] border border-[#2e2920] px-2.5 py-1.5 text-[11px] font-semibold text-[#f6f4ee]/75 transition-colors hover:border-brand"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="flex shrink-0 items-center gap-2 border-t border-[#262019] p-3"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe el documento…"
              className="h-10 flex-1 rounded-[10px] border border-[#2e2920] bg-[#1f1b14] px-3 text-sm text-[#f6f4ee] outline-none placeholder:text-[#f6f4ee]/35 focus:border-brand"
            />
            <button
              type="submit"
              disabled={thinking}
              className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand disabled:opacity-60"
              aria-label="Enviar"
            >
              <Send className="h-4 w-4 text-[#16130e]" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
