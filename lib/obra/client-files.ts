/**
 * Utilidades de archivos de planos para el navegador (módulo Obra Integral).
 *
 * - Imagen (PNG/JPG/WebP...) o página de PDF → data URL acotado en lado y en
 *   peso, listo para enviarse a un server action (límite de cuerpo: 8 MB).
 * - DXF → texto (UTF-8 o, si no es válido, Windows-1252, típico de AutoCAD).
 * - Detección del tipo de archivo por extensión y tipo MIME.
 *
 * Solo funciones de navegador (usan canvas, FileReader e Image); no importa
 * nada de servidor. Las funciones puras (detectPlanFileKind,
 * estimateDataUrlBytes) también funcionan en Node/jsdom.
 */

// ---------------------------------------------------------------------------
// Límites
// ---------------------------------------------------------------------------

/** Lado mayor máximo (px) de la imagen de una capa. */
export const PLAN_IMAGE_MAX_SIDE = 3000
/** Largo máximo del data URL resultante (≈ bytes enviados al servidor). */
export const PLAN_IMAGE_MAX_BYTES = 6_500_000
/** Al recomprimir para cumplir el peso, no se reduce por debajo de este lado (px). */
export const PLAN_IMAGE_MIN_SIDE = 480
/** Ancho objetivo (px) al rasterizar una página de PDF. */
export const PDF_TARGET_WIDTH = 2400
/** Lado mayor máximo (px) al rasterizar un PDF (páginas muy alargadas). */
export const PDF_MAX_SIDE = 4096
/** Píxeles máximos de un canvas (Safari iOS falla sobre ~16,7 MP). */
export const CANVAS_MAX_PIXELS = 16_000_000
/** Calidades JPEG que se prueban, en orden, cuando el PNG supera el peso máximo. */
export const JPEG_QUALITIES: readonly number[] = [0.85, 0.7]
/** Tamaño máximo del archivo original de imagen o PDF que se intenta procesar. */
export const PLAN_FILE_MAX_BYTES = 60 * 1024 * 1024
/** Tamaño máximo de un archivo de texto (DXF ASCII). */
export const TEXT_FILE_MAX_BYTES = 30 * 1024 * 1024
/** Worker de pdf.js (mismo origen que components/upload-content.tsx). */
export const PDFJS_WORKER_SRC = "https://unpkg.com/pdfjs-dist@4/build/pdf.worker.min.mjs"
/** Valor para el atributo accept de un <input type="file"> de planos. */
export const PLAN_FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.dxf,image/png,image/jpeg,image/webp,application/pdf"

export type PlanFileKind = "image" | "pdf" | "dxf" | "dwg" | "unknown"

export type EncodedImage = { dataUrl: string; width: number; height: number; mime: string }

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "webp", "gif", "bmp", "avif", "svg"])
const UNDECODABLE_IMAGE_MIMES = new Set(["image/heic", "image/heif", "image/tiff"])
const DXF_MIMES = new Set(["image/vnd.dxf", "image/x-dxf", "application/dxf", "application/x-dxf"])
const DWG_MIMES = new Set(["image/vnd.dwg", "image/x-dwg", "application/acad", "application/x-acad", "application/dwg", "application/x-dwg"])
/** Formatos que se pueden enviar tal cual si no hay que reducirlos. */
const PASSTHROUGH_MIMES = new Set(["image/png", "image/jpeg", "image/webp"])

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

function extensionOf(name: string): string {
  const n = (name || "").toLowerCase().trim()
  const dot = n.lastIndexOf(".")
  return dot === -1 ? "" : n.slice(dot + 1)
}

