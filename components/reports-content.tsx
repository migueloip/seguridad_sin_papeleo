"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertTriangle,
  GripVertical,
  Trash2,
  History,
  Loader2,
  Sparkles,
  FileText,
  ArrowLeft,
  Plus,
  ChevronUp,
  ChevronDown,
  Download,
  Save,
  Image as ImageIcon,
  Copy,
  Undo2,
  Redo2,
  Minus,
  Wand2,
  Archive,
  Check,
} from "lucide-react"
import type { DesignerElement, EditorState, MatrixRow, PageSize, Severity, Status } from "@/lib/pdf-editor"
import { buildDesignerHtmlFromState, buildEditorHtmlFromState, validateEditorState } from "@/lib/pdf-editor"
import {
  fillPdfDesignerWithAI,
  fillMatrixWithAI,
  getReportById,
  rewriteTextWithAI,
  saveDesignerReport,
  type DesignerSnapshot,
} from "@/app/actions/reports"
import { getWorkers } from "@/app/actions/workers"
import { createDocument, getDocumentTypes } from "@/app/actions/documents"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

interface ReportsContentProps {
  initialReports?: unknown[]
  projectId?: number
  reportId?: number
}

const todayIso = () => new Date().toISOString().slice(0, 10)

// Plantilla estándar de informe de seguridad (estructura profesional consistente).
const standardTemplate = (title: string): DesignerElement[] => {
  const t = Date.now()
  const sec = (id: string, sTitle: string, body: string): DesignerElement =>
    ({
      id: `${id}-${t}`,
      type: "simple_section",
      title: sTitle,
      subtitle: null,
      body,
      bullets: [],
      chips: [],
      align: "left",
    }) as DesignerElement
  return [
    { id: `h-${t}`, type: "heading", text: title || "Informe de Seguridad", level: 1, align: "center" } as DesignerElement,
    {
      id: `st-${t}`,
      type: "plain_text",
      text: `Prevención de riesgos · ${new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}`,
      align: "center",
    } as DesignerElement,
    {
      id: `fld-${t}`,
      type: "table",
      rows: [
        ["Período", "—"],
        ["Cumplimiento", "—"],
        ["Hallazgos abiertos", "—"],
        ["Elaboró", "—"],
      ],
    } as DesignerElement,
    sec("s1", "1. Resumen ejecutivo", "Síntesis del estado de seguridad y prevención del proyecto durante el periodo."),
    sec("s2", "2. Hallazgos de seguridad", "Detalle de los hallazgos detectados: severidad, ubicación, responsable y estado."),
    sec("s3", "3. Cumplimiento documental", "Estado de la documentación del personal: vigentes, por vencer y vencidos."),
    sec("s4", "4. Plan de acción", "Acciones correctivas, responsables y plazos de cumplimiento."),
    sec("s5", "5. Conclusiones y recomendaciones", "Conclusiones del periodo y recomendaciones para el siguiente."),
  ]
}

const defaultRow = (): MatrixRow => ({
  description: "",
  category: "",
  owner: "",
  severity: "medio",
  status: "pendiente",
  date: todayIso(),
})

const ELEMENT_LABEL: Record<DesignerElement["type"], string> = {
  heading: "Encabezado",
  text: "HTML",
  plain_text: "Texto",
  simple_section: "Sección",
  list: "Lista",
  image: "Imagen",
  table: "Tabla",
  matrix: "Matriz",
  quote: "Firma",
  kpis: "Indicadores",
  toc: "Tabla de contenido",
  chart: "Gráfico",
  cover: "Portada",
  signers: "Firmantes",
  docs: "Documentos",
  divider: "Separador",
  page_break: "Salto de página",
}

const blockLabel = (el: DesignerElement): string => {
  if (el.type === "table" && el.rows.every((r) => r.length === 2)) return "Campos"
  return ELEMENT_LABEL[el.type] ?? "Bloque"
}

// Etiquetas de la lista AGREGAR (para el filtro) y normalizador sin tildes.
const ADD_LABELS = [
  "Encabezado H1",
  "Encabezado H2",
  "Texto",
  "Sección",
  "Lista",
  "Tabla",
  "Matriz de hallazgos",
  "Campos (clave-valor)",
  "Firma",
  "Separador",
  "Imagen",
  "Indicadores",
  "Gráfico",
  "Portada",
  "Firmantes",
  "Tabla de contenido",
  "Salto de página",
]
const normalizeLabel = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()

// Validación por bloque: devuelve un aviso si algo falta, o null si está OK.
const validateBlock = (el: DesignerElement): string | null => {
  switch (el.type) {
    case "heading":
      return el.text.trim() ? null : "Encabezado vacío"
    case "plain_text":
      return el.text.trim() ? null : "Texto vacío"
    case "simple_section":
      return el.title.trim() ? null : "Sección sin título"
    case "list":
      return el.items.length ? null : "Lista vacía"
    case "image":
      return el.src ? null : "Imagen sin archivo ni URL"
    case "matrix":
      if (!el.rows.length) return "Matriz sin filas"
      if (el.rows.some((r) => !r.description.trim())) return "Hay hallazgos sin descripción"
      if (el.rows.some((r) => !(r.owner || "").trim())) return "Hay hallazgos sin responsable"
      return null
    case "table":
      return el.rows.length ? null : "Tabla vacía"
    case "kpis":
      return el.items.length ? null : "Sin indicadores"
    case "chart":
      return el.bars.length ? null : "Gráfico sin datos"
    case "cover":
      return el.title.trim() ? null : "Portada sin título"
    case "signers":
      return el.signers.length ? null : "Sin firmantes"
    default:
      return null
  }
}

