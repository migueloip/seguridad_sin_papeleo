"use client"

/**
 * Reportar un hallazgo en el punto tocado del plano (permiso findings.report).
 * Pensado para el celular en terreno: título, descripción, severidad con
 * botones grandes, categoría sugerida en vivo a partir del texto (editable) y
 * foto opcional con la cámara. Se envía con reportObraFinding; el servidor
 * crea el hallazgo, su ubicación y las sugerencias por reglas (pendientes).
 */
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { toast } from "sonner"
import { Camera, Loader2, MapPin, Send, Trash2 } from "lucide-react"
import { reportObraFinding } from "@/app/actions/obra/pins"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { classifyFindingText } from "@/lib/obra/classify"
import { readImageFileAsDataUrl } from "@/lib/obra/client-files"
import {
  FINDING_CATEGORIES,
  FINDING_CATEGORY_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  type AiSuggestion,
  type FindingCategory,
  type FindingPin,
  type PlanLayer,
  type Severity,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { callAction } from "./task-card"

const LIMITS = { titleMin: 3, titleMax: 200, description: 4000 } as const
const PHOTO_MAX_SIDE = 1600
const PHOTO_MAX_BYTES = 3_000_000

const SEVERITY_HINTS: Record<Severity, string> = {
  low: "Sin riesgo inmediato",
  medium: "Hay que corregirlo pronto",
  high: "Riesgo para las personas",
  critical: "Peligro inmediato: detener el trabajo",
}

const SEVERITY_STYLES: Record<Severity, { on: string; dot: string }> = {
  low: { on: "border-sev-low bg-sev-low-tint", dot: "bg-sev-low" },
  medium: { on: "border-sev-medium bg-sev-medium-tint", dot: "bg-sev-medium" },
  high: { on: "border-sev-high bg-sev-high-tint", dot: "bg-sev-high" },
  critical: { on: "border-sev-critical bg-sev-critical-tint", dot: "bg-sev-critical" },
}

export type ReportFindingResult = { finding_id: number; pin: FindingPin; suggestions: AiSuggestion[] }

export type ReportFindingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  /** Capa activa donde se ubica el hallazgo. */
  layer: PlanLayer | null
  /** Punto tocado (coordenadas normalizadas de la capa). */
  point: { x: number; y: number } | null
  /** Nombre del nivel, para mostrar la ubicación. */
  levelText?: string
  onReported: (result: ReportFindingResult) => void
}