/** Tipo de plano según la extensión (prioritaria) y el tipo MIME. */
export function detectPlanFileKind(file: File): PlanFileKind {
  const ext = extensionOf(file?.name ?? "")
  const mime = (file?.type ?? "").toLowerCase().split(";")[0].trim()
  if (ext === "dxf") return "dxf"
  if (ext === "dwg") return "dwg"
  if (ext === "pdf") return "pdf"
  if (IMAGE_EXTENSIONS.has(ext)) return "image"
  if (DXF_MIMES.has(mime)) return "dxf"
  if (DWG_MIMES.has(mime)) return "dwg"
  if (mime === "application/pdf" || mime === "application/x-pdf") return "pdf"
  if (mime.startsWith("image/") && !UNDECODABLE_IMAGE_MIMES.has(mime)) return "image"
  return "unknown"
}

/**
 * Bytes que ocupa el contenido de un data URL una vez decodificado (base64 o
 * texto con %XX). 0 si no es un data URL.
 */
export function estimateDataUrlBytes(dataUrl: string): number {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return 0
  const comma = dataUrl.indexOf(",")
  if (comma === -1) return 0
  const header = dataUrl.slice(5, comma).toLowerCase()
  const payloadLength = dataUrl.length - comma - 1
  if (header.endsWith(";base64")) {
    let padding = 0
    if (dataUrl.endsWith("==")) padding = 2
    else if (dataUrl.endsWith("=")) padding = 1
    return Math.max(0, Math.floor((payloadLength * 3) / 4) - padding)
  }
  let escapes = 0
  for (let i = comma + 1; i < dataUrl.length; i++) if (dataUrl.charCodeAt(i) === 37) escapes++ // "%"
  return Math.max(0, payloadLength - escapes * 2)
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeImageMime(file: File): string {
  const mime = (file.type || "").toLowerCase().split(";")[0].trim()
  if (mime === "image/jpg" || mime === "image/pjpeg") return "image/jpeg"
  if (mime) return mime
  const ext = extensionOf(file.name)
  if (ext === "png") return "image/png"
  if (ext === "jpg" || ext === "jpeg" || ext === "jfif" || ext === "pjpeg" || ext === "pjp") return "image/jpeg"
  if (ext === "webp") return "image/webp"
  return ""
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

// ---------------------------------------------------------------------------
// Lectura de archivos
// ---------------------------------------------------------------------------

function readAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
    reader.readAsArrayBuffer(file)
  })
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
    reader.readAsDataURL(file)
  })
}

/**
 * Lee un archivo de texto (p.ej. DXF ASCII). Intenta UTF-8 estricto y, si el
 * contenido no es UTF-8 válido, lo decodifica como Windows-1252 (codificación
 * habitual de los DXF exportados por AutoCAD en español).
 */
export async function readTextFile(file: File): Promise<string> {
  if (file.size > TEXT_FILE_MAX_BYTES) {
    throw new Error(`El archivo pesa más de ${formatMb(TEXT_FILE_MAX_BYTES)}. Exporta solo las capas necesarias.`)
  }
  const bytes = new Uint8Array(await readAsArrayBuffer(file))
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder("windows-1252").decode(bytes)
  }
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

type LoadedImage = { source: CanvasImageSource; width: number; height: number; release: () => void }

async function loadImage(file: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file)
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
    } catch {
      // Algunos formatos (p.ej. SVG) solo se decodifican con <img>.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = "async"
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("decode"))
      img.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error("No se pudo leer la imagen. Usa un archivo PNG, JPG o WebP.")
  }
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("El navegador no permite procesar imágenes (canvas no disponible).")
  return { canvas, ctx }
}

function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  // Libera memoria de inmediato (importante en Safari iOS).
  canvas.width = 0
  canvas.height = 0
}

function canvasToDataUrl(canvas: HTMLCanvasElement, mime: string, quality?: number): string {
  let url: string
  try {
    url = canvas.toDataURL(mime, quality)
  } catch {
    throw new Error("El navegador bloqueó la conversión de la imagen. Prueba con un PNG o JPG.")
  }
  if (!url.startsWith("data:image/")) {
    throw new Error("La imagen es demasiado grande para este navegador. Prueba con una de menor resolución.")
  }
  return url
}