export function ReportsContent({ initialReports, projectId, reportId }: ReportsContentProps) {
  void initialReports

  const router = useRouter()
  const mode = "designer" as const
  const [brandLogo, setBrandLogo] = useState<string>("")
  const [responsibleName, setResponsibleName] = useState<string>("")
  const [responsibleSignatureDataUrl, setResponsibleSignatureDataUrl] = useState<string | null>(null)

  const [coverTitle, setCoverTitle] = useState<string>("Informe de Seguridad")
  const [coverSubtitle, setCoverSubtitle] = useState<string>("Resumen de prevención de riesgos")
  const [summaryText, setSummaryText] = useState<string>("")
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([])
  const [recsText, setRecsText] = useState<string>("")
  const [editorAlerts, setEditorAlerts] = useState<string[]>([])

  const [aiPrompt, setAiPrompt] = useState<string>("")
  const [aiPeriod, setAiPeriod] = useState<string>("monthly")
  const [aiHistory, setAiHistory] = useState<
    { id: string; createdAt: string; coverTitle: string; coverSubtitle: string; elements: DesignerElement[] }[]
  >([])
  const [isAiPending, startAiTransition] = useTransition()
  const [aiReportType, setAiReportType] = useState<string>("")
  const [isMatrixDialogOpen, setIsMatrixDialogOpen] = useState(false)
  const [isMatrixFillPending, startMatrixFillTransition] = useTransition()
  const [isMatrixElementFillPending, startMatrixElementFillTransition] = useTransition()
  const [isMatrixElementDialogOpen, setIsMatrixElementDialogOpen] = useState(false)
  const [matrixElementDraftRows, setMatrixElementDraftRows] = useState<MatrixRow[]>([])
  const [editingMatrixElementId, setEditingMatrixElementId] = useState<string | null>(null)

  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [saveWorkers, setSaveWorkers] = useState<
    { id: number; first_name: string; last_name: string; rut: string | null }[]
  >([])
  const [saveDocumentTypes, setSaveDocumentTypes] = useState<{ id: number; name: string }[]>([])
  const [saveWorkerId, setSaveWorkerId] = useState<string>("")
  const [saveDocumentTypeId, setSaveDocumentTypeId] = useState<string>("")
  const [saveFileName, setSaveFileName] = useState<string>("")
  const [saveIssueDate, setSaveIssueDate] = useState<string>(todayIso())
  const [saveExpiryDate, setSaveExpiryDate] = useState<string>("")
  const [isSavePending, startSaveTransition] = useTransition()

  const [pageSize, setPageSize] = useState<PageSize>("A4")
  const [pageMarginMm, setPageMarginMm] = useState<number>(20)
  const [numberSections, setNumberSections] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [isBlockAiPending, startBlockAiTransition] = useTransition()
  const [aiBlockDraft, setAiBlockDraft] = useState<{ id: string; field: "text" | "body"; original: string; proposed: string } | null>(null)
  const [elements, setElements] = useState<DesignerElement[]>([])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBoardCollapsed, setIsBoardCollapsed] = useState(false)
  const [addFilter, setAddFilter] = useState("")

  // Persistencia del informe como registro de `reports` (crear/actualizar).
  const [savedReportId, setSavedReportId] = useState<number | null>(reportId ?? null)
  const [isReportSavePending, startReportSaveTransition] = useTransition()
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)

  const [isSignatureOpen, setIsSignatureOpen] = useState(false)
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null)

  // Historial para deshacer/rehacer (snapshots de elementos + título/subtítulo).
  type HistSnap = { elements: DesignerElement[]; coverTitle: string; coverSubtitle: string }
  const histRef = useRef<{ stack: HistSnap[]; idx: number; skip: boolean }>({ stack: [], idx: -1, skip: false })
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Clave de autoguardado del borrador en localStorage (por proyecto + informe).
  const draftKey = `ssp-report-draft-${projectId ?? "g"}-${reportId ?? "new"}`

  // Carga un informe guardado por id (al abrirlo desde la lista), o aplica una
  // plantilla estándar cuando se crea un informe nuevo.
  useEffect(() => {
    // Instrucción escrita en el hero de Informes → precarga el prompt de IA.
    const promptParam =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("prompt") : null
    if (promptParam) setAiPrompt(promptParam)
    if (reportId) {
      ;(async () => {
        try {
          const r = await getReportById(reportId)
          if (!r) return
          setCoverTitle(String(r.title || "Informe"))
          // Tolera contenido antiguo doble-serializado (jsonb guardado como string).
          let rawContent: unknown = r.content
          if (typeof rawContent === "string") {
            try {
              rawContent = JSON.parse(rawContent)
            } catch {
              rawContent = null
            }
          }
          const content = rawContent as { markdown?: string; designer?: DesignerSnapshot } | null
          const designer = content?.designer
          if (designer && Array.isArray(designer.elements) && designer.elements.length) {
            // El informe se guardó desde el editor visual: restaurar tal cual.
            setElements(designer.elements)
            if (designer.coverTitle) setCoverTitle(designer.coverTitle)
            setCoverSubtitle(designer.coverSubtitle || "")
            if (designer.pageSize === "A4" || designer.pageSize === "Letter") setPageSize(designer.pageSize)
            if (typeof designer.pageMarginMm === "number") setPageMarginMm(designer.pageMarginMm)
            setNumberSections(Boolean(designer.numberSections))
            return
          }
          const md = content?.markdown
          const now = Date.now()
          if (typeof md === "string" && md.trim()) {
            setElements([
              { id: `h-${now}`, type: "heading", text: String(r.title || "Informe"), level: 1, align: "center" } as DesignerElement,
              { id: `b-${now}`, type: "plain_text", text: md, align: "left" } as DesignerElement,
            ])
          } else {
            setElements((cur) => (cur.length ? cur : standardTemplate(String(r.title || "Informe"))))
          }
        } catch {}
      })()
    } else {
      const tpl =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("template") : null
      if (tpl) {
        applyTemplateByKey(tpl)
      } else {
        let draft:
          | { elements: DesignerElement[]; coverTitle?: string; coverSubtitle?: string; pageSize?: PageSize; pageMarginMm?: number }
          | null = null
        try {
          const raw = typeof window !== "undefined" ? localStorage.getItem(draftKey) : null
          if (raw) {
            const d = JSON.parse(raw)
            if (Array.isArray(d.elements) && d.elements.length) draft = d
          }
        } catch {}
        if (draft) {
          setElements(draft.elements)
          setCoverTitle(draft.coverTitle || "Informe de Seguridad")
          setCoverSubtitle(draft.coverSubtitle || "")
          if (draft.pageSize) setPageSize(draft.pageSize)
          if (typeof draft.pageMarginMm === "number") setPageMarginMm(draft.pageMarginMm)
          toast("Borrador restaurado", {
            description: "Recuperamos tu último borrador sin guardar.",
            action: {
              label: "Descartar",
              onClick: () => {
                try {
                  localStorage.removeItem(draftKey)
                } catch {}
                setElements(standardTemplate("Informe de Seguridad"))
                setCoverTitle("Informe de Seguridad")
              },
            },
          })
        } else {
          setElements((cur) => (cur.length ? cur : standardTemplate("Informe de Seguridad")))
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let mounted = true
      ; (async () => {
        try {
          const [logoResp, responsibleResp, signatureResp] = await Promise.all([
            fetch("/api/settings/company-logo"),
            fetch("/api/settings/responsible-name"),
            fetch("/api/settings/responsible-signature"),
          ])
          const logoJson = await logoResp.json()
          const responsibleJson = await responsibleResp.json()
          const signatureJson = await signatureResp.json()
          if (!mounted) return
          setBrandLogo(String(logoJson.company_logo || ""))
          setResponsibleName(String(responsibleJson.responsible_name || ""))
          const sig = signatureJson.responsible_signature
          setResponsibleSignatureDataUrl(sig ? String(sig) : null)
        } catch { }
      })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!isSignatureOpen) return
    const c = signatureCanvasRef.current
    if (!c) return

    const setup = () => {
      const rect = c.getBoundingClientRect()
      c.width = Math.max(1, Math.floor(rect.width))
      c.height = Math.max(1, Math.floor(rect.height))
      const ctx = c.getContext("2d")
      if (!ctx) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.strokeStyle = "#111827"
      ctx.lineWidth = 2.5
      ctx.clearRect(0, 0, rect.width, rect.height)
    }
    requestAnimationFrame(setup)
  }, [isSignatureOpen])

  useEffect(() => {
    let active = true
      ; (async () => {
        try {
          const workers = await getWorkers(projectId)
          if (active && Array.isArray(workers)) {
            setSaveWorkers(
              workers.map((w) => ({
                id: Number((w as { id: number }).id),
                first_name: String((w as { first_name: string }).first_name),
                last_name: String((w as { last_name: string }).last_name),
                rut: (w as { rut: string | null }).rut === null || (w as { rut: string | null }).rut === undefined ? null : String((w as { rut: string | null }).rut),
              })),
            )
          }
        } catch { }
        try {
          const types = await getDocumentTypes()
          if (active && Array.isArray(types)) {
            setSaveDocumentTypes(
              types.map((t) => ({
                id: Number((t as { id: number }).id),
                name: String((t as { name: string }).name),
              })),
            )
          }
        } catch { }
      })()
    return () => {
      active = false
    }
  }, [projectId])

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string
        elementId?: string
        edit?: string
        r?: string
        c?: string
        value?: string
        targetId?: string
        position?: string
      }
      if (!data || !data.elementId) return
      if (data.type === "REPORT_DESIGNER_SELECT") {
        setSelectedElementId(data.elementId)
        return
      }
      if (
        data.type === "REPORT_DESIGNER_MOVE" &&
        data.targetId &&
        (data.position === "before" || data.position === "after")
      ) {
        moveElementTo(data.elementId, data.targetId, data.position)
        setSelectedElementId(data.elementId)
        return
      }
      if (data.type === "REPORT_DESIGNER_EDIT") {
        const { elementId, edit, value } = data
        const v = value ?? ""
        const r = Number(data.r)
        const c = Number(data.c)
        updateElement(elementId, (prev) => {
          if (edit === "heading" && prev.type === "heading") return { ...prev, text: v }
          if (edit === "text" && prev.type === "plain_text") return { ...prev, text: v }
          if (edit === "stitle" && prev.type === "simple_section") return { ...prev, title: v }
          if (edit === "sbody" && prev.type === "simple_section") return { ...prev, body: v }
          if (edit === "ctitle" && prev.type === "cover") return { ...prev, title: v }
          if (edit === "csub" && prev.type === "cover") return { ...prev, subtitle: v }
          if (edit === "qname" && prev.type === "quote") return { ...prev, item: { ...prev.item, name: v } }
          if (edit === "list" && prev.type === "list") {
            const items = v.split("\n").map((x) => x.trim()).filter((x) => x.length > 0)
            return { ...prev, items }
          }
          if (edit === "kpi" && prev.type === "kpis" && Number.isFinite(r)) {
            const key = data.c === "value" ? "value" : "label"
            const items = prev.items.map((it, i) => (i === r ? { ...it, [key]: v } : it))
            return { ...prev, items }
          }
          if (edit === "cell" && prev.type === "table" && Number.isFinite(r) && Number.isFinite(c)) {
            const rows = prev.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row))
            return { ...prev, rows }
          }
          return prev
        })
        setSelectedElementId(elementId)
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("message", handler)
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("message", handler)
      }
    }
  }, [])

  // Marca visualmente el bloque seleccionado dentro de la previsualización (sin recargar el iframe).
  const applyPreviewSelection = (
    doc: Document | null | undefined,
    selId: string | null,
    scroll = false,
    behavior: ScrollBehavior = "smooth",
  ) => {
    if (!doc) return
    doc.querySelectorAll<HTMLElement>("[data-ssp-el-id]").forEach((node) => {
      if (node.getAttribute("data-ssp-el-id") === selId) {
        node.style.outline = "2px solid #f3a40a"
        node.style.outlineOffset = "3px"
        node.style.borderRadius = "8px"
        node.style.background = "rgba(243,164,10,0.06)"
        if (scroll) node.scrollIntoView({ block: "nearest", behavior })
      } else {
        node.style.outline = ""
        node.style.outlineOffset = ""
        node.style.background = ""
      }
    })
  }

  useEffect(() => {
    applyPreviewSelection(previewIframeRef.current?.contentDocument, selectedElementId, true)
  }, [selectedElementId])

  // Registra un snapshot en el historial (con debounce) cuando cambia el contenido.
  useEffect(() => {
    const h = histRef.current
    if (h.skip) {
      h.skip = false
      return
    }
    const t = setTimeout(() => {
      h.stack = h.stack.slice(0, h.idx + 1)
      h.stack.push({ elements, coverTitle, coverSubtitle })
      if (h.stack.length > 100) h.stack.shift()
      h.idx = h.stack.length - 1
      setCanUndo(h.idx > 0)
      setCanRedo(false)
    }, 350)
    return () => clearTimeout(t)
  }, [elements, coverTitle, coverSubtitle])

  const applySnap = (s: HistSnap) => {
    histRef.current.skip = true
    setElements(s.elements)
    setCoverTitle(s.coverTitle)
    setCoverSubtitle(s.coverSubtitle)
  }
  const undo = () => {
    const h = histRef.current
    if (h.idx <= 0) return
    h.idx -= 1
    applySnap(h.stack[h.idx])
    setCanUndo(h.idx > 0)
    setCanRedo(h.idx < h.stack.length - 1)
  }
  const redo = () => {
    const h = histRef.current
    if (h.idx >= h.stack.length - 1) return
    h.idx += 1
    applySnap(h.stack[h.idx])
    setCanUndo(h.idx > 0)
    setCanRedo(h.idx < h.stack.length - 1)
  }

  // Atajos de teclado. Se re-registra en cada render para que las closures
  // (selección, guardado) estén siempre al día; el costo es despreciable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      const tag = (active?.tagName || "").toLowerCase()
      if (tag === "input" || tag === "textarea" || tag === "select" || active?.isContentEditable) return
      const dialogOpen = Boolean(document.querySelector('[role="dialog"]'))
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (!mod) {
        if (e.key === "Delete" && selectedElementId && !dialogOpen) {
          e.preventDefault()
          deleteElement(selectedElementId)
        }
        return
      }
      if (k === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault()
        redo()
      } else if (k === "s") {
        e.preventDefault()
        if (!isReportSavePending) saveReport()
      } else if (k === "d" && selectedElementId && !dialogOpen) {
        e.preventDefault()
        duplicateElement(selectedElementId)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Autoguardado del borrador en localStorage (con debounce) + hora para el indicador.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ elements, coverTitle, coverSubtitle, pageSize, pageMarginMm, savedAt: Date.now() }),
        )
        setDraftSavedAt(new Date())
      } catch {}
    }, 600)
    return () => clearTimeout(t)
  }, [elements, coverTitle, coverSubtitle, pageSize, pageMarginMm, draftKey])

  const editorState = useMemo((): EditorState => {
    const recs = recsText
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.length > 0)

    return {
      pdfFont: "sans-serif",
      pdfFontSize: 14,
      pdfColor: "#111827",
      editorSections: ["cover", "summary", "matrix", "recs"],
      coverTitle,
      coverSubtitle,
      summaryText,
      matrixRows,
      recs,
      brandLogo: brandLogo || null,
      responsibleName,
      responsibleSignatureDataUrl,
      designerEnabled: mode === "designer",
      pageSize,
      pageMarginMm,
      elements,
      numberSections,
    }
  }, [
    brandLogo,
    coverSubtitle,
    coverTitle,
    elements,
    matrixRows,
    mode,
    pageMarginMm,
    pageSize,
    numberSections,
    recsText,
    responsibleName,
    responsibleSignatureDataUrl,
    summaryText,
  ])

  const previewHtml = useMemo(() => {
    return mode === "designer" ? buildDesignerHtmlFromState(editorState) : buildEditorHtmlFromState(editorState)
  }, [editorState, mode])

  const validateEditor = () => {
    const alerts = validateEditorState(editorState)
    setEditorAlerts(alerts)
    return alerts.length === 0
  }

  const handleFillWithAI = () => {
    startAiTransition(async () => {
      try {
        const snapshotId = String(Date.now())
        const createdAt = new Date().toISOString()
        setAiHistory((prev) => [
          { id: snapshotId, createdAt, coverTitle, coverSubtitle, elements },
          ...prev,
        ])
        const result = await fillPdfDesignerWithAI({
          period: aiPeriod,
          projectId,
          request: aiPrompt,
          state: editorState,
          reportType: aiReportType,
        })
        setCoverTitle(result.coverTitle)
        setCoverSubtitle(result.coverSubtitle)
        setElements(result.elements)
      } catch (error) {
        console.error(error)
        setEditorAlerts((prev) => [...prev, "Error al rellenar el informe con IA. Revisa la configuración de IA."])
      }
    })
  }

  // Guarda el informe como registro de `reports` (crea la primera vez, luego actualiza).
  // Distinto de "Archivar en Documentos": esto permite reabrirlo y seguir editándolo.
  const saveReport = () => {
    startReportSaveTransition(async () => {
      try {
        const id = await saveDesignerReport({
          id: savedReportId,
          title: coverTitle,
          projectId,
          designer: { elements, coverTitle, coverSubtitle, pageSize, pageMarginMm, numberSections },
        })
        if (!id) {
          toast.error("No se pudo guardar el informe")
          return
        }
        if (!savedReportId) {
          setSavedReportId(id)
          try {
            const url = new URL(window.location.href)
            url.searchParams.set("id", String(id))
            window.history.replaceState(null, "", url.toString())
          } catch {}
        }
        try {
          localStorage.removeItem(draftKey)
        } catch {}
        toast.success("Informe guardado", {
          description: "Puedes reabrirlo desde Informes → Documentos generados.",
        })
      } catch {
        toast.error("No se pudo guardar el informe")
      }
    })
  }

  const handleOpenSaveDialog = () => {
    if (!saveFileName) {
      const baseName = coverTitle && coverTitle.trim().length > 0 ? coverTitle.trim() : "informe"
      setSaveFileName(`${baseName}.pdf`)
    }
    setIsSaveDialogOpen(true)
  }

  const handleSaveToDocuments = () => {
    validateEditor()
    if (!saveWorkerId || !saveDocumentTypeId) {
      toast.error("Selecciona trabajador y tipo de documento")
      return
    }

    startSaveTransition(async () => {
      try {
        let finalFileName = saveFileName.trim() || coverTitle.trim() || "informe"
        if (!/\.[a-zA-Z0-9]{2,10}$/.test(finalFileName)) {
          finalFileName = `${finalFileName}.pdf`
        } else {
          finalFileName = finalFileName.replace(/\.[^.]+$/, ".pdf")
        }

        const fileUrl = await new Promise<string>((resolve, reject) => {
          const iframe = document.createElement("iframe")
          iframe.style.position = "fixed"
          iframe.style.left = "-9999px"
          iframe.style.top = "0"
          iframe.style.width = "0"
          iframe.style.height = "0"
          iframe.style.border = "0"
          document.body.appendChild(iframe)

          const cleanup = () => {
            window.removeEventListener("message", onMessage)
            if (iframe.parentNode) {
              iframe.parentNode.removeChild(iframe)
            }
          }

          const onMessage = (ev: MessageEvent) => {
            const data = ev.data as { type?: string; uri?: string; error?: string }
            if (!data || (data.type !== "REPORT_PDF_READY" && data.type !== "REPORT_PDF_ERROR")) return
            cleanup()
            if (data.type === "REPORT_PDF_READY" && data.uri) {
              resolve(data.uri)
            } else {
              reject(new Error(data.error || "Error al generar PDF del informe"))
            }
          }

          window.addEventListener("message", onMessage)

          const doc = iframe.contentDocument
          if (!doc) {
            cleanup()
            reject(new Error("No se pudo inicializar el visor de PDF"))
            return
          }

          doc.open()
          doc.write(previewHtml)
          doc.close()

          const script = doc.createElement("script")
          script.src = "https://unpkg.com/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js"
          script.onload = () => {
            const inner = doc.createElement("script")
            inner.text = `
              (function () {
                var target = document.body;
                var opt = {
                  margin: [10, 10, 10, 10],
                  filename: 'informe.pdf',
                  image: { type: 'jpeg', quality: 0.95 },
                  html2canvas: { scale: 2 },
                  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };
                window.html2pdf().from(target).set(opt).outputPdf('datauristring').then(function (uri) {
                  parent.postMessage({ type: 'REPORT_PDF_READY', uri: uri }, '*');
                }).catch(function (e) {
                  parent.postMessage({ type: 'REPORT_PDF_ERROR', error: e && e.message ? e.message : String(e) }, '*');
                });
              })();
            `
            doc.body.appendChild(inner)
          }
          script.onerror = () => {
            cleanup()
            reject(new Error("No se pudo cargar el generador de PDF"))
          }
          const head = doc.head || doc.getElementsByTagName("head")[0] || doc.body
          head.appendChild(script)
        })

        await createDocument({
          worker_id: Number.parseInt(saveWorkerId, 10),
          document_type_id: Number.parseInt(saveDocumentTypeId, 10),
          file_name: finalFileName,
          file_url: fileUrl,
          issue_date: saveIssueDate || undefined,
          expiry_date: saveExpiryDate || undefined,
          extracted_data: {
            source: "report",
            report_title: coverTitle,
            report_subtitle: coverSubtitle,
            project_id: projectId ?? null,
          },
        })

        toast.success("Informe guardado en Documentos")
        setIsSaveDialogOpen(false)
        if (projectId) {
          router.push(`/proyectos/${projectId}/documentos`)
        } else {
          router.push("/documentos")
        }
      } catch (error) {
        console.error(error)
        toast.error("Error al guardar el informe en Documentos")
      }
    })
  }

  const exportPdf = () => {
    if (!validateEditor()) return
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(previewHtml.replace("</body></html>", `<script>setTimeout(function(){window.print()},100)</script></body></html>`))
    w.document.close()
  }

  const exportWord = () => {
    if (!validateEditor()) return
    const blob = new Blob([previewHtml], { type: "application/msword" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${coverTitle || "informe"}.doc`
    a.click()
    URL.revokeObjectURL(url)
  }

  const updateRow = (index: number, patch: Partial<MatrixRow>) => {
    setMatrixRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const selectedElement = useMemo(() => {
    if (!selectedElementId) return null
    return elements.find((e) => e.id === selectedElementId) || null
  }, [elements, selectedElementId])

  // Inserta el bloque nuevo justo después del seleccionado (o al final si no hay selección).
  const addElement = (el: DesignerElement) => {
    setElements((arr) => {
      const idx = selectedElementId ? arr.findIndex((e) => e.id === selectedElementId) : -1
      if (idx < 0) return [...arr, el]
      const next = [...arr]
      next.splice(idx + 1, 0, el)
      return next
    })
    setSelectedElementId(el.id)
  }

  const updateElement = (id: string, updater: (prev: DesignerElement) => DesignerElement) => {
    setElements((arr) => arr.map((e) => (e.id === id ? updater(e) : e)))
  }

  // Edita la matriz de una tabla (celdas, filas, columnas) desde Propiedades.
  const updateTable = (id: string, fn: (rows: string[][]) => string[][]) =>
    updateElement(id, (prev) =>
      prev.type === "table" ? { ...prev, rows: fn(prev.rows.map((r) => [...r])) } : prev,
    )

  // Edita la matriz de hallazgos (filas tipadas) desde Propiedades.
  const updateMatrix = (id: string, fn: (rows: MatrixRow[]) => MatrixRow[]) =>
    updateElement(id, (prev) =>
      prev.type === "matrix" ? { ...prev, rows: fn(prev.rows.map((r) => ({ ...r }))) } : prev,
    )

  const deleteElement = (id: string) => {
    setElements((arr) => arr.filter((e) => e.id !== id))
    setSelectedElementId((sel) => (sel === id ? null : sel))
  }

  // Duplica un bloque (copia profunda) justo debajo del original.
  const duplicateElement = (id: string) => {
    let newId: string | null = null
    setElements((arr) => {
      const idx = arr.findIndex((e) => e.id === id)
      if (idx < 0) return arr
      const clone = JSON.parse(JSON.stringify(arr[idx])) as DesignerElement
      newId = `${clone.type}-${Date.now()}`
      clone.id = newId
      const next = [...arr]
      next.splice(idx + 1, 0, clone)
      return next
    })
    if (newId) setSelectedElementId(newId)
  }

  // "Mejorar con IA" un bloque de texto: propone una reescritura y deja aceptar/descartar (vista de diferencia).
  const blockAiText = (el: DesignerElement): { field: "text" | "body"; value: string } | null => {
    if (el.type === "heading") return { field: "text", value: el.text }
    if (el.type === "plain_text") return { field: "text", value: el.text }
    if (el.type === "simple_section") return { field: "body", value: el.body }
    return null
  }
  const improveSelectedBlock = () => {
    const el = elements.find((e) => e.id === selectedElementId)
    if (!el) return
    const t = blockAiText(el)
    if (!t || !t.value.trim()) {
      toast.error("Este bloque no tiene texto para mejorar")
      return
    }
    startBlockAiTransition(async () => {
      try {
        const proposed = await rewriteTextWithAI(t.value)
        if (proposed && proposed.trim() && proposed.trim() !== t.value.trim()) {
          setAiBlockDraft({ id: el.id, field: t.field, original: t.value, proposed: proposed.trim() })
        } else {
          toast("La IA no sugirió cambios")
        }
      } catch {
        toast.error("Error al mejorar con IA (revisa la API Key en Configuración)")
      }
    })
  }
  const acceptAiBlock = () => {
    if (!aiBlockDraft) return
    const { id, field, proposed } = aiBlockDraft
    updateElement(id, (prev) => {
      if (field === "text" && (prev.type === "heading" || prev.type === "plain_text")) return { ...prev, text: proposed }
      if (field === "body" && prev.type === "simple_section") return { ...prev, body: proposed }
      return prev
    })
    setAiBlockDraft(null)
  }

  // Acciones en lote para multi-selección (Ctrl/⌘ + clic en la pizarra).
  const deleteMany = (ids: string[]) => {
    setElements((arr) => arr.filter((e) => !ids.includes(e.id)))
    setSelectedIds([])
    setSelectedElementId((sel) => (sel && ids.includes(sel) ? null : sel))
  }
  const duplicateMany = (ids: string[]) => {
    setElements((arr) => {
      const out: DesignerElement[] = []
      arr.forEach((e, i) => {
        out.push(e)
        if (ids.includes(e.id)) {
          const clone = JSON.parse(JSON.stringify(e)) as DesignerElement
          clone.id = `${clone.type}-${Date.now()}-${i}`
          out.push(clone)
        }
      })
      return out
    })
    setSelectedIds([])
  }

  const moveElement = (dragId: string, overId: string) => {
    if (dragId === overId) return
    setElements((arr) => {
      const from = arr.findIndex((e) => e.id === dragId)
      const to = arr.findIndex((e) => e.id === overId)
      if (from < 0 || to < 0) return arr
      const copy = [...arr]
      const [moved] = copy.splice(from, 1)
      copy.splice(to, 0, moved)
      return copy
    })
  }

  // Mueve un bloque antes/después de otro (drag & drop dentro de la preview).
  const moveElementTo = (id: string, targetId: string, position: "before" | "after") => {
    if (id === targetId) return
    setElements((arr) => {
      const from = arr.findIndex((e) => e.id === id)
      if (from < 0 || !arr.some((e) => e.id === targetId)) return arr
      const copy = [...arr]
      const [moved] = copy.splice(from, 1)
      const to = copy.findIndex((e) => e.id === targetId) + (position === "after" ? 1 : 0)
      copy.splice(to, 0, moved)
      return copy
    })
  }

  // Mueve un bloque una posición arriba/abajo (flechas de la pizarra).
  const moveElementBy = (id: string, dir: -1 | 1) => {
    setElements((arr) => {
      const from = arr.findIndex((e) => e.id === id)
      const to = from + dir
      if (from < 0 || to < 0 || to >= arr.length) return arr
      const copy = [...arr]
      const [moved] = copy.splice(from, 1)
      copy.splice(to, 0, moved)
      return copy
    })
  }

  const applyBasicTemplateToDesigner = () => {
    const recs = recsText
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
    const now = Date.now()
    const tpl: DesignerElement[] = [
      { id: `h1-${now}`, type: "heading", level: 1, text: coverTitle || "Documento", align: "center" },
      { id: `h2-${now + 1}`, type: "heading", level: 2, text: coverSubtitle || "", align: "center" },
      { id: `div-${now + 2}`, type: "divider" },
      { id: `sec-${now + 3}`, type: "simple_section", title: "Resumen Ejecutivo", subtitle: null, body: summaryText || "" },
      { id: `mx-${now + 4}`, type: "matrix", rows: matrixRows },
      { id: `rec-${now + 5}`, type: "list", ordered: true, items: recs },
    ]
    setElements(tpl.filter((e) => (e.type === "heading" ? e.text.trim().length > 0 : true)))
    setSelectedElementId(tpl[0]?.id || null)
  }

  const applyIperPtsAstTemplate = () => {
    const now = Date.now()
    if (!coverTitle || coverTitle.trim().length === 0) {
      setCoverTitle("Matriz IPER / PTS / AST")
    }
    if (!coverSubtitle || coverSubtitle.trim().length === 0) {
      setCoverSubtitle("Identificación de peligros, evaluación y control de riesgos")
    }
    const headers = [
      "Actividad / tarea",
      "Peligro",
      "Riesgo",
      "Probabilidad",
      "Consecuencia",
      "Nivel de riesgo",
      "Medidas de control",
      "Responsable",
      "Plazo",
      "Estado",
    ]
    const rows: string[][] = [
      headers,
      Array(headers.length).fill(""),
      Array(headers.length).fill(""),
      Array(headers.length).fill(""),
    ]
    const tpl: DesignerElement[] = [
      {
        id: `h1-iper-${now}`,
        type: "heading",
        level: 1,
        text: "Matriz IPER / PTS / AST",
        align: "center",
      },
      {
        id: `sec-iper-info-${now + 1}`,
        type: "simple_section",
        title: "Datos generales",
        subtitle: null,
        body: "",
        bullets: [
          "Proyecto / Faena:",
          "Área / Frente de trabajo:",
          "Fecha:",
          "Supervisor / Prevencionista:",
        ],
        chips: [],
        align: "left",
      },
      {
        id: `sec-iper-instr-${now + 2}`,
        type: "simple_section",
        title: "Instrucciones",
        subtitle: null,
        body:
          "Complete la matriz identificando peligros, riesgos y controles asociados a cada actividad o tarea. " +
          "Use las columnas de probabilidad, consecuencia y nivel de riesgo según la metodología interna.",
        bullets: [],
        chips: [],
        align: "left",
      },
      {
        id: `tbl-iper-${now + 3}`,
        type: "table",
        rows,
      },
    ]
    setElements(tpl)
    setSelectedElementId(tpl[0]?.id || null)
  }

  const applyAtsInspeccionAccidenteTemplate = () => {
    const now = Date.now()
    if (!coverTitle || coverTitle.trim().length === 0) {
      setCoverTitle("ATS / Inspección de Accidente")
    }
    if (!coverSubtitle || coverSubtitle.trim().length === 0) {
      setCoverSubtitle("Análisis de trabajo seguro e investigación básica de accidente")
    }
    const tpl: DesignerElement[] = [
      {
        id: `h1-ats-${now}`,
        type: "heading",
        level: 1,
        text: "ATS / Inspección de Accidente",
        align: "center",
      },
      {
        id: `sec-ats-datos-${now + 1}`,
        type: "simple_section",
        title: "Datos del evento",
        subtitle: null,
        body: "",
        bullets: [
          "Proyecto / Faena:",
          "Lugar exacto:",
          "Fecha y hora:",
          "Persona afectada / involucrados:",
          "Supervisor responsable:",
        ],
        chips: [],
        align: "left",
      },
      {
        id: `sec-ats-descripcion-${now + 2}`,
        type: "simple_section",
        title: "Descripción del accidente / condición observada",
        subtitle: null,
        body: "",
        bullets: [],
        chips: [],
        align: "left",
      },
      {
        id: `sec-ats-causas-${now + 3}`,
        type: "simple_section",
        title: "Causas inmediatas y básicas",
        subtitle: null,
        body: "",
        bullets: [
          "Actos subestándar:",
          "Condiciones subestándar:",
          "Causas básicas (gestión / organización):",
        ],
        chips: [],
        align: "left",
      },
      {
        id: `sec-ats-medidas-${now + 4}`,
        type: "simple_section",
        title: "Medidas correctivas y preventivas",
        subtitle: null,
        body: "",
        bullets: [
          "Acciones inmediatas:",
          "Acciones a mediano plazo:",
          "Responsables y plazos:",
        ],
        chips: [],
        align: "left",
      },
    ]
    setElements(tpl)
    setSelectedElementId(tpl[0]?.id || null)
  }

  // Aplica una plantilla de prevención al abrir el editor desde la grilla de Informes (?template=).
  const applyTemplateByKey = (key: string) => {
    const titles: Record<string, string> = {
      iper: "Matriz IPER",
      pts: "PTS — Procedimiento de Trabajo Seguro",
      ast: "AST / ATS — Análisis Seguro de Trabajo",
      accident: "Investigación de Accidentes",
      inspection: "Inspección Planeada",
      altura: "Permiso de Trabajo en Altura",
    }
    const title = titles[key] || "Informe de Seguridad"
    setCoverTitle(title)
    if (["iper", "pts", "ast", "inspection", "accident"].includes(key)) setAiReportType(key)
    if (key === "iper" || key === "pts" || key === "ast") applyIperPtsAstTemplate()
    else if (key === "accident" || key === "inspection") applyAtsInspeccionAccidenteTemplate()
    else setElements(standardTemplate(title))
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-16 z-20 -mx-4 -mt-4 flex flex-wrap items-center gap-3 border-b border-white/10 bg-primary px-4 py-3 text-sidebar-foreground md:-mx-6 md:-mt-6 md:px-6 lg:-mx-8 lg:-mt-8 lg:px-8">
        <button
          type="button"
          onClick={() => router.push(projectId ? `/proyectos/${projectId}/informes` : "/informes")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-white/10 bg-white/5 text-sidebar-foreground transition-colors hover:bg-white/10"
          aria-label="Volver a informes"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-bold leading-tight tracking-[-0.01em]">Editor de informe</h1>
          <p className="text-[13px] text-sidebar-foreground/55">Diseña el informe y expórtalo en PDF</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {draftSavedAt && (
            <span
              className="mr-1 hidden items-center gap-1.5 text-[11px] text-sidebar-foreground/45 xl:flex"
              title="El borrador se guarda automáticamente en este navegador"
            >
              <Check className="h-3.5 w-3.5" />
              Borrador{" "}
              {draftSavedAt.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <div className="mr-1 flex items-center gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title="Deshacer (Ctrl+Z)"
              aria-label="Deshacer"
              className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-white/10 bg-white/5 text-sidebar-foreground transition-colors hover:bg-white/10 disabled:opacity-30"
            >
              <Undo2 className="h-[17px] w-[17px]" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Rehacer (Ctrl+Y)"
              aria-label="Rehacer"
              className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-white/10 bg-white/5 text-sidebar-foreground transition-colors hover:bg-white/10 disabled:opacity-30"
            >
              <Redo2 className="h-[17px] w-[17px]" />
            </button>
          </div>
          <Button onClick={exportPdf} className="gap-2 bg-brand text-brand-foreground hover:bg-brand/90">
            <Download className="h-4 w-4" />
            Exportar PDF
          </Button>
          <Button
            onClick={exportWord}
            variant="outline"
            className="gap-2 border-white/15 bg-white/5 text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground"
          >
            <FileText className="h-4 w-4" />
            Exportar Word
          </Button>
          <Button
            onClick={handleOpenSaveDialog}
            variant="outline"
            title="Genera el PDF y lo archiva en Documentos asociado a un trabajador"
            className="gap-2 border-white/15 bg-white/5 text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground"
          >
            <Archive className="h-4 w-4" />
            Archivar en Documentos
          </Button>
          <Button
            onClick={saveReport}
            disabled={isReportSavePending}
            title="Guardar el informe para seguir editándolo después (Ctrl+S)"
            className="gap-2 bg-white text-primary hover:bg-white/90"
          >
            {isReportSavePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isReportSavePending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>

      {editorAlerts.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{editorAlerts.join(" · ")}</AlertDescription>
        </Alert>
      )}

        <Dialog open={isSignatureOpen} onOpenChange={setIsSignatureOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Firma del responsable</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border bg-background p-2">
                <canvas
                  ref={signatureCanvasRef}
                  className="h-48 w-full touch-none rounded bg-white"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    const c = signatureCanvasRef.current
                    if (!c) return
                    const ctx = c.getContext("2d")
                    if (!ctx) return
                    const rect0 = c.getBoundingClientRect()
                    let drawing = true
                    let lastX = e.clientX - rect0.left
                    let lastY = e.clientY - rect0.top

                    ctx.beginPath()
                    ctx.moveTo(lastX, lastY)

                    c.setPointerCapture(e.pointerId)

                    const move = (ev: PointerEvent) => {
                      if (!drawing) return
                      ev.preventDefault()
                      const rect = c.getBoundingClientRect()
                      const x = ev.clientX - rect.left
                      const y = ev.clientY - rect.top
                      ctx.lineTo(x, y)
                      ctx.stroke()
                      lastX = x
                      lastY = y
                    }
                    const up = () => {
                      drawing = false
                      window.removeEventListener("pointermove", move)
                      window.removeEventListener("pointerup", up)
                    }
                    window.addEventListener("pointermove", move, { passive: false })
                    window.addEventListener("pointerup", up)
                  }}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const c = signatureCanvasRef.current
                    if (!c) return
                    const ctx = c.getContext("2d")
                    if (!ctx) return
                    const rect = c.getBoundingClientRect()
                    ctx.clearRect(0, 0, rect.width, rect.height)
                  }}
                >
                  Limpiar
                </Button>
                <Button
                  onClick={() => {
                    const c = signatureCanvasRef.current
                    if (!c) return
                    const dataUrl = c.toDataURL("image/png")
                    setResponsibleSignatureDataUrl(dataUrl)
                    void fetch("/api/settings/responsible-signature", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ responsible_signature: dataUrl }),
                    })
                    setIsSignatureOpen(false)
                  }}
                >
                  Guardar firma
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <div className="space-y-6">
            <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1.4fr)_310px]">
              <div className="space-y-5 rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-32 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
                  <div className="space-y-2">
                    <div className="grid gap-2">
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Título</div>
                        <Input value={coverTitle} onChange={(e) => setCoverTitle(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Subtítulo</div>
                        <Input value={coverSubtitle} onChange={(e) => setCoverSubtitle(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Tamaño</div>
                        <Select value={pageSize} onValueChange={(v) => setPageSize(v as PageSize)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="A4">A4</SelectItem>
                            <SelectItem value="Letter">Letter</SelectItem>
                            <SelectItem value="Legal">Legal</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">Margen (mm)</div>
                        <Input
                          type="number"
                          value={String(pageMarginMm)}
                          onChange={(e) => {
                            const n = Number(e.target.value)
                            if (Number.isFinite(n)) setPageMarginMm(Math.max(0, Math.min(60, n)))
                          }}
                        />
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                          Plantillas rápidas
                        </div>
                        <div className="grid gap-2">
                          <Button variant="outline" size="sm" className="w-full text-xs break-words" onClick={applyIperPtsAstTemplate}>
                            Matriz IPER / PTS / AST
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-xs break-words"
                            onClick={applyAtsInspeccionAccidenteTemplate}
                          >
                            ATS / Inspección de Accidente
                          </Button>
                        </div>
                      </div>
                      <Button variant="outline" onClick={applyBasicTemplateToDesigner}>
                        Cargar plantilla básica
                      </Button>
                      <label className="flex cursor-pointer items-center justify-between gap-2 pt-1 text-[13px] font-medium">
                        Numerar secciones
                        <button
                          type="button"
                          role="switch"
                          aria-checked={numberSections}
                          onClick={() => setNumberSections((v) => !v)}
                          className="relative h-6 w-[42px] shrink-0 rounded-full transition-colors"
                          style={{ background: numberSections ? "var(--primary)" : "#d9d4c9" }}
                        >
                          <span
                            className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all"
                            style={{ left: numberSections ? "21px" : "3px" }}
                          />
                        </button>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Agregar
                    </div>
                    <input
                      value={addFilter}
                      onChange={(e) => setAddFilter(e.target.value)}
                      placeholder="Filtrar bloques…"
                      className="h-9 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/15"
                    />
                    <div className="grid gap-1.5">
                      {(
                        [
                          { label: "Encabezado H1", make: (): DesignerElement => ({ id: `h1-${Date.now()}`, type: "heading", level: 1, text: "Título", align: "left" }) },
                          { label: "Encabezado H2", make: (): DesignerElement => ({ id: `h2-${Date.now()}`, type: "heading", level: 2, text: "Subtítulo", align: "left" }) },
                          { label: "Texto", make: (): DesignerElement => ({ id: `pt-${Date.now()}`, type: "plain_text", text: "Texto", align: "left" }) },
                          { label: "Sección", make: (): DesignerElement => ({ id: `sec-${Date.now()}`, type: "simple_section", title: "Sección", subtitle: null, body: "", bullets: [], chips: [], align: "left" }) },
                          { label: "Lista", make: (): DesignerElement => ({ id: `ls-${Date.now()}`, type: "list", ordered: false, items: ["Item 1", "Item 2"], align: "left" }) },
                          { label: "Tabla", make: (): DesignerElement => ({ id: `tb-${Date.now()}`, type: "table", rows: [["Columna A", "Columna B"], ["", ""]] }) },
                          { label: "Matriz de hallazgos", make: (): DesignerElement => ({ id: `mx-${Date.now()}`, type: "matrix", rows: [defaultRow()] }) },
                          { label: "Campos (clave-valor)", make: (): DesignerElement => ({ id: `cf-${Date.now()}`, type: "table", rows: [["Período", "—"], ["Cumplimiento", "—"]] }) },
                          { label: "Firma", make: (): DesignerElement => ({ id: `sg-${Date.now()}`, type: "quote", item: { name: responsibleName || "Nombre del responsable", role: "Prevencionista de Riesgos", date: todayIso(), content: "", signatureDataUrl: responsibleSignatureDataUrl } }) },
                          { label: "Separador", make: (): DesignerElement => ({ id: `hr-${Date.now()}`, type: "divider" }) },
                          { label: "Imagen", make: (): DesignerElement => ({ id: `img-${Date.now()}`, type: "image", src: "", alt: "", widthPct: 100 }) },
                          { label: "Indicadores", make: (): DesignerElement => ({ id: `kpi-${Date.now()}`, type: "kpis", items: [{ label: "Días sin accidentes", value: "0" }, { label: "Cumplimiento", value: "0%" }, { label: "Hallazgos abiertos", value: "0" }] }) },
                          { label: "Gráfico", make: (): DesignerElement => ({ id: `ch-${Date.now()}`, type: "chart", title: "Hallazgos por severidad", bars: [{ label: "Crítico", value: 3, color: "#d8443a" }, { label: "Alto", value: 5, color: "#e8960b" }, { label: "Medio", value: 8, color: "#b8841a" }, { label: "Bajo", value: 2, color: "#6f6a60" }] }) },
                          { label: "Portada", make: (): DesignerElement => ({ id: `cov-${Date.now()}`, type: "cover", title: coverTitle || "Informe de Seguridad", subtitle: coverSubtitle || "", meta: `${new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })}` }) },
                          { label: "Firmantes", make: (): DesignerElement => ({ id: `sgs-${Date.now()}`, type: "signers", signers: [{ name: responsibleName || "Nombre", role: "Prevencionista de Riesgos", status: "pendiente", signatureDataUrl: responsibleSignatureDataUrl }, { name: "Jefe de Terreno", role: "Jefe de Terreno", status: "pendiente" }] }) },
                          { label: "Tabla de contenido", make: (): DesignerElement => ({ id: `toc-${Date.now()}`, type: "toc", title: "Tabla de contenido" }) },
                          { label: "Salto de página", make: (): DesignerElement => ({ id: `pb-${Date.now()}`, type: "page_break" }) },
                        ] as { label: string; make: () => DesignerElement }[]
                      )
                        .filter((it) => normalizeLabel(it.label).includes(normalizeLabel(addFilter)))
                        .map((it) => (
                          <button
                            key={it.label}
                            type="button"
                            onClick={() => addElement(it.make())}
                            className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-brand hover:bg-secondary"
                          >
                            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                            {it.label}
                          </button>
                        ))}
                      {addFilter.trim() &&
                        !ADD_LABELS.some((l) => normalizeLabel(l).includes(normalizeLabel(addFilter))) && (
                          <div className="rounded-[10px] border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
                            Sin bloques para “{addFilter.trim()}”
                          </div>
                        )}
                    </div>
                  </div>
              </div>

              <Card className="rounded-2xl border-border shadow-none">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="font-display tracking-[-0.01em]">Previsualización</CardTitle>
                      <CardDescription>
                        Clic selecciona · doble clic edita · arrastra para reordenar · {elements.length}{" "}
                        {elements.length === 1 ? "bloque" : "bloques"}
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border p-0.5">
                      <button
                        type="button"
                        onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                        aria-label="Alejar"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoom(1)}
                        className="min-w-[42px] rounded-md px-1.5 text-center font-mono text-[11px] text-muted-foreground hover:bg-secondary"
                        title="Restablecer zoom"
                      >
                        {Math.round(zoom * 100)}%
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoom((z) => Math.min(1.6, Math.round((z + 0.1) * 10) / 10))}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
                        aria-label="Acercar"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto rounded-xl border border-border bg-[#efece4]" style={{ height: "70vh" }}>
                    <iframe
                      ref={previewIframeRef}
                      className="h-[70vh] w-full bg-[#efece4]"
                      style={{ transform: `scale(${zoom})`, transformOrigin: "top center", border: 0 }}
                      srcDoc={previewHtml}
                      title="Previsualización del informe"
                      onLoad={() =>
                        applyPreviewSelection(previewIframeRef.current?.contentDocument, selectedElementId, true, "auto")
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6 lg:sticky lg:top-32 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1">
                <Card className="rounded-2xl border-border shadow-none">
                  <CardHeader>
                    <CardTitle className="font-display tracking-[-0.01em]">Propiedades</CardTitle>
                    <CardDescription>Edita el componente seleccionado</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedElement ? (
                      <>
                        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                          Bloque: {blockLabel(selectedElement)}
                        </div>
                        {(selectedElement.type === "heading" ||
                          selectedElement.type === "plain_text" ||
                          selectedElement.type === "simple_section") ? (
                          <div className="space-y-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full gap-2"
                              onClick={improveSelectedBlock}
                              disabled={isBlockAiPending}
                            >
                              {isBlockAiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                              Mejorar con IA
                            </Button>
                            {aiBlockDraft && aiBlockDraft.id === selectedElement.id ? (
                              <div className="space-y-2 rounded-lg border border-brand bg-brand/5 p-2.5">
                                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                  Propuesta de IA
                                </div>
                                <div className="max-h-24 overflow-auto rounded bg-card p-2 text-[12px] leading-snug">
                                  {aiBlockDraft.proposed}
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" className="flex-1 bg-brand text-brand-foreground hover:bg-brand/90" onClick={acceptAiBlock}>
                                    Aceptar
                                  </Button>
                                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setAiBlockDraft(null)}>
                                    Descartar
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {selectedElement.type === "heading" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Texto</div>
                            <Input
                              value={selectedElement.text}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "heading" ? { ...prev, text: e.target.value } : prev,
                                )
                              }
                            />
                            <div className="text-sm font-medium">Alineación</div>
                            <Select
                              value={selectedElement.align || "left"}
                              onValueChange={(v) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "heading" ? { ...prev, align: v as "left" | "center" | "right" } : prev,
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="left">Izquierda</SelectItem>
                                <SelectItem value="center">Centro</SelectItem>
                                <SelectItem value="right">Derecha</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {selectedElement.type === "plain_text" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Texto</div>
                            <Textarea
                              value={selectedElement.text}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "plain_text" ? { ...prev, text: e.target.value } : prev,
                                )
                              }
                              rows={8}
                            />
                            <div className="text-sm font-medium">Alineación</div>
                            <Select
                              value={selectedElement.align || "left"}
                              onValueChange={(v) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "plain_text" ? { ...prev, align: v as "left" | "center" | "right" } : prev,
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="left">Izquierda</SelectItem>
                                <SelectItem value="center">Centro</SelectItem>
                                <SelectItem value="right">Derecha</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {selectedElement.type === "simple_section" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Título</div>
                            <Input
                              value={selectedElement.title}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "simple_section" ? { ...prev, title: e.target.value } : prev,
                                )
                              }
                            />
                            <div className="text-sm font-medium">Subtítulo</div>
                            <Input
                              value={selectedElement.subtitle || ""}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "simple_section" ? { ...prev, subtitle: e.target.value } : prev,
                                )
                              }
                            />
                            <div className="text-sm font-medium">Contenido</div>
                            <Textarea
                              value={selectedElement.body}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "simple_section" ? { ...prev, body: e.target.value } : prev,
                                )
                              }
                              rows={8}
                            />
                            <div className="text-sm font-medium">Bullets (una por línea)</div>
                            <Textarea
                              value={(selectedElement.bullets || []).join("\n")}
                              onChange={(e) => {
                                const bullets = e.target.value
                                  .split("\n")
                                  .map((s) => s.trim())
                                  .filter((s) => s.length > 0)
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "simple_section" ? { ...prev, bullets } : prev,
                                )
                              }}
                              rows={5}
                            />
                            <div className="text-sm font-medium">Alineación</div>
                            <Select
                              value={selectedElement.align || "left"}
                              onValueChange={(v) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "simple_section" ? { ...prev, align: v as "left" | "center" | "right" } : prev,
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="left">Izquierda</SelectItem>
                                <SelectItem value="center">Centro</SelectItem>
                                <SelectItem value="right">Derecha</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {selectedElement.type === "list" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Items (una por línea)</div>
                            <Textarea
                              value={(selectedElement.items || []).join("\n")}
                              onChange={(e) => {
                                const items = e.target.value
                                  .split("\n")
                                  .map((s) => s.trim())
                                  .filter((s) => s.length > 0)
                                updateElement(selectedElement.id, (prev) => (prev.type === "list" ? { ...prev, items } : prev))
                              }}
                              rows={10}
                            />
                            <div className="text-sm font-medium">Orden</div>
                            <Select
                              value={selectedElement.ordered ? "ordered" : "unordered"}
                              onValueChange={(v) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "list" ? { ...prev, ordered: v === "ordered" } : prev,
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unordered">Viñetas</SelectItem>
                                <SelectItem value="ordered">Numerada</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {selectedElement.type === "image" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Imagen</div>
                            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-3 text-[13px] font-medium transition-colors hover:border-brand">
                              <ImageIcon className="h-4 w-4" />
                              Subir imagen
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (!file) return
                                  const reader = new FileReader()
                                  reader.onload = () => {
                                    const src = String(reader.result || "")
                                    updateElement(selectedElement.id, (prev) => (prev.type === "image" ? { ...prev, src } : prev))
                                  }
                                  reader.readAsDataURL(file)
                                  e.target.value = ""
                                }}
                              />
                            </label>
                            {selectedElement.src ? (
                              <img src={selectedElement.src} alt="" className="max-h-28 rounded-md border border-border" />
                            ) : null}
                            <div className="text-sm font-medium">O pega una URL</div>
                            <Input
                              value={selectedElement.src.startsWith("data:") ? "" : selectedElement.src}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "image" ? { ...prev, src: e.target.value } : prev,
                                )
                              }
                              placeholder="https://..."
                            />
                            <div className="text-sm font-medium">Ancho (%)</div>
                            <Input
                              type="number"
                              value={String(selectedElement.widthPct ?? 100)}
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                if (!Number.isFinite(n)) return
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "image" ? { ...prev, widthPct: Math.max(10, Math.min(100, n)) } : prev,
                                )
                              }}
                            />
                          </div>
                        ) : null}

                        {selectedElement.type === "kpis" ? (
                          (() => {
                            const id = selectedElement.id
                            const items = selectedElement.items
                            const setKpis = (fn: (it: { label: string; value: string }[]) => { label: string; value: string }[]) =>
                              updateElement(id, (prev) => (prev.type === "kpis" ? { ...prev, items: fn(prev.items.map((x) => ({ ...x }))) } : prev))
                            return (
                              <div className="space-y-2">
                                <div className="text-sm font-medium">Indicadores</div>
                                <div className="space-y-2">
                                  {items.map((it, i) => (
                                    <div key={i} className="flex items-center gap-1.5">
                                      <Input
                                        value={it.value}
                                        placeholder="0"
                                        onChange={(e) => setKpis((arr) => arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                                        className="h-8 w-[60px] shrink-0 text-xs"
                                      />
                                      <Input
                                        value={it.label}
                                        placeholder="Etiqueta"
                                        onChange={(e) => setKpis((arr) => arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                                        className="h-8 flex-1 text-xs"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setKpis((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr))}
                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--danger)] hover:bg-danger-tint disabled:opacity-30"
                                        aria-label={`Eliminar indicador ${i + 1}`}
                                        disabled={items.length <= 1}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => setKpis((arr) => [...arr, { label: "Indicador", value: "0" }])}
                                >
                                  <Plus className="h-3.5 w-3.5" /> Indicador
                                </Button>
                              </div>
                            )
                          })()
                        ) : null}

                        {selectedElement.type === "toc" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Título</div>
                            <Input
                              value={selectedElement.title || ""}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) => (prev.type === "toc" ? { ...prev, title: e.target.value } : prev))
                              }
                              placeholder="Tabla de contenido"
                            />
                            <p className="text-xs text-muted-foreground">
                              El índice se genera automáticamente a partir de los encabezados y secciones del informe.
                            </p>
                          </div>
                        ) : null}

                        {selectedElement.type === "cover" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Título</div>
                            <Input
                              value={selectedElement.title}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) => (prev.type === "cover" ? { ...prev, title: e.target.value } : prev))
                              }
                            />
                            <div className="text-sm font-medium">Subtítulo</div>
                            <Input
                              value={selectedElement.subtitle || ""}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) => (prev.type === "cover" ? { ...prev, subtitle: e.target.value } : prev))
                              }
                            />
                            <div className="text-sm font-medium">Datos (fecha, obra…)</div>
                            <Input
                              value={selectedElement.meta || ""}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) => (prev.type === "cover" ? { ...prev, meta: e.target.value } : prev))
                              }
                            />
                          </div>
                        ) : null}

                        {selectedElement.type === "chart" ? (
                          (() => {
                            const id = selectedElement.id
                            const bars = selectedElement.bars
                            const setBars = (fn: (b: { label: string; value: number; color?: string }[]) => { label: string; value: number; color?: string }[]) =>
                              updateElement(id, (prev) => (prev.type === "chart" ? { ...prev, bars: fn(prev.bars.map((x) => ({ ...x }))) } : prev))
                            return (
                              <div className="space-y-2">
                                <div className="text-sm font-medium">Título</div>
                                <Input
                                  value={selectedElement.title || ""}
                                  onChange={(e) =>
                                    updateElement(id, (prev) => (prev.type === "chart" ? { ...prev, title: e.target.value } : prev))
                                  }
                                />
                                <div className="text-sm font-medium">Barras</div>
                                <div className="space-y-1.5">
                                  {bars.map((b, i) => (
                                    <div key={i} className="flex items-center gap-1.5">
                                      <input
                                        type="color"
                                        value={b.color || "#16130e"}
                                        onChange={(e) => setBars((arr) => arr.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
                                        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border"
                                        aria-label="Color"
                                      />
                                      <Input
                                        value={b.label}
                                        placeholder="Etiqueta"
                                        onChange={(e) => setBars((arr) => arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                                        className="h-8 flex-1 text-xs"
                                      />
                                      <Input
                                        type="number"
                                        value={String(b.value)}
                                        onChange={(e) => setBars((arr) => arr.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) || 0 } : x)))}
                                        className="h-8 w-[58px] shrink-0 text-xs"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setBars((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr))}
                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--danger)] hover:bg-danger-tint disabled:opacity-30"
                                        aria-label={`Eliminar barra ${i + 1}`}
                                        disabled={bars.length <= 1}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBars((arr) => [...arr, { label: "Barra", value: 1 }])}>
                                  <Plus className="h-3.5 w-3.5" /> Barra
                                </Button>
                              </div>
                            )
                          })()
                        ) : null}

                        {selectedElement.type === "signers" ? (
                          (() => {
                            const id = selectedElement.id
                            const signers = selectedElement.signers
                            const setSigners = (
                              fn: (s: { name: string; role: string; status: "pendiente" | "firmado"; signatureDataUrl?: string | null }[]) => { name: string; role: string; status: "pendiente" | "firmado"; signatureDataUrl?: string | null }[],
                            ) => updateElement(id, (prev) => (prev.type === "signers" ? { ...prev, signers: fn(prev.signers.map((x) => ({ ...x }))) } : prev))
                            return (
                              <div className="space-y-2">
                                <div className="text-sm font-medium">Firmantes</div>
                                <div className="space-y-2">
                                  {signers.map((sg, i) => (
                                    <div key={i} className="space-y-1.5 rounded-lg border border-border p-2">
                                      <div className="flex items-center justify-between">
                                        <span className="font-mono text-[11px] text-muted-foreground">Firmante {i + 1}</span>
                                        <button
                                          type="button"
                                          onClick={() => setSigners((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr))}
                                          className="flex h-6 w-6 items-center justify-center rounded text-[var(--danger)] hover:bg-danger-tint"
                                          aria-label={`Eliminar firmante ${i + 1}`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                      <Input
                                        value={sg.name}
                                        placeholder="Nombre"
                                        onChange={(e) => setSigners((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                                        className="h-8 text-xs"
                                      />
                                      <Input
                                        value={sg.role}
                                        placeholder="Cargo"
                                        onChange={(e) => setSigners((arr) => arr.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                                        className="h-8 text-xs"
                                      />
                                      <Select
                                        value={sg.status}
                                        onValueChange={(v) => setSigners((arr) => arr.map((x, j) => (j === i ? { ...x, status: v as "pendiente" | "firmado" } : x)))}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="pendiente">Pendiente</SelectItem>
                                          <SelectItem value="firmado">Firmado</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  ))}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => setSigners((arr) => [...arr, { name: "Nombre", role: "Cargo", status: "pendiente" }])}
                                >
                                  <Plus className="h-3.5 w-3.5" /> Firmante
                                </Button>
                              </div>
                            )
                          })()
                        ) : null}

                        {selectedElement.type === "table" ? (
                          (() => {
                            const rows = selectedElement.rows
                            const id = selectedElement.id
                            const colCount = Math.max(1, ...rows.map((r) => r.length))
                            const isFields = rows.every((r) => r.length === 2)
                            return (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-sm font-medium">{isFields ? "Campos" : "Tabla"}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {rows.length} × {colCount}
                                  </div>
                                </div>
                                <div className="overflow-x-auto">
                                  <div className="w-max min-w-full space-y-1">
                                    {colCount > 1 ? (
                                      <div className="flex items-center gap-1">
                                        {Array.from({ length: colCount }).map((_, ci) => (
                                          <button
                                            key={ci}
                                            type="button"
                                            onClick={() =>
                                              updateTable(id, (rs) =>
                                                colCount > 1 ? rs.map((r) => r.filter((_, j) => j !== ci)) : rs,
                                              )
                                            }
                                            className="flex h-5 w-[70px] shrink-0 items-center justify-center rounded text-[10px] text-muted-foreground transition-colors hover:bg-danger-tint hover:text-[var(--danger)]"
                                            aria-label={`Eliminar columna ${ci + 1}`}
                                          >
                                            ✕ col {ci + 1}
                                          </button>
                                        ))}
                                        <span className="w-6 shrink-0" />
                                      </div>
                                    ) : null}
                                    {rows.map((row, ri) => (
                                      <div key={ri} className="flex items-center gap-1">
                                        {Array.from({ length: colCount }).map((_, ci) => (
                                          <Input
                                            key={ci}
                                            value={row[ci] ?? ""}
                                            placeholder={ri === 0 ? "Encabezado" : isFields && ci === 0 ? "Clave" : isFields ? "Valor" : ""}
                                            onChange={(e) =>
                                              updateTable(id, (rs) => {
                                                const rr = [...(rs[ri] || [])]
                                                while (rr.length < colCount) rr.push("")
                                                rr[ci] = e.target.value
                                                rs[ri] = rr
                                                return rs
                                              })
                                            }
                                            className="h-8 w-[70px] shrink-0 text-xs"
                                          />
                                        ))}
                                        <button
                                          type="button"
                                          onClick={() => updateTable(id, (rs) => (rs.length > 1 ? rs.filter((_, i) => i !== ri) : rs))}
                                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--danger)] transition-colors hover:bg-danger-tint disabled:opacity-30"
                                          aria-label={`Eliminar fila ${ri + 1}`}
                                          disabled={rows.length <= 1}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() =>
                                      updateTable(id, (rs) => {
                                        const cols = Math.max(1, ...rs.map((r) => r.length))
                                        return [...rs, new Array(cols).fill("")]
                                      })
                                    }
                                  >
                                    <Plus className="h-3.5 w-3.5" /> Fila
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => updateTable(id, (rs) => (rs.length ? rs.map((r) => [...r, ""]) : [[""]]))}
                                  >
                                    <Plus className="h-3.5 w-3.5" /> Columna
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Edita cada celda directamente. La primera fila es el encabezado.
                                </p>
                              </div>
                            )
                          })()
                        ) : null}

                        {selectedElement.type === "quote" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Nombre</div>
                            <Input
                              value={selectedElement.item.name}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "quote" ? { ...prev, item: { ...prev.item, name: e.target.value } } : prev,
                                )
                              }
                            />
                            <div className="text-sm font-medium">Cargo</div>
                            <Input
                              value={selectedElement.item.role}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "quote" ? { ...prev, item: { ...prev.item, role: e.target.value } } : prev,
                                )
                              }
                            />
                            <div className="text-sm font-medium">Fecha</div>
                            <Input
                              type="date"
                              value={selectedElement.item.date}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "quote" ? { ...prev, item: { ...prev.item, date: e.target.value } } : prev,
                                )
                              }
                            />
                            <div className="text-sm font-medium">Nota / leyenda</div>
                            <Textarea
                              rows={3}
                              value={selectedElement.item.content}
                              onChange={(e) =>
                                updateElement(selectedElement.id, (prev) =>
                                  prev.type === "quote" ? { ...prev, item: { ...prev.item, content: e.target.value } } : prev,
                                )
                              }
                            />
                            <Button variant="outline" className="w-full gap-2" onClick={() => setIsSignatureOpen(true)}>
                              <FileText className="h-4 w-4" />
                              Firmar bloque
                            </Button>
                          </div>
                        ) : null}

                        {selectedElement.type === "matrix" ? (
                          (() => {
                            const id = selectedElement.id
                            const rows = selectedElement.rows
                            return (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-sm font-medium">Matriz de hallazgos</div>
                                  <div className="text-xs text-muted-foreground">{rows.length} filas</div>
                                </div>
                                <div className="space-y-2">
                                  {rows.map((row, ri) => (
                                    <div key={ri} className="space-y-1.5 rounded-lg border border-border p-2">
                                      <div className="flex items-center justify-between">
                                        <span className="font-mono text-[11px] text-muted-foreground">Fila {ri + 1}</span>
                                        <button
                                          type="button"
                                          onClick={() => updateMatrix(id, (rs) => rs.filter((_, i) => i !== ri))}
                                          className="flex h-6 w-6 items-center justify-center rounded text-[var(--danger)] transition-colors hover:bg-danger-tint"
                                          aria-label={`Eliminar fila ${ri + 1}`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                      <Input
                                        placeholder="Descripción del hallazgo"
                                        value={row.description}
                                        onChange={(e) =>
                                          updateMatrix(id, (rs) => rs.map((r, i) => (i === ri ? { ...r, description: e.target.value } : r)))
                                        }
                                        className="h-8 text-xs"
                                      />
                                      <div className="grid grid-cols-2 gap-1.5">
                                        <Input
                                          placeholder="Categoría"
                                          value={row.category || ""}
                                          onChange={(e) =>
                                            updateMatrix(id, (rs) => rs.map((r, i) => (i === ri ? { ...r, category: e.target.value } : r)))
                                          }
                                          className="h-8 text-xs"
                                        />
                                        <Input
                                          placeholder="Responsable"
                                          value={row.owner || ""}
                                          onChange={(e) =>
                                            updateMatrix(id, (rs) => rs.map((r, i) => (i === ri ? { ...r, owner: e.target.value } : r)))
                                          }
                                          className="h-8 text-xs"
                                        />
                                      </div>
                                      <div className="grid grid-cols-2 gap-1.5">
                                        <Select
                                          value={row.severity}
                                          onValueChange={(v) =>
                                            updateMatrix(id, (rs) => rs.map((r, i) => (i === ri ? { ...r, severity: v as Severity } : r)))
                                          }
                                        >
                                          <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="alta">Alta</SelectItem>
                                            <SelectItem value="medio">Medio</SelectItem>
                                            <SelectItem value="bajo">Bajo</SelectItem>
                                          </SelectContent>
                                        </Select>
                                        <Select
                                          value={row.status}
                                          onValueChange={(v) =>
                                            updateMatrix(id, (rs) => rs.map((r, i) => (i === ri ? { ...r, status: v as Status } : r)))
                                          }
                                        >
                                          <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="pendiente">Pendiente</SelectItem>
                                            <SelectItem value="en progreso">En progreso</SelectItem>
                                            <SelectItem value="resuelto">Resuelto</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <Input
                                        type="date"
                                        value={row.date}
                                        onChange={(e) =>
                                          updateMatrix(id, (rs) => rs.map((r, i) => (i === ri ? { ...r, date: e.target.value } : r)))
                                        }
                                        className="h-8 text-xs"
                                      />
                                    </div>
                                  ))}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => updateMatrix(id, (rs) => [...rs, defaultRow()])}
                                  >
                                    <Plus className="h-3.5 w-3.5" /> Fila
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setEditingMatrixElementId(id)
                                      setMatrixElementDraftRows(rows || [])
                                      setIsMatrixElementDialogOpen(true)
                                    }}
                                  >
                                    Editar en tabla grande
                                  </Button>
                                </div>
                              </div>
                            )
                          })()
                        ) : null}

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="flex-1 gap-2"
                            onClick={() => duplicateElement(selectedElement.id)}
                          >
                            <Copy className="h-4 w-4" />
                            Duplicar
                          </Button>
                          <Button
                            variant="outline"
                            className="flex-1 gap-2 border-danger/30 text-[var(--danger)] hover:bg-danger-tint hover:text-[var(--danger)]"
                            onClick={() => deleteElement(selectedElement.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Eliminar
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-4 text-[13px] text-muted-foreground">
                        Selecciona un bloque en la previsualización para editarlo.
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-sm font-medium">Responsable</div>
                      <Input value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)} />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" onClick={() => setIsSignatureOpen(true)}>
                          Firmar
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setResponsibleSignatureDataUrl(null)
                            void fetch("/api/settings/responsible-signature", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ responsible_signature: "" }),
                            })
                          }}
                          disabled={!responsibleSignatureDataUrl}
                        >
                          Quitar
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-border bg-secondary/50 p-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                          </span>
                          <span className="font-display">IA del informe</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select value={aiPeriod} onValueChange={(v) => setAiPeriod(v)}>
                            <SelectTrigger className="h-8 w-32 text-xs">
                              <SelectValue placeholder="Periodo" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="weekly">Semanal</SelectItem>
                              <SelectItem value="monthly">Mensual</SelectItem>
                              <SelectItem value="last-month">Mes anterior</SelectItem>
                            </SelectContent>
                          </Select>
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-xs text-muted-foreground">Tipo de informe:</span>
                            <Button
                              type="button"
                              variant={aiReportType === "iper" ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setAiReportType("iper")}
                            >
                              Matriz IPER
                            </Button>
                            <Button
                              type="button"
                              variant={aiReportType === "pts" ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setAiReportType("pts")}
                            >
                              PTS
                            </Button>
                            <Button
                              type="button"
                              variant={aiReportType === "ast" ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setAiReportType("ast")}
                            >
                              AST / ATS
                            </Button>
                            <Button
                              type="button"
                              variant={aiReportType === "inspection" ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setAiReportType("inspection")}
                            >
                              Inspección
                            </Button>
                            <Button
                              type="button"
                              variant={aiReportType === "accident" ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setAiReportType("accident")}
                            >
                              Accidente
                            </Button>
                          </div>
                        </div>
                      </div>
                      <Textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        rows={3}
                        placeholder="Indica a la IA el foco del informe, tono y detalles importantes."
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleFillWithAI}
                          disabled={isAiPending}
                          className="flex items-center gap-2 bg-brand text-brand-foreground hover:bg-brand/90"
                        >
                          {isAiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          Rellenar con IA
                        </Button>
                      </div>
                    </div>

                    {aiHistory.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <History className="h-4 w-4" />
                          <span>Historial IA</span>
                        </div>
                        <div className="max-h-40 space-y-1 overflow-auto text-xs">
                          {aiHistory.map((item, index) => (
                            <button
                              key={item.id}
                              type="button"
                              className="w-full rounded border px-2 py-1 text-left hover:bg-accent"
                              onClick={() => {
                                setCoverTitle(item.coverTitle)
                                setCoverSubtitle(item.coverSubtitle)
                                setElements(item.elements)
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">Versión IA {aiHistory.length - index}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(item.createdAt).toLocaleString()}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-border shadow-none">
                  <CardHeader>
                    <CardTitle className="font-display tracking-[-0.01em]">Pizarra</CardTitle>
                    <CardDescription>Arrastra o usa las flechas · Ctrl/⌘ + clic para multiseleccionar</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedIds.length > 0 ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-brand bg-brand/5 px-2.5 py-1.5">
                        <span className="text-[12px] font-semibold">{selectedIds.length} seleccionados</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => duplicateMany(selectedIds)}
                            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium hover:bg-secondary"
                          >
                            <Copy className="h-3.5 w-3.5" /> Duplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMany(selectedIds)}
                            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-[var(--danger)] hover:bg-danger-tint"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Eliminar
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedIds([])}
                            className="flex h-7 items-center rounded-md px-2 text-[12px] font-medium text-muted-foreground hover:bg-secondary"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {elements.length === 0 ? (
                      <div className="rounded-md border p-4 text-sm text-muted-foreground">
                        Agrega un componente o usa “Cargar plantilla básica”.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {elements.map((el, idx) => {
                          const isSelected = el.id === selectedElementId
                          const isMulti = selectedIds.includes(el.id)
                          const issue = validateBlock(el)
                          const sub =
                            el.type === "heading"
                              ? el.text
                              : el.type === "plain_text"
                                ? el.text
                                : el.type === "simple_section"
                                  ? el.title
                                  : el.type === "list"
                                    ? `${el.items.length} items`
                                    : el.type === "table"
                                      ? `${el.rows.length} filas`
                                      : el.type === "quote"
                                        ? el.item.name
                                        : el.type === "image"
                                          ? el.src || "(sin URL)"
                                          : ""
                          return (
                            <div
                              key={el.id}
                              className={`flex items-center gap-1.5 rounded-[10px] border p-2.5 transition-colors ${
                                isMulti
                                  ? "border-brand bg-brand/10"
                                  : isSelected
                                    ? "border-brand bg-brand/5"
                                    : "border-border hover:bg-secondary"
                              }`}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", el.id)
                                e.dataTransfer.effectAllowed = "move"
                              }}
                              onDragOver={(e) => {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = "move"
                              }}
                              onDrop={(e) => {
                                e.preventDefault()
                                const dragId = e.dataTransfer.getData("text/plain")
                                if (!dragId) return
                                moveElement(dragId, el.id)
                              }}
                              onClick={(e) => {
                                if (e.ctrlKey || e.metaKey) {
                                  setSelectedIds((cur) => (cur.includes(el.id) ? cur.filter((x) => x !== el.id) : [...cur, el.id]))
                                } else {
                                  setSelectedIds([])
                                  setSelectedElementId(el.id)
                                }
                              }}
                            >
                              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                              {issue ? (
                                <span title={issue} className="shrink-0 text-[var(--warning)]">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </span>
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-semibold">{blockLabel(el)}</div>
                                {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
                              </div>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  moveElementBy(el.id, -1)
                                }}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                                aria-label="Subir bloque"
                              >
                                <ChevronUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === elements.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  moveElementBy(el.id, 1)
                                }}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                                aria-label="Bajar bloque"
                              >
                                <ChevronDown className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  duplicateElement(el.id)
                                }}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                                aria-label="Duplicar bloque"
                                title="Duplicar bloque"
                              >
                                <Copy className="h-[13px] w-[13px]" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  deleteElement(el.id)
                                }}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--danger)] transition-colors hover:bg-danger-tint"
                                aria-label="Eliminar bloque"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
        </div>

        <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Archivar informe en Documentos</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <div className="text-sm font-medium">Trabajador *</div>
                <Select value={saveWorkerId} onValueChange={setSaveWorkerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el trabajador" />
                  </SelectTrigger>
                  <SelectContent>
                    {saveWorkers.map((w) => (
                      <SelectItem key={w.id} value={w.id.toString()}>
                        {w.first_name} {w.last_name}
                        {w.rut ? ` - ${w.rut}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-sm font-medium">Tipo de documento *</div>
                <Select value={saveDocumentTypeId} onValueChange={setSaveDocumentTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {saveDocumentTypes.map((dt) => (
                      <SelectItem key={dt.id} value={dt.id.toString()}>
                        {dt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-sm font-medium">Nombre de archivo</div>
                <Input
                  value={saveFileName}
                  onChange={(e) => setSaveFileName(e.target.value)}
                  placeholder="informe.pdf"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium">Fecha de emisión</div>
                  <Input
                    type="date"
                    value={saveIssueDate}
                    onChange={(e) => setSaveIssueDate(e.target.value)}
                  />
                </div>
                <div>
                  <div className="text-sm font-medium">Fecha de vencimiento</div>
                  <Input
                    type="date"
                    value={saveExpiryDate}
                    onChange={(e) => setSaveExpiryDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveToDocuments} disabled={isSavePending}>
                {isSavePending ? "Guardando..." : "Guardar en Documentos"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isMatrixDialogOpen} onOpenChange={setIsMatrixDialogOpen}>
          <DialogContent
            className={`w-[95vw] max-w-none ${matrixRows.length > 0 ? "sm:max-w-[1100px]" : "sm:max-w-[600px]"
              }`}
          >
            <DialogHeader>
              <DialogTitle>Matriz de hallazgos</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  Edita las filas de la matriz en formato tabla. Se usará en el diseñador.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setMatrixRows((rows) => [...rows, defaultRow()])}>
                    Agregar fila
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isMatrixFillPending}
                    className="flex items-center gap-1"
                    onClick={() => {
                      startMatrixFillTransition(async () => {
                        try {
                          const rows = await fillMatrixWithAI({ projectId, request: aiPrompt })
                          if (Array.isArray(rows) && rows.length > 0) {
                            setMatrixRows(rows)
                          }
                        } catch {
                          setEditorAlerts((prev) => [...prev, "Error al generar matriz con IA. Revisa la configuración de IA."])
                        }
                      })
                    }}
                  >
                    {isMatrixFillPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    <span className="text-[11px]">Llenar con IA</span>
                  </Button>
                </div>
              </div>
              {matrixRows.length === 0 ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">No hay filas en la matriz.</div>
              ) : (
                <div className="max-h-[60vh] overflow-auto rounded-md border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Descripción</th>
                        <th className="px-2 py-1 text-left font-medium">Categoría</th>
                        <th className="px-2 py-1 text-left font-medium">Responsable</th>
                        <th className="px-2 py-1 text-left font-medium">Severidad</th>
                        <th className="px-2 py-1 text-left font-medium">Estado</th>
                        <th className="px-2 py-1 text-left font-medium">Fecha</th>
                        <th className="px-2 py-1 text-left font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixRows.map((row, idx) => (
                        <tr key={idx} className="border-t align-top">
                          <td className="px-2 py-1">
                            <Textarea
                              value={row.description}
                              onChange={(e) => updateRow(idx, { description: e.target.value })}
                              rows={3}
                              className="min-h-[60px] text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              value={row.category || ""}
                              onChange={(e) => updateRow(idx, { category: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              value={row.owner || ""}
                              onChange={(e) => updateRow(idx, { owner: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Select value={row.severity} onValueChange={(v) => updateRow(idx, { severity: v as Severity })}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="alta">Alta</SelectItem>
                                <SelectItem value="medio">Media</SelectItem>
                                <SelectItem value="bajo">Baja</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select value={row.status} onValueChange={(v) => updateRow(idx, { status: v as Status })}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pendiente">Pendiente</SelectItem>
                                <SelectItem value="en progreso">En progreso</SelectItem>
                                <SelectItem value="resuelto">Resuelto</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              type="date"
                              value={row.date}
                              onChange={(e) => updateRow(idx, { date: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setMatrixRows((rows) => rows.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="mr-1 h-3 w-3" />
                              Eliminar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isMatrixElementDialogOpen}
          onOpenChange={(open) => {
            setIsMatrixElementDialogOpen(open)
            if (!open) {
              setEditingMatrixElementId(null)
            }
          }}
        >
          <DialogContent
            className={`w-[95vw] max-w-none ${matrixElementDraftRows.length > 0 ? "sm:max-w-[1100px]" : "sm:max-w-[600px]"
              }`}
          >
            <DialogHeader>
              <DialogTitle>Editar matriz del componente</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  Este editor solo afecta a la matriz seleccionada en el diseñador.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMatrixElementDraftRows((rows) => [...rows, defaultRow()])}
                  >
                    Agregar fila
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isMatrixElementFillPending}
                    className="flex items-center gap-1"
                    onClick={() => {
                      startMatrixElementFillTransition(async () => {
                        try {
                          const rows = await fillMatrixWithAI({ projectId, request: aiPrompt })
                          if (Array.isArray(rows) && rows.length > 0) {
                            setMatrixElementDraftRows(rows)
                          }
                        } catch {
                          setEditorAlerts((prev) => [...prev, "Error al generar matriz con IA. Revisa la configuración de IA."])
                        }
                      })
                    }}
                  >
                    {isMatrixElementFillPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    <span className="text-[11px]">Llenar con IA</span>
                  </Button>
                </div>
              </div>
              {matrixElementDraftRows.length === 0 ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  No hay filas en esta matriz.
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-auto rounded-md border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Descripción</th>
                        <th className="px-2 py-1 text-left font-medium">Categoría</th>
                        <th className="px-2 py-1 text-left font-medium">Responsable</th>
                        <th className="px-2 py-1 text-left font-medium">Severidad</th>
                        <th className="px-2 py-1 text-left font-medium">Estado</th>
                        <th className="px-2 py-1 text-left font-medium">Fecha</th>
                        <th className="px-2 py-1 text-left font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixElementDraftRows.map((row, idx) => (
                        <tr key={idx} className="border-t align-top">
                          <td className="px-2 py-1">
                            <Textarea
                              value={row.description}
                              onChange={(e) =>
                                setMatrixElementDraftRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, description: e.target.value } : r,
                                  ),
                                )
                              }
                              rows={3}
                              className="min-h-[60px] text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              value={row.category || ""}
                              onChange={(e) =>
                                setMatrixElementDraftRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, category: e.target.value } : r,
                                  ),
                                )
                              }
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              value={row.owner || ""}
                              onChange={(e) =>
                                setMatrixElementDraftRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, owner: e.target.value } : r,
                                  ),
                                )
                              }
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={row.severity}
                              onValueChange={(v) =>
                                setMatrixElementDraftRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, severity: v as Severity } : r,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="alta">Alta</SelectItem>
                                <SelectItem value="medio">Media</SelectItem>
                                <SelectItem value="bajo">Baja</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={row.status}
                              onValueChange={(v) =>
                                setMatrixElementDraftRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, status: v as Status } : r,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pendiente">Pendiente</SelectItem>
                                <SelectItem value="en progreso">En progreso</SelectItem>
                                <SelectItem value="resuelto">Resuelto</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              type="date"
                              value={row.date}
                              onChange={(e) =>
                                setMatrixElementDraftRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx ? { ...r, date: e.target.value } : r,
                                  ),
                                )
                              }
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() =>
                                setMatrixElementDraftRows((rows) => rows.filter((_, i) => i !== idx))
                              }
                            >
                              <Trash2 className="mr-1 h-3 w-3" />
                              Eliminar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsMatrixElementDialogOpen(false)
                  setEditingMatrixElementId(null)
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (!editingMatrixElementId) {
                    setIsMatrixElementDialogOpen(false)
                    return
                  }
                  setElements((arr) =>
                    arr.map((el) =>
                      el.id === editingMatrixElementId && el.type === "matrix"
                        ? { ...el, rows: matrixElementDraftRows }
                        : el,
                    ),
                  )
                  setIsMatrixElementDialogOpen(false)
                  setEditingMatrixElementId(null)
                }}
              >
                Guardar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
    </div>
  )
}
