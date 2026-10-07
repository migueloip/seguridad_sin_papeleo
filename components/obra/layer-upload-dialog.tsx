"use client"

/**
 * Subir una capa de plano (permiso plans.manage): nombre, especialidad, nivel,
 * etiqueta del nivel y ancho real en metros, más el archivo:
 * - imagen (PNG/JPG/WebP): se envía con su resolución completa (hasta
 *   6000 px; PNG/JPEG/WebP sin recomprimir);
 * - PDF: se elige la página y se dibuja en el navegador (pdf.js);
 * - si la lámina cabe en el límite inline (≈ 3,2 MB) viaja como data URL en
 *   la server action; si no, se pide un permiso firmado y el navegador la sube
 *   DIRECTO a Supabase Storage (PUT con progreso, cancelable con «Cancelar
 *   subida»), y la capa se crea con esa ruta y una copia reducida para la
 *   detección con IA. Si el servidor no tiene Supabase (`directUpload`
 *   false), la lámina se prepara reducida desde el principio (inline); si la
 *   subida directa falla, se muestra el motivo y se ofrece reducirla;
 * - DXF (ASCII): se leen las entidades vectoriales, se asigna un tipo a cada
 *   capa CAD (sugerido por su nombre, editable), se revisa la vista previa y
 *   se crea una capa sin imagen con sus elementos (en lotes, con progreso);
 * - DWG: no se puede leer; se pide exportarlo como DXF.
 */
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { toast } from "sonner"
import { FileUp, Loader2, TriangleAlert, Upload } from "lucide-react"
import { createObraElements } from "@/app/actions/obra/elements"
import { createObraLayer, createObraLayerUploadTicket } from "@/app/actions/obra/layers"
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
  blobToDataUrl,
  detectPlanFileKind,
  estimateDataUrlBytes,
  fitsInline,
  formatMegabytes,
  getPdfPageCount,
  PLAN_FILE_ACCEPT,
  PlanUploadError,
  readImageFileAsDataUrl,
  readImageFileForUpload,
  readTextFile,
  renderPdfPageForUpload,
  renderPdfPageToDataUrl,
  UPLOAD_NETWORK_ERROR,
  uploadToSignedUrl,
  type EncodedImage,
  type PlanFileKind,
  type PlanImageMime,
  type PreparedPlanImage,
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
import { callAction, NETWORK_ERROR } from "./task-card"

/** Límites (espejo de LAYER_LIMITS en lib/obra/server/layers.ts). */
const LIMITS = { nameMax: 120, levelMin: -10, levelMax: 200, levelLabelMax: 100, widthMin: 1, widthMax: 5000 } as const
/** Tamaño de cada lote al importar elementos de un DXF (bajo el límite de 8 MB por llamada). */
const CHUNK_ELEMENTS = 800
const CHUNK_POINTS = 40_000
const SKIP = "__skip__"

const DWG_MESSAGE =
  "Los archivos DWG no se pueden leer directamente. Ábrelo en AutoCAD (u otro programa CAD), usa «Guardar como» → DXF (ASCII) y sube ese archivo."

type DxfState = { parsed: ParsedDxf; mapping: DxfLayerMapping; result: DxfToDraftsResult; counts: [string, number][] }

/**
 * Lámina lista para enviar: como Blob (resolución completa; inline o subida
 * directa según su peso) o como data URL ya reducido (envío inline).
 */
type PlanImage = {
  width: number
  height: number
  mime: PlanImageMime
  bytes: number
  blob: Blob | null
  dataUrl: string | null
  /** URL de la vista previa (blob: se revoca al cambiar de lámina). */
  previewUrl: string
  reencoded: boolean
}

function fromPrepared(p: PreparedPlanImage): PlanImage {
  return { ...p, bytes: p.blob.size, dataUrl: null, previewUrl: URL.createObjectURL(p.blob) }
}

function fromEncoded(e: EncodedImage): PlanImage {
  const mime: PlanImageMime = e.mime === "image/png" || e.mime === "image/webp" ? e.mime : "image/jpeg"
  return {
    width: e.width,
    height: e.height,
    mime,
    bytes: estimateDataUrlBytes(e.dataUrl),
    blob: null,
    dataUrl: e.dataUrl,
    previewUrl: e.dataUrl,
    reencoded: true,
  }
}