export function ReportFindingDialog(props: ReportFindingDialogProps) {
  const { open, onOpenChange } = props
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Reportar un problema aquí</DialogTitle>
          <DialogDescription>
            Cuenta qué viste. Con la ubicación en el plano, el sistema revisa qué redes o elementos pasan cerca.
          </DialogDescription>
        </DialogHeader>
        {open ? <ReportForm {...props} onSavingChange={setSaving} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ReportForm({
  projectId,
  layer,
  point,
  levelText,
  onOpenChange,
  onReported,
  onSavingChange,
}: ReportFindingDialogProps & { onSavingChange: (saving: boolean) => void }) {
  const formId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [severity, setSeverity] = useState<Severity>("medium")
  const [category, setCategory] = useState<FindingCategory | null>(null)
  const [photo, setPhoto] = useState<{ dataUrl: string; width: number; height: number } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const suggested = classifyFindingText(`${title} ${description}`)
  const effectiveCategory = category ?? suggested
  const autoCategory = category === null

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setPhotoBusy(true)
    try {
      const img = await readImageFileAsDataUrl(file, { maxSide: PHOTO_MAX_SIDE, maxBytes: PHOTO_MAX_BYTES })
      setPhoto({ dataUrl: img.dataUrl, width: img.width, height: img.height })
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "No se pudo leer la foto. Prueba con otra.")
    } finally {
      setPhotoBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!layer || !point) {
      setError("Falta la ubicación en el plano. Cierra y vuelve a tocar el plano.")
      return
    }
    const t = title.trim()
    if (t.length < LIMITS.titleMin) {
      setError(`Escribe un título de al menos ${LIMITS.titleMin} letras (ej.: «Grieta en el muro»).`)
      return
    }
    setError(null)
    setSaving(true)
    onSavingChange(true)
    const res = await callAction(() =>
      reportObraFinding(projectId, {
        layer_id: layer.id,
        x: point.x,
        y: point.y,
        title: t,
        description: description.trim() || null,
        severity,
        category: effectiveCategory,
        photo_data_url: photo?.dataUrl ?? null,
      }),
    )
    setSaving(false)
    onSavingChange(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    onReported(res.data)
    onOpenChange(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="flex items-start gap-1.5 rounded-[10px] bg-secondary px-3 py-2 text-[13px]">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 break-words">
          {layer ? (
            <>
              Ubicación: capa «{layer.name}»{levelText ? ` · ${levelText}` : ""}
            </>
          ) : (
            "Sin ubicación"
          )}
        </span>
      </p>

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-title`}>¿Qué pasa?</Label>
        <Input
          id={`${formId}-title`}
          value={title}
          maxLength={LIMITS.titleMax}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ej.: Grieta en el muro del eje B"
          className="h-11 text-base"
          autoComplete="off"
          required
          aria-invalid={Boolean(error) && title.trim().length < LIMITS.titleMin}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-desc`}>Más detalles (opcional)</Label>
        <Textarea
          id={`${formId}-desc`}
          value={description}
          maxLength={LIMITS.description}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="¿Desde cuándo? ¿Hay humedad, olor o ruido? ¿Hay riesgo para las personas?"
          className="text-base"
        />
      </div>

      <fieldset className="min-w-0 space-y-1.5">
        <legend className="text-sm font-medium">¿Qué tan grave es?</legend>
        <div role="radiogroup" aria-label="Severidad" className="grid grid-cols-2 gap-2">
          {[...SEVERITIES].map((s) => {
            const on = severity === s
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSeverity(s)}
                className={cn(
                  "flex min-h-14 flex-col items-start justify-center rounded-[12px] border-2 px-3 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  on ? SEVERITY_STYLES[s].on : "border-border bg-card hover:bg-secondary",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className={cn("h-2.5 w-2.5 rounded-full", SEVERITY_STYLES[s].dot)} aria-hidden />
                  {SEVERITY_LABELS[s]}
                </span>
                <span className="text-[11.5px] text-muted-foreground">{SEVERITY_HINTS[s]}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-cat`}>Tipo de problema</Label>
        <Select value={effectiveCategory} onValueChange={(v) => setCategory(v as FindingCategory)}>
          <SelectTrigger id={`${formId}-cat`} className="h-11 w-full" aria-describedby={`${formId}-cat-hint`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FINDING_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="min-h-10">
                {FINDING_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={`${formId}-cat-hint`} className="text-[12px] text-muted-foreground" aria-live="polite">
          {autoCategory ? (
            suggested !== "otro" ? (
              "Sugerido según lo que escribiste. Puedes cambiarlo."
            ) : (
              "Se ajusta solo a medida que escribes. Puedes elegirlo tú."
            )
          ) : suggested !== category ? (
            <>
              Lo elegiste tú.{" "}
              <button
                type="button"
                className="min-h-8 font-semibold text-[#b8841a] underline-offset-2 hover:underline"
                onClick={() => setCategory(null)}
              >
                Usar el sugerido ({FINDING_CATEGORY_LABELS[suggested]})
              </button>
            </>
          ) : (
            "Lo elegiste tú."
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium" id={`${formId}-photo-label`}>
          Foto (opcional)
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${formId}-photo-label`}
          onChange={onPhoto}
        />
        {photo ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (data URL) */}
            <img
              src={photo.dataUrl}
              alt="Foto adjunta al reporte"
              className="h-20 w-28 rounded-[10px] border border-border object-cover"
            />
            <div className="flex flex-col gap-1.5">
              <Button type="button" variant="outline" className="h-10" onClick={() => fileRef.current?.click()} disabled={photoBusy || saving}>
                <Camera className="h-4 w-4" aria-hidden />
                Cambiar foto
              </Button>
              <Button type="button" variant="ghost" className="h-10 text-danger hover:text-danger" onClick={() => setPhoto(null)} disabled={saving}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Quitar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy || saving}
          >
            {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
            {photoBusy ? "Preparando la foto…" : "Tomar o elegir una foto"}
          </Button>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="h-11" disabled={saving} onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" className="h-11" disabled={saving || photoBusy}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {saving ? "Enviando…" : "Enviar reporte"}
        </Button>
      </DialogFooter>
    </form>
  )
}