/** Dimensiones escaladas para que el lado mayor no supere maxSide ni el área CANVAS_MAX_PIXELS. */
function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(CANVAS_MAX_PIXELS / (width * height)))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Codifica `source` en un data URL de como máximo maxBytes caracteres:
 * PNG primero (si tryPng), luego JPEG 0,85 y 0,7 sobre fondo blanco; si aún no
 * cabe, reduce el tamaño un 25 % y repite.
 */
function encodeWithinBytes(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxBytes: number,
  tryPng: boolean,
): EncodedImage {
  let w = width
  let h = height
  for (let attempt = 0; attempt < 12; attempt++) {
    const { canvas, ctx } = createCanvas(w, h)
    try {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      if (tryPng) {
        ctx.drawImage(source, 0, 0, w, h)
        const png = canvasToDataUrl(canvas, "image/png")
        if (png.length <= maxBytes) return { dataUrl: png, width: w, height: h, mime: "image/png" }
        ctx.clearRect(0, 0, w, h)
      }
      // JPEG no tiene transparencia: fondo blanco para que no quede negro.
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(source, 0, 0, w, h)
      for (const q of JPEG_QUALITIES) {
        const jpg = canvasToDataUrl(canvas, "image/jpeg", q)
        if (jpg.length <= maxBytes) return { dataUrl: jpg, width: w, height: h, mime: "image/jpeg" }
      }
    } finally {
      releaseCanvas(canvas)
    }
    if (Math.max(w, h) <= PLAN_IMAGE_MIN_SIDE) break
    w = Math.max(1, Math.round(w * 0.75))
    h = Math.max(1, Math.round(h * 0.75))
  }
  throw new Error("La imagen sigue siendo demasiado pesada incluso comprimida. Prueba con un archivo más liviano.")
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

/**
 * Lee una imagen y la devuelve como data URL apto para una capa de plano.
 * - Si el lado mayor supera maxSide (3000 px), la reescala con canvas.
 * - Si el resultado (data URL completo) supera maxBytes (6.500.000), la
 *   recodifica como JPEG 0,85 y luego 0,7 y, si aún no cabe, la reduce.
 * - PNG, JPEG y WebP que ya cumplen se envían sin recomprimir. Otros formatos
 *   (GIF, BMP, SVG...) se rasterizan a PNG.
 */
export async function readImageFileAsDataUrl(
  file: File,
  opts: { maxSide?: number; maxBytes?: number } = {},
): Promise<EncodedImage> {
  if (detectPlanFileKind(file) !== "image") {
    throw new Error("El archivo no es una imagen compatible. Usa PNG, JPG o WebP.")
  }
  if (file.size > PLAN_FILE_MAX_BYTES) {
    throw new Error(`La imagen pesa más de ${formatMb(PLAN_FILE_MAX_BYTES)}. Usa una de menor resolución.`)
  }
  const maxSide = Math.round(positiveOr(opts.maxSide, PLAN_IMAGE_MAX_SIDE))
  const maxBytes = positiveOr(opts.maxBytes, PLAN_IMAGE_MAX_BYTES)
  const mime = normalizeImageMime(file)

  const img = await loadImage(file)
  try {
    if (!(img.width > 0 && img.height > 0)) throw new Error("No se pudo leer el tamaño de la imagen.")
    const target = fitSize(img.width, img.height, maxSide)
    const needsResize = target.width !== img.width || target.height !== img.height

    if (!needsResize && PASSTHROUGH_MIMES.has(mime) && file.size <= maxBytes) {
      const original = await readAsDataUrl(file)
      const comma = original.indexOf(",")
      // Asegura el tipo MIME correcto en la cabecera (algunos sistemas no lo informan).
      const dataUrl = comma === -1 ? original : `data:${mime};base64,${original.slice(comma + 1)}`
      if (comma !== -1 && original.slice(0, comma).endsWith(";base64") && dataUrl.length <= maxBytes) {
        return { dataUrl, width: img.width, height: img.height, mime }
      }
    }

    return encodeWithinBytes(img.source, target.width, target.height, maxBytes, mime !== "image/jpeg")
  } finally {
    img.release()
  }
}

// ---------------------------------------------------------------------------
// PDF (pdf.js con import dinámico, solo en el navegador)
// ---------------------------------------------------------------------------

type PdfJs = typeof import("pdfjs-dist")
type PdfDocument = import("pdfjs-dist").PDFDocumentProxy

let pdfjsPromise: Promise<PdfJs> | null = null

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (import("pdfjs-dist") as Promise<PdfJs>)
      .then((pdfjs) => {
        try {
          pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC
        } catch {
          // ya configurado
        }
        return pdfjs
      })
      .catch((e: unknown) => {
        pdfjsPromise = null
        throw e
      })
  }
  return pdfjsPromise
}

