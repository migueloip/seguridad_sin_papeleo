"use client"

/**
 * Subir una capa de plano (permiso plans.manage): nombre, especialidad, nivel,
 * etiqueta del nivel y ancho real en metros, más el archivo:
 * - imagen (PNG/JPG/WebP): se reduce en el navegador y se sube como lámina;
 * - PDF: se elige la página y se dibuja en el navegador (pdf.js);
 * - DXF (ASCII): se leen las entidades vectoriales, se asigna un tipo a cada
 *   capa CAD (sugerido por su nombre, editable), se revisa la vista previa y
 *   se crea una capa sin imagen con sus elementos (en lotes, con progreso);
 * - DWG: no se puede leer; se pide exportarlo como DXF.
 */
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { toast } from "sonner"
import { FileUp, Loader2, TriangleAlert, Upload } from "lucide-react"
import { createObraElements } from "@/app/actions/obra/elements"
import { createObraLayer } from "@/app/actions/obra/layers"
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
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  detectPlanFileKind,
  getPdfPageCount,
  PLAN_FILE_ACCEPT,
  readImageFileAsDataUrl,
  readTextFile,
  renderPdfPageToDataUrl,
  type EncodedImage,
  type PlanFileKind,
} from "@/lib/obra/client-files"
import {
  countEntitiesByLayer,
  disciplineFromElementTypes,
  DXF_INSUNITS_LABELS,
  dxfToElementDrafts,
  parseDxf,
  suggestLayerMapping,
  type DxfLayerMapping,
  type DxfToDraftsResult,
  type ParsedDxf,
} from "@/lib/obra/dxf"
import {
  DISCIPLINE_LABELS,
  DISCIPLINES,
  ELEMENT_TYPE_LABELS,
  type Discipline,
  type ElementType,
  type PlanElementDraft,
  type PlanLayer,
} from "@/lib/obra/types"
import { ElementTypeSelectItems } from "./element-tools"
import { ElementsPreviewSvg } from "./extraction-review"
import { formatNumberCL } from "./plan-canvas"
import { callAction } from "./task-card"

/** Límites (espejo de LAYER_LIMITS en lib/obra/server/layers.ts). */
const LIMITS = { nameMax: 120, levelMin: -10, levelMax: 200, levelLabelMax: 100, widthMin: 1, widthMax: 5000 } as const
/** Tamaño de cada lote al importar elementos de un DXF (bajo el límite de 8 MB por llamada). */
const CHUNK_ELEMENTS = 800
const CHUNK_POINTS = 40_000
const SKIP = "__skip__"

const DWG_MESSAGE =
  "Los archivos DWG no se pueden leer directamente. Ábrelo en AutoCAD (u otro programa CAD), usa «Guardar como» → DXF (ASCII) y sube ese archivo."

type DxfState = { parsed: ParsedDxf; mapping: DxfLayerMapping; result: DxfToDraftsResult; counts: [string, number][] }

function baseName(fileName: string): string {
  const n = fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim()
  return n.slice(0, LIMITS.nameMax)
}

function parseDecimal(s: string): number {
  const t = s.trim().replace(",", ".")
  return t === "" ? NaN : Number(t)
}