/** ¿Se envía inline (data URL en la server action) o hay que subirla directo a Storage? */
function sendsInline(img: PlanImage): boolean {
  return img.dataUrl !== null || (img.blob !== null && fitsInline({ blob: img.blob, mime: img.mime }))
}

/** Errores en los que reducir la lámina no ayuda (permisos o sesión). */
const NO_FALLBACK_RE = /no permite|Sesión no válida|no encontrad/i

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
  /**
   * ¿El servidor tiene Supabase Storage para la subida directa? (isSupabaseStorageEnabled,
   * desde la página). Si es false, las láminas se reducen al límite inline al elegirlas.
   */
  directUpload?: boolean
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
  directUpload = true,
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
  const [image, setImageState] = useState<PlanImage | null>(null)
  const [pdf, setPdf] = useState<{ pages: number; page: number } | null>(null)
  const [dxf, setDxf] = useState<DxfState | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null)
  /** Motivo por el que no se pudo subir directo (sin Supabase, red/CORS…): se ofrece reducir la lámina. */
  const [fallback, setFallback] = useState<string | null>(null)
  /** Última lámina subida directo (para reintentar createObraLayer sin volver a subirla). */
  const uploadedRef = useRef<{ blob: Blob; path: string } | null>(null)
  /** Copia reducida para la IA de la última lámina subida directo (se calcula una vez por archivo). */
  const analysisRef = useRef<{ blob: Blob; dataUrl: string | null } | null>(null)
  /** PUT en curso a Storage (para «Cancelar subida»). */
  const abortRef = useRef<AbortController | null>(null)
  const [uploading, setUploading] = useState(false)

  const saving = progress !== null
  const working = saving || fileBusy !== null

  // Si el formulario se desmonta con una subida en curso, se corta.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Libera la URL de la vista previa al cambiar de lámina o cerrar el diálogo.
  useEffect(
    () => () => {
      if (image?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl)
    },
    [image],
  )

  function setImage(next: PlanImage | null) {
    setImageState(next)
    setFallback(null)
  }

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
    uploadedRef.current = null
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
        // Sin subida directa, se reduce al límite inline desde el principio (un solo paso).
        setImage(directUpload ? fromPrepared(await readImageFileForUpload(f)) : fromEncoded(await readImageFileAsDataUrl(f)))
      } else if (k === "pdf") {
        const pages = await getPdfPageCount(f)
        setPdf({ pages, page: 1 })
        setFileBusy("Dibujando la página 1 del PDF…")
        setImage(await renderPdfPage(f, 1))
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

  /** Página de un PDF: con resolución alta para subida directa, o reducida si no hay subida directa. */
  async function renderPdfPage(f: File, page: number): Promise<PlanImage> {
    return directUpload ? fromPrepared(await renderPdfPageForUpload(f, page)) : fromEncoded(await renderPdfPageToDataUrl(f, page))
  }

  async function changePdfPage(page: number) {
    if (!file || !pdf) return
    setPdf({ ...pdf, page })
    setFileBusy(`Dibujando la página ${page} del PDF…`)
    onBusyChange(true)
    try {
      setImage(await renderPdfPage(file, page))
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

  /**
   * Sube la lámina directo a Supabase Storage: permiso firmado → PUT con
   * progreso (cancelable). Devuelve la ruta o null (con el motivo en
   * `fallback`, salvo si la persona canceló). Si el permiso venció o la ruta
   * ya existía, reintenta una vez con otro permiso.
   */
  async function uploadDirect(img: PlanImage, blob: Blob): Promise<string | null> {
    const cached = uploadedRef.current
    if (cached && cached.blob === blob) return cached.path
    for (let attempt = 0; attempt < 2; attempt++) {
      setProgress({ label: "Pidiendo permiso para subir la lámina…", value: 3 })
      const ticket = await callAction(() => createObraLayerUploadTicket(projectId, { mime: img.mime, size_bytes: blob.size }))
      if (ticket.ok === false) {
        setFallback(ticket.error)
        return null
      }
      const total = formatMegabytes(blob.size)
      const controller = new AbortController()
      abortRef.current = controller
      setUploading(true)
      try {
        await uploadToSignedUrl(ticket.data.upload_url, blob, ticket.data.mime, {
          signal: controller.signal,
          onProgress: (f) =>
            setProgress({ label: `Subiendo la lámina (${Math.round(f * 100)} % de ${total})…`, value: 5 + Math.round(f * 80) }),
        })
        uploadedRef.current = { blob, path: ticket.data.path }
        return ticket.data.path
      } catch (err) {
        const e = err instanceof PlanUploadError ? err : new PlanUploadError(UPLOAD_NETWORK_ERROR, "network", 0)
        if (e.kind === "aborted") {
          toast.info("Se canceló la subida de la lámina.")
          return null
        }
        if ((e.kind === "expired" || e.kind === "conflict") && attempt === 0) continue
        setFallback(e.message)
        return null
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setUploading(false)
      }
    }
    return null
  }

  /**
   * Copia reducida (≤ 3000 px, data URL bajo el límite inline) de una lámina
   * subida directo: es la que usa «Detectar con IA», que no acepta láminas de
   * 25 MB. Si no se puede preparar, la capa se crea igual (sin copia).
   */
  async function analysisCopy(img: PlanImage): Promise<string | null> {
    const blob = img.blob
    if (!blob) return null
    if (analysisRef.current?.blob === blob) return analysisRef.current.dataUrl
    let dataUrl: string | null = null
    try {
      const ext = img.mime === "image/png" ? "png" : img.mime === "image/webp" ? "webp" : "jpg"
      dataUrl = (await readImageFileAsDataUrl(new File([blob], `lamina.${ext}`, { type: img.mime }))).dataUrl
    } catch {
      dataUrl = null
    }
    analysisRef.current = { blob, dataUrl }
    return dataUrl
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void doSubmit(image)
  }

  /** Reduce la lámina al límite inline (como antes de la subida directa) y la envía por la server action. */
  async function reduceAndSubmit() {
    if (!file || (kind !== "image" && kind !== "pdf")) return
    setFallback(null)
    setFileBusy("Reduciendo la lámina para enviarla sin el almacenamiento de archivos…")
    onBusyChange(true)
    let reduced: PlanImage
    try {
      const encoded = kind === "pdf" ? await renderPdfPageToDataUrl(file, pdf?.page ?? 1) : await readImageFileAsDataUrl(file)
      reduced = fromEncoded(encoded)
    } catch (err) {
      setFileError(err instanceof Error && err.message ? err.message : "No se pudo reducir la lámina.")
      return
    } finally {
      setFileBusy(null)
      onBusyChange(false)
    }
    setImage(reduced)
    await doSubmit(reduced)
  }

  async function doSubmit(img: PlanImage | null) {
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
    if (!img && !dxf) return setError("Elige el archivo de la lámina (imagen, PDF o DXF).")
    if (dxf && dxf.result.drafts.length === 0) {
      return setError("Con la asignación actual no se importa ningún elemento. Asigna un tipo a al menos una capa CAD.")
    }
    setError(null)
    setFallback(null)
    onBusyChange(true)
    setProgress({ label: img ? "Preparando la lámina…" : "Creando la capa…", value: img ? 2 : 10 })

    const stop = () => {
      setProgress(null)
      onBusyChange(false)
    }
    let picture: {
      image?: { data_url: string; width_px: number; height_px: number }
      image_upload?: { path: string; width_px: number; height_px: number; analysis_data_url?: string }
    } = {}
    if (img) {
      if (sendsInline(img)) {
        let dataUrl: string
        try {
          dataUrl = img.dataUrl ?? (await blobToDataUrl(img.blob as Blob, img.mime))
        } catch {
          stop()
          return setError("No se pudo leer la lámina. Vuelve a elegir el archivo.")
        }
        picture = { image: { data_url: dataUrl, width_px: img.width, height_px: img.height } }
        setProgress({ label: "Subiendo la lámina…", value: 10 })
      } else {
        const path = await uploadDirect(img, img.blob as Blob)
        if (!path) return stop()
        setProgress({ label: "Preparando una copia reducida para la detección con IA…", value: 86 })
        const analysis = await analysisCopy(img)
        picture = {
          image_upload: {
            path,
            width_px: img.width,
            height_px: img.height,
            ...(analysis ? { analysis_data_url: analysis } : {}),
          },
        }
        setProgress({ label: "Creando la capa…", value: 88 })
      }
    }

    const origin = dxf?.result.origin ?? null
    const created = await callAction(() =>
      createObraLayer(projectId, {
        name: n,
        discipline,
        level: lvl,
        level_label: levelLabelText.trim() || null,
        ...picture,
        width_m: w,
        // dxfToElementDrafts ya entrega la proporción entre 0,01 y 100 (ensancha la lámina si hace falta).
        aspect: dxf ? Math.min(100, Math.max(0.01, dxf.result.aspect || 0.7)) : undefined,
        cad_origin:
          dxf && origin && dxf.result.width_units > 0
            ? { min_x: origin.min_x, max_y: origin.max_y, width_units: dxf.result.width_units }
            : null,
      }),
    )
    if (created.ok === false) {
      stop()
      // Si el servidor rechazó la lámina subida (inválida o ya usada), la próxima vez se sube de nuevo.
      if (picture.image_upload && created.error !== NETWORK_ERROR) uploadedRef.current = null
      // Una lámina inline pesada puede superar el límite de envío del servidor: el error llega como falla de red.
      toast.error(
        created.error === NETWORK_ERROR && picture.image
          ? "No se pudo enviar la lámina. Si el archivo es muy pesado, prueba con una imagen de menor resolución o exporta solo la lámina necesaria; si no, revisa tu conexión."
          : created.error,
      )
      return
    }
    uploadedRef.current = null
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
      const dxfRef = dxf ? layers.find((l) => l.level === lvl && l.cad_origin) : undefined
      const moved = layer.frame.offset_x_m !== 0 || layer.frame.offset_y_m !== 0 || layer.frame.rotation_deg !== 0
      toast.success(dxf ? `Capa «${layer.name}» creada con ${inserted} elementos.` : `Capa «${layer.name}» creada.`, {
        description:
          dxfRef && moved
            ? "Se alineó con las demás capas DXF del nivel usando las coordenadas del dibujo. Si algo no calza, usa «Alinear y editar»."
            : "Si no calza con las demás capas del nivel, usa «Alinear y editar».",
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
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob: o data URL) */}
            <img
              src={image.previewUrl}
              alt="Vista previa de la lámina"
              className="max-h-64 w-full rounded-[10px] border border-border bg-white object-contain"
            />
            <figcaption className="text-[12px] text-muted-foreground">
              {image.width} × {image.height} px · {formatMegabytes(image.bytes)} · proporción alto/ancho{" "}
              {formatNumberCL(image.height / image.width, 2)}
              {sendsInline(image) || !directUpload
                ? ""
                : " · se subirá directo al almacenamiento de archivos, con su resolución completa"}
            </figcaption>
          </figure>
        ) : null}

        {fallback ? (
          <div className="space-y-2 rounded-[10px] bg-danger-tint px-3 py-2 text-[13px] text-danger" role="alert">
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {fallback}
            </p>
            {!NO_FALLBACK_RE.test(fallback) && (kind === "image" || kind === "pdf") ? (
              <Button
                type="button"
                variant="outline"
                className="h-10 bg-background"
                disabled={working}
                onClick={() => void reduceAndSubmit()}
              >
                Reducir la lámina y crear la capa igual
              </Button>
            ) : null}
          </div>
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
        {uploading ? (
          // Durante el PUT a Storage (hasta 25 MB) se puede cortar la subida; luego el diálogo se cierra normal.
          <Button type="button" variant="outline" className="h-10" onClick={() => abortRef.current?.abort()}>
            Cancelar subida
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-10" disabled={working} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="h-10" disabled={working || (!image && !dxf)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {dxf ? `Crear capa e importar ${dxf.result.drafts.length} elementos` : "Crear capa"}
        </Button>
      </DialogFooter>
    </form>
  )
}
