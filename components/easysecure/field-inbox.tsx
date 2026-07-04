"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import { Smartphone, ImageIcon, FileText, Check, Loader2 } from "lucide-react"
import {
  getMobileDocumentCandidates,
  createDocumentFromMobilePhoto,
  getDocumentTypes,
  type MobileDocumentCandidate,
} from "@/app/actions/documents"
import { getWorkers } from "@/app/actions/workers"

type DocType = { id: number; name: string }
type WorkerOpt = { id: number; name: string }

function fmt(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

const selectCls =
  "h-9 min-w-[150px] flex-1 rounded-[9px] border border-white/10 bg-[#262017] px-3 text-[13px] text-sidebar-foreground outline-none focus:border-brand"

/**
 * Bandeja "Subidos desde la app de terreno" (diseño Easysecure).
 * Lista los mobile_documents sin clasificar; al elegir tipo + trabajador y Confirmar,
 * crea un documento real (createDocumentFromMobilePhoto). Se oculta si no hay pendientes.
 */
export function FieldInbox() {
  const pathname = usePathname()
  const m = pathname.match(/^\/proyectos\/(\d+)/)
  const projectId = m ? Number(m[1]) : undefined

  const [items, setItems] = useState<MobileDocumentCandidate[]>([])
  const [types, setTypes] = useState<DocType[]>([])
  const [workers, setWorkers] = useState<WorkerOpt[]>([])
  const [sel, setSel] = useState<Record<string, { type?: number; worker?: number }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cands, dts, wks] = await Promise.all([
          getMobileDocumentCandidates(projectId),
          getDocumentTypes(),
          getWorkers(projectId),
        ])
        if (!alive) return
        setItems(cands || [])
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
  }, [projectId])

  if (items.length === 0) return null

  const keyOf = (it: MobileDocumentCandidate) => `${it.mobile_document_id}:${it.photo_index}`

  const confirm = async (it: MobileDocumentCandidate) => {
    const k = keyOf(it)
    const s = sel[k]
    if (!s?.type || !s?.worker) return
    setBusy(k)
    try {
      await createDocumentFromMobilePhoto({
        mobile_document_id: it.mobile_document_id,
        photo_index: it.photo_index,
        worker_id: s.worker,
        document_type_id: s.type,
        file_name: it.file_name,
      })
      setItems((prev) => prev.filter((x) => keyOf(x) !== k))
      toast.success("Documento clasificado y guardado")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo clasificar el documento")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-primary text-sidebar-foreground">
      <div className="flex items-center gap-3.5 border-b border-white/[0.07] px-5 py-[18px]">
        <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-white/[0.06]">
          <Smartphone className="h-5 w-5 text-brand" />
        </span>
        <div className="flex-1">
          <div className="font-display text-base font-semibold">Subidos desde la app de terreno</div>
          <div className="text-[13px] text-sidebar-foreground/60">
            Fotos y escaneos enviados por la cuadrilla · clasifícalos y asígnalos
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground">
          {items.length} por clasificar
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3.5">
        {items.map((it) => {
          const k = keyOf(it)
          const s = sel[k] || {}
          const isPdf = /\.pdf$/i.test(it.file_name)
          const canConfirm = !!s.type && !!s.worker
          const isBusy = busy === k
          return (
            <div
              key={k}
              className="flex flex-wrap items-center gap-3.5 rounded-[13px] border border-white/[0.08] bg-white/[0.03] p-3.5"
            >
              <span className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-[10px] bg-[#262017]">
                {isPdf ? (
                  <FileText className="h-6 w-6 text-brand/70" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-brand/70" />
                )}
              </span>

              <div className="min-w-0 flex-1 basis-[180px]">
                <div className="font-mono text-xs text-sidebar-foreground/45">
                  M-{it.mobile_document_id}-{it.photo_index}
                </div>
                <div className="truncate text-sm font-semibold">{it.file_name}</div>
                <div className="mt-1 text-xs text-sidebar-foreground/55">
                  {it.project_name || "Sin proyecto"} · {fmt(it.created_at)}
                </div>
              </div>

              <select
                value={s.type ?? ""}
                onChange={(e) =>
                  setSel((p) => ({
                    ...p,
                    [k]: { ...p[k], type: e.target.value ? Number(e.target.value) : undefined },
                  }))
                }
                className={selectCls}
              >
                <option value="">Tipo de documento…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <select
                value={s.worker ?? ""}
                onChange={(e) =>
                  setSel((p) => ({
                    ...p,
                    [k]: { ...p[k], worker: e.target.value ? Number(e.target.value) : undefined },
                  }))
                }
                className={selectCls}
              >
                <option value="">Asignar a…</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={!canConfirm || isBusy}
                onClick={() => confirm(it)}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed"
                style={{
                  background: canConfirm ? "var(--brand)" : "rgba(247,245,240,0.08)",
                  color: canConfirm ? "var(--brand-foreground)" : "rgba(246,244,238,0.4)",
                }}
              >
                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Confirmar
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