function chunkDrafts(drafts: PlanElementDraft[]): PlanElementDraft[][] {
  const out: PlanElementDraft[][] = []
  let cur: PlanElementDraft[] = []
  let pts = 0
  for (const d of drafts) {
    const n = d.geometry?.points?.length ?? 1
    if (cur.length > 0 && (cur.length >= CHUNK_ELEMENTS || pts + n > CHUNK_POINTS)) {
      out.push(cur)
      cur = []
      pts = 0
    }
    cur.push(d)
    pts += n
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/** Clave del mapeo para una capa CAD (sin distinguir mayúsculas, como dxfToElementDrafts). */
function mappingKeyFor(mapping: DxfLayerMapping, cadLayer: string): string {
  if (Object.prototype.hasOwnProperty.call(mapping, cadLayer)) return cadLayer
  const upper = cadLayer.toUpperCase()
  return Object.keys(mapping).find((k) => k.toUpperCase() === upper) ?? cadLayer
}

function mappedTypes(mapping: DxfLayerMapping): ElementType[] {
  return Object.values(mapping).filter((t): t is ElementType => Boolean(t))
}

export type LayerUploadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  /** Nivel propuesto (el que se está viendo). */
  defaultLevel?: number | null
  /** Capas existentes (para proponer la etiqueta del nivel). */
  layers?: PlanLayer[]
  onCreated: (layer: PlanLayer, info: { elements: number }) => void
}

export function LayerUploadDialog(props: LayerUploadDialogProps) {
  const { open, onOpenChange } = props
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle>Subir capa de plano</DialogTitle>
          <DialogDescription>
            Una capa es la lámina de una especialidad en un nivel (p.ej. «Alcantarillado · Primer piso»). Puedes subir una
            imagen, un PDF o un DXF.
          </DialogDescription>
        </DialogHeader>
        {open ? <UploadForm {...props} onBusyChange={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function UploadForm({
  projectId,
  defaultLevel,
  layers = [],
  onOpenChange,
  onCreated,
  onBusyChange,
}: LayerUploadDialogProps & { onBusyChange: (busy: boolean) => void }) {
  const formId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const initialLevel = defaultLevel ?? 0
  const labelForLevel = (lvl: number) =>
    layers.find((l) => l.level === lvl && l.level_label && l.level_label.trim())?.level_label?.trim() ?? ""

  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [discipline, setDiscipline] = useState<Discipline>("arquitectura")
  const [disciplineTouched, setDisciplineTouched] = useState(false)
  const [level, setLevel] = useState(String(initialLevel))
  const [levelLabelText, setLevelLabelText] = useState(() => labelForLevel(initialLevel))
  const [levelLabelTouched, setLevelLabelTouched] = useState(false)
  const [widthM, setWidthM] = useState("50")
  const [widthTouched, setWidthTouched] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<PlanFileKind | null>(null)
  const [fileBusy, setFileBusy] = useState<string | null>(null)
  const [image, setImage] = useState<EncodedImage | null>(null)
  const [pdf, setPdf] = useState<{ pages: number; page: number } | null>(null)
  const [dxf, setDxf] = useState<DxfState | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null)

  const saving = progress !== null
  const working = saving || fileBusy !== null

  function changeLevel(v: string) {
    setLevel(v)
    const n = Number(v)
    if (!levelLabelTouched && Number.isInteger(n)) setLevelLabelText(labelForLevel(n))
  }

  function applyDxfMapping(parsed: ParsedDxf, mapping: DxfLayerMapping, counts: [string, number][], isNew: boolean) {
    const result = dxfToElementDrafts(parsed, mapping)
    setDxf({ parsed, mapping, result, counts })
    if (!disciplineTouched) {
      const types = mappedTypes(mapping)
      if (types.length > 0) setDiscipline(disciplineFromElementTypes(types))
    }
    if (isNew && !widthTouched && result.suggested_width_m != null) {
      const w = result.suggested_width_m
      if (w >= LIMITS.widthMin && w <= LIMITS.widthMax) setWidthM(formatNumberCL(w, 2).replace(/\./g, ""))
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setFile(f)
    setImage(null)
    setPdf(null)
    setDxf(null)
    setFileError(null)
    setError(null)
    const k = detectPlanFileKind(f)
    setKind(k)
    if (!nameTouched) setName(baseName(f.name))
    if (k === "dwg") {
      setFileError(DWG_MESSAGE)
      return
    }
    if (k === "unknown") {
      setFileError("Formato no reconocido. Sube una imagen (PNG, JPG o WebP), un PDF o un DXF.")
      return
    }
    setFileBusy("Leyendo el archivo…")
    onBusyChange(true)
    try {
      if (k === "image") {
        setImage(await readImageFileAsDataUrl(f))
      } else if (k === "pdf") {
        const pages = await getPdfPageCount(f)
        setPdf({ pages, page: 1 })
        setFileBusy("Dibujando la página 1 del PDF…")
        setImage(await renderPdfPageToDataUrl(f, 1))
      } else if (k === "dxf") {
        const text = await readTextFile(f)
        setFileBusy("Interpretando el DXF…")
        // Deja que el navegador pinte el aviso antes del cálculo (síncrono).
        await new Promise((r) => setTimeout(r, 30))
        const parsed = parseDxf(text)
        const counts = Object.entries(countEntitiesByLayer(parsed))
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        if (counts.length === 0) throw new Error("El DXF no tiene entidades que se puedan importar (líneas, polilíneas, círculos o bloques).")
        applyDxfMapping(parsed, suggestLayerMapping(parsed), counts, true)
      }
    } catch (err) {
      setFileError(err instanceof Error && err.message ? err.message : "No se pudo leer el archivo.")
      setImage(null)
      setPdf(null)
      setDxf(null)
    } finally {
      setFileBusy(null)
      onBusyChange(false)
    }
  }

  async function changePdfPage(page: number) {
    if (!file || !pdf) return
    setPdf({ ...pdf, page })
    setFileBusy(`Dibujando la página ${page} del PDF…`)
    onBusyChange(true)
    try {
      setImage(await renderPdfPageToDataUrl(file, page))
      setFileError(null)
    } catch (err) {
      setFileError(err instanceof Error && err.message ? err.message : "No se pudo dibujar la página.")
      setImage(null)
    } finally {
      setFileBusy(null)
      onBusyChange(false)
    }
  }

  function changeMapping(cadLayer: string, value: string) {
    if (!dxf) return
    const key = mappingKeyFor(dxf.mapping, cadLayer)
    const mapping = { ...dxf.mapping, [key]: value === SKIP ? null : (value as ElementType) }
    try {
      applyDxfMapping(dxf.parsed, mapping, dxf.counts, false)
    } catch (err) {
      setFileError(err instanceof Error && err.message ? err.message : "No se pudo convertir el DXF.")
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError("Escribe el nombre de la capa.")
    const lvl = Number(level)
    if (level.trim() === "" || !Number.isInteger(lvl) || lvl < LIMITS.levelMin || lvl > LIMITS.levelMax) {
      return setError(`El nivel debe ser un número entero entre ${LIMITS.levelMin} y ${LIMITS.levelMax} (0 = primer piso, −1 = subterráneo).`)
    }
    const w = parseDecimal(widthM)
    if (!Number.isFinite(w) || w < LIMITS.widthMin || w > LIMITS.widthMax) {
      return setError(`El ancho real de la lámina debe estar entre ${LIMITS.widthMin} y ${LIMITS.widthMax} metros.`)
    }
    if (!image && !dxf) return setError("Elige el archivo de la lámina (imagen, PDF o DXF).")
    if (dxf && dxf.result.drafts.length === 0) {
      return setError("Con la asignación actual no se importa ningún elemento. Asigna un tipo a al menos una capa CAD.")
    }
    setError(null)
    onBusyChange(true)
    setProgress({ label: image ? "Subiendo la lámina…" : "Creando la capa…", value: 10 })

    const created = await callAction(() =>
      createObraLayer(projectId, {
        name: n,
        discipline,
        level: lvl,
        level_label: levelLabelText.trim() || null,
        image: image ? { data_url: image.dataUrl, width_px: image.width, height_px: image.height } : null,
        width_m: w,
        aspect: dxf ? Math.min(100, Math.max(0.01, dxf.result.aspect || 0.7)) : undefined,
      }),
    )
    if (created.ok === false) {
      setProgress(null)
      onBusyChange(false)
      toast.error(created.error)
      return
    }
    const layer = created.data
    let inserted = 0
    if (dxf) {
      const drafts = dxf.result.drafts
      const chunks = chunkDrafts(drafts)
      for (const chunk of chunks) {
        setProgress({
          label: `Importando elementos (${inserted} de ${drafts.length})…`,
          value: 15 + Math.round((85 * inserted) / drafts.length),
        })
        const r = await callAction(() => createObraElements(layer.id, chunk, "dxf"))
        if (r.ok === false) {
          toast.error(`La capa se creó, pero la importación se detuvo: ${r.error}`, {
            description: `Se importaron ${inserted} de ${drafts.length} elementos. Puedes completar a mano o volver a importar en otra capa.`,
          })
          break
        }
        inserted += r.data.inserted
      }
    }
    setProgress({ label: "Listo", value: 100 })
    if (!dxf || inserted === dxf.result.drafts.length) {
      toast.success(dxf ? `Capa «${layer.name}» creada con ${inserted} elementos.` : `Capa «${layer.name}» creada.`, {
        description: "Si no calza con las demás capas del nivel, usa «Alinear y editar».",
      })
    }
    onBusyChange(false)
    onCreated(layer, { elements: inserted })
    onOpenChange(false)
  }

  const warnings = dxf ? [...dxf.parsed.warnings, ...dxf.result.warnings].slice(0, 6) : []
  const unitsLabel =
    dxf && dxf.parsed.insunits != null ? DXF_INSUNITS_LABELS[dxf.parsed.insunits] ?? `código ${dxf.parsed.insunits}` : null

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {/* Archivo */}
      <section className="space-y-2" aria-labelledby={`${formId}-file-title`}>
        <h3 id={`${formId}-file-title`} className="text-sm font-semibold">
          1. Archivo de la lámina
        </h3>
        <input
          ref={fileRef}
          type="file"
          accept={PLAN_FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${formId}-file-title`}
          onChange={onFile}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="h-10" onClick={() => fileRef.current?.click()} disabled={working}>
            <FileUp className="h-4 w-4" aria-hidden />
            {file ? "Cambiar archivo" : "Elegir archivo"}
          </Button>
          <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
            {file ? file.name : "Imagen (PNG, JPG, WebP), PDF o DXF. Los DWG hay que exportarlos como DXF."}
          </p>
        </div>
        {fileBusy ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {fileBusy}
          </p>
        ) : null}
        {fileError ? (
          <p className="flex items-start gap-2 rounded-[10px] bg-danger-tint px-3 py-2 text-[13px] text-danger" role="alert">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {fileError}
          </p>
        ) : null}

        {kind === "pdf" && pdf && pdf.pages > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${formId}-page`}>Página del PDF</Label>
            <Select value={String(pdf.page)} onValueChange={(v) => void changePdfPage(Number(v))} disabled={working}>
              <SelectTrigger id={`${formId}-page`} className="h-10 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: Math.min(pdf.pages, 300) }, (_, i) => i + 1).map((p) => (
                  <SelectItem key={p} value={String(p)} className="min-h-10">
                    Página {p} de {pdf.pages}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {image ? (
          <figure className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (data URL) */}
            <img
              src={image.dataUrl}
              alt="Vista previa de la lámina"
              className="max-h-64 w-full rounded-[10px] border border-border bg-white object-contain"
            />
            <figcaption className="text-[12px] text-muted-foreground">
              {image.width} × {image.height} px · proporción alto/ancho {formatNumberCL(image.height / image.width, 2)}
            </figcaption>
          </figure>
        ) : null}
      </section>

      {/* DXF: capas CAD → tipos */}
      {dxf ? (
        <section className="space-y-2" aria-labelledby={`${formId}-dxf-title`}>
          <h3 id={`${formId}-dxf-title`} className="text-sm font-semibold">
            2. Qué es cada capa del DXF
          </h3>
          <p className="text-[12.5px] text-muted-foreground">
            El tipo se propone según el nombre de la capa CAD. Cámbialo si no corresponde o elige «No importar».
            {unitsLabel ? ` Unidades del dibujo: ${unitsLabel}.` : " El archivo no declara unidades."}
          </p>
          <div className="max-h-72 overflow-y-auto rounded-[12px] border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-secondary text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Capa CAD
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    Entidades
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Importar como
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    Elementos
                  </th>
                </tr>
              </thead>
              <tbody>
                {dxf.counts.map(([cad, count]) => {
                  const value = dxf.mapping[mappingKeyFor(dxf.mapping, cad)] ?? SKIP
                  const generated = dxf.result.per_layer[cad] ?? 0
                  return (
                    <tr key={cad} className="border-t border-border">
                      <th scope="row" className="max-w-[180px] truncate px-3 py-1.5 text-left font-medium" title={cad}>
                        {cad}
                      </th>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{count}</td>
                      <td className="px-3 py-1.5">
                        <Select value={value} onValueChange={(v) => changeMapping(cad, v)} disabled={saving}>
                          <SelectTrigger className="h-10 w-full min-w-[180px]" aria-label={`Tipo para la capa CAD ${cad}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP} className="min-h-10">
                              No importar
                            </SelectItem>
                            <SelectSeparator />
                            <ElementTypeSelectItems />
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{value === SKIP ? "—" : generated}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[13px]">
            Se importarán <span className="font-semibold">{dxf.result.drafts.length}</span> elementos
            {dxf.result.drafts.length > 0
              ? ` (${mappedTypes(dxf.mapping)
                  .filter((t, i, a) => a.indexOf(t) === i)
                  .map((t) => ELEMENT_TYPE_LABELS[t])
                  .slice(0, 4)
                  .join(", ")}${new Set(mappedTypes(dxf.mapping)).size > 4 ? "…" : ""})`
              : ""}
            .
          </p>
          {dxf.result.skipped > 0 ? (
            <p className="text-[12.5px] text-warning">
              Hay más elementos de los que se pueden importar de una vez: {dxf.result.skipped} quedaron fuera. Desmarca
              capas CAD que no necesites.
            </p>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-muted-foreground">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {dxf.result.drafts.length > 0 ? (
            <ElementsPreviewSvg
              elements={dxf.result.drafts}
              aspect={dxf.result.aspect}
              discipline={discipline}
              className="max-h-[340px]"
              ariaLabel={`Vista previa del DXF: ${dxf.result.drafts.length} elementos`}
            />
          ) : null}
        </section>
      ) : null}

      {/* Datos de la capa */}
      <section className="space-y-3" aria-labelledby={`${formId}-data-title`}>
        <h3 id={`${formId}-data-title`} className="text-sm font-semibold">
          {dxf ? "3." : "2."} Datos de la capa
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-name`}>Nombre</Label>
            <Input
              id={`${formId}-name`}
              value={name}
              maxLength={LIMITS.nameMax}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
              placeholder="Ej.: Alcantarillado primer piso"
              className="h-10"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-disc`}>Especialidad</Label>
            <Select
              value={discipline}
              onValueChange={(v) => {
                setDiscipline(v as Discipline)
                setDisciplineTouched(true)
              }}
            >
              <SelectTrigger id={`${formId}-disc`} className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCIPLINES.map((d) => (
                  <SelectItem key={d} value={d} className="min-h-10">
                    {DISCIPLINE_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-level`}>Nivel</Label>
            <Input
              id={`${formId}-level`}
              type="number"
              inputMode="numeric"
              step={1}
              min={LIMITS.levelMin}
              max={LIMITS.levelMax}
              value={level}
              onChange={(e) => changeLevel(e.target.value)}
              className="h-10"
              aria-describedby={`${formId}-level-hint`}
            />
            <p id={`${formId}-level-hint`} className="text-[12px] text-muted-foreground">
              0 = primer piso, 1 = segundo piso, −1 = subterráneo.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-level-label`}>Nombre del nivel (opcional)</Label>
            <Input
              id={`${formId}-level-label`}
              value={levelLabelText}
              maxLength={LIMITS.levelLabelMax}
              onChange={(e) => {
                setLevelLabelText(e.target.value)
                setLevelLabelTouched(true)
              }}
              placeholder="Ej.: Primer piso"
              className="h-10"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${formId}-width`}>Ancho real de la lámina (metros)</Label>
            <Input
              id={`${formId}-width`}
              inputMode="decimal"
              value={widthM}
              onChange={(e) => {
                setWidthM(e.target.value)
                setWidthTouched(true)
              }}
              className="h-10 sm:w-48"
              aria-describedby={`${formId}-width-hint`}
            />
            <p id={`${formId}-width-hint`} className="text-[12px] text-muted-foreground">
              {dxf && dxf.result.suggested_width_m != null
                ? `Según las unidades del DXF, el dibujo mide ${formatNumberCL(dxf.result.suggested_width_m, 2)} m de ancho.`
                : "Cuántos metros reales cubre la lámina de lado a lado. Con esto se miden las distancias entre hallazgos y redes."}
            </p>
          </div>
        </div>
      </section>

      {progress ? (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {progress.label}
          </p>
          <Progress value={progress.value} className="h-2 bg-secondary" aria-label={progress.label} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" disabled={working} onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" className="h-10" disabled={working || (!image && !dxf)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {dxf ? `Crear capa e importar ${dxf.result.drafts.length} elementos` : "Crear capa"}
        </Button>
      </DialogFooter>
    </form>
  )
}