async function openPdf(file: File): Promise<PdfDocument> {
  if (detectPlanFileKind(file) !== "pdf") throw new Error("El archivo no es un PDF.")
  if (file.size > PLAN_FILE_MAX_BYTES) {
    throw new Error(`El PDF pesa más de ${formatMb(PLAN_FILE_MAX_BYTES)}. Exporta solo la lámina necesaria.`)
  }
  let pdfjs: PdfJs
  try {
    pdfjs = await loadPdfJs()
  } catch {
    throw new Error("No se pudo cargar el lector de PDF. Revisa tu conexión e intenta de nuevo.")
  }
  const data = new Uint8Array(await readAsArrayBuffer(file))
  try {
    return await pdfjs.getDocument({ data }).promise
  } catch (e) {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : ""
    if (name === "PasswordException") throw new Error("El PDF está protegido con contraseña.")
    throw new Error("El PDF está dañado o no es válido.")
  }
}

/** Cantidad de páginas de un PDF. */
export async function getPdfPageCount(file: File): Promise<number> {
  const pdf = await openPdf(file)
  try {
    return pdf.numPages
  } finally {
    void pdf.destroy()
  }
}

/**
 * Rasteriza una página de un PDF (fondo blanco) a un data URL de como máximo
 * maxBytes caracteres. El ancho se ajusta a targetWidth (2400 px), sin pasar
 * de PDF_MAX_SIDE en el lado mayor ni de CANVAS_MAX_PIXELS.
 */
export async function renderPdfPageToDataUrl(
  file: File,
  pageNumber = 1,
  opts: { targetWidth?: number; maxBytes?: number } = {},
): Promise<EncodedImage> {
  const targetWidth = positiveOr(opts.targetWidth, PDF_TARGET_WIDTH)
  const maxBytes = positiveOr(opts.maxBytes, PLAN_IMAGE_MAX_BYTES)
  const pdf = await openPdf(file)
  let canvas: HTMLCanvasElement | null = null
  try {
    const total = pdf.numPages
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total) {
      throw new Error(`La página ${pageNumber} no existe: el PDF tiene ${total} página${total === 1 ? "" : "s"}.`)
    }
    const page = await pdf.getPage(pageNumber)
    try {
      const base = page.getViewport({ scale: 1 })
      if (!(base.width > 0 && base.height > 0)) throw new Error("La página del PDF no tiene tamaño válido.")
      const scale = Math.min(
        targetWidth / base.width,
        PDF_MAX_SIDE / Math.max(base.width, base.height),
        Math.sqrt(CANVAS_MAX_PIXELS / (base.width * base.height)),
      )
      const viewport = page.getViewport({ scale })
      const width = Math.max(1, Math.floor(viewport.width))
      const height = Math.max(1, Math.floor(viewport.height))
      const created = createCanvas(width, height)
      canvas = created.canvas
      created.ctx.fillStyle = "#ffffff"
      created.ctx.fillRect(0, 0, width, height)
      await page.render({ canvasContext: created.ctx, viewport, background: "rgb(255,255,255)" }).promise
      return encodeWithinBytes(canvas, width, height, maxBytes, true)
    } finally {
      page.cleanup()
    }
  } finally {
    releaseCanvas(canvas)
    void pdf.destroy()
  }
}
