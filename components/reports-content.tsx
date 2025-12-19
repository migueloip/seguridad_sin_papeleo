"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  FileBarChart,
  Download,
  Calendar,
  FileText,
  CheckCircle,
  Loader2,
  Sparkles,
  AlertTriangle,
  Eye,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react"
import { fillPdfDesignerWithAI, getReportData, generateAIReport, getReportById, createManualReport, updateReport } from "@/app/actions/reports"
import { getFindings } from "@/app/actions/findings"
import { Input } from "@/components/ui/input"
import ReactMarkdown from "react-markdown"
import type { EditorState, MatrixRow, DocumentAttachment, QuoteItem, DesignerElement, PageSize, Severity, Status } from "@/lib/pdf-editor"
import { buildEditorHtmlFromState, validateEditorState, buildDesignerHtmlFromState } from "@/lib/pdf-editor"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface GeneratedReport {
  id: number
  report_type: string
  title: string
  date_from: string
  date_to: string
  created_at: string
}

type FindingRow = {
  id: number
  title: string
  description: string | null
  severity: string
  status: string
  location: string | null
  created_at: string
  photos?: string[] | null
}

const reportTemplates = [
  {
    id: "weekly",
    title: "Reporte Semanal",
    description: "Resumen de actividades, hallazgos y KPIs de la semana",
    sections: ["Resumen ejecutivo", "Hallazgos", "Inspecciones", "KPIs"],
  },
  {
    id: "monthly",
    title: "Informe Mensual",
    description: "Analisis completo del mes con tendencias y recomendaciones",
    sections: ["Estadisticas", "Tendencias", "Analisis de riesgos", "Recomendaciones"],
  },
  {
    id: "findings",
    title: "Reporte de Hallazgos",
    description: "Detalle de todos los hallazgos con estado y seguimiento",
    sections: ["Hallazgos abiertos", "Hallazgos cerrados", "Tiempo de respuesta"],
  },
  {
    id: "docs",
    title: "Estado de Documentacion",
    description: "Vencimientos y estado de documentos del personal",
    sections: ["Documentos vigentes", "Por vencer", "Vencidos"],
  },
]

interface ReportsContentProps {
  initialReports?: GeneratedReport[]
  projectId?: number
}

export function ReportsContent({ initialReports = [], projectId }: ReportsContentProps) {
  const [generating, setGenerating] = useState<string | null>(null)
  const [period, setPeriod] = useState("weekly")
  const [isPending, startTransition] = useTransition()
  const [generatedReports, setGeneratedReports] = useState<GeneratedReport[]>(initialReports)
  const [error, setError] = useState<string | null>(null)
  const [viewingReport, setViewingReport] = useState<{ title: string; content: string } | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [editContent, setEditContent] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [manualTitle, setManualTitle] = useState("")
  const [manualDateFrom, setManualDateFrom] = useState("")
  const [manualDateTo, setManualDateTo] = useState("")
  const [manualContent, setManualContent] = useState("")
  const [savingManual, setSavingManual] = useState(false)
  const [findingsList, setFindingsList] = useState<
    Array<{
      id: number
      title: string
      description: string | null
      severity: string
      status: string
      location: string | null
      created_at: string
      photos?: string[] | null
    }>
  >([])
  const [findingsLoading, setFindingsLoading] = useState(false)
  const [findingsQuery, setFindingsQuery] = useState("")
  const [selectedFindingIds, setSelectedFindingIds] = useState<number[]>([])
  const [brandName, setBrandName] = useState<string>("")
  const [brandLogo, setBrandLogo] = useState<string>("")
  const [responsibleName, setResponsibleName] = useState<string>("")
  const [pdfFont, setPdfFont] = useState<"sans-serif" | "serif">("sans-serif")
  const [pdfFontSize, setPdfFontSize] = useState<number>(14)
  const [pdfColor, setPdfColor] = useState<string>("#111827")
  const [editorSections, setEditorSections] = useState<Array<"cover" | "summary" | "matrix" | "docs" | "quotes" | "recs">>([
    "cover",
    "summary",
    "matrix",
    "docs",
    "quotes",
    "recs",
  ])
  const [coverTitle, setCoverTitle] = useState<string>("Informe de Seguridad")
  const [coverSubtitle, setCoverSubtitle] = useState<string>("Resumen de prevención de riesgos")
  const [summaryText, setSummaryText] = useState<string>("")
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([])
  const [recs, setRecs] = useState<string[]>([])
  const [expandedSections, setExpandedSections] = useState<Array<"cover" | "summary" | "matrix" | "docs" | "quotes" | "recs">>([])
  const [aiTemplate, setAiTemplate] = useState<"weekly" | "monthly" | "findings" | "docs">("weekly")
  const [aiFillRequest, setAiFillRequest] = useState<string>("")
  type EditorSnapshot = {
    pdfFont: "sans-serif" | "serif"
    pdfFontSize: number
    pdfColor: string
    editorSections: Array<"cover" | "summary" | "matrix" | "docs" | "quotes" | "recs">
    coverTitle: string
    coverSubtitle: string
    summaryText: string
    matrixRows: MatrixRow[]
    recs: string[]
    responsibleName: string
  }
  const [history, setHistory] = useState<EditorSnapshot[]>([])
  const [redo, setRedo] = useState<EditorSnapshot[]>([])
  const [editorAlerts, setEditorAlerts] = useState<string[]>([])
  const [pdfA, setPdfA] = useState<boolean>(false)
  const [docs, setDocs] = useState<DocumentAttachment[]>([])
  const [quotes, setQuotes] = useState<QuoteItem[]>([])
  const [quoteDraft, setQuoteDraft] = useState<QuoteItem>({ name: "", role: "", date: new Date().toISOString().slice(0, 10), content: "", signatureDataUrl: null })
  const [signaturePenColor, setSignaturePenColor] = useState<string>("#111827")
  const [signaturePenWidth, setSignaturePenWidth] = useState<number>(2)
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [designerEnabled, setDesignerEnabled] = useState<boolean>(false)
  const [pageSize, setPageSize] = useState<PageSize>("A4")
  const [pageMarginMm, setPageMarginMm] = useState<number>(20)
  const [elements, setElements] = useState<DesignerElement[]>([])
  const [expandedElementId, setExpandedElementId] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  type EditorVersion = EditorState & { id: string; date: string }
  const [editorVersions, setEditorVersions] = useState<EditorVersion[]>([])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [nameRes, logoRes] = await Promise.all([
          fetch("/api/settings/company-name"),
          fetch("/api/settings/company-logo"),
        ])
        const nameJson = await nameRes.json()
        const logoJson = await logoRes.json()
        if (!mounted) return
        setBrandName(String(nameJson.company_name || ""))
        setBrandLogo(String(logoJson.company_logo || ""))
        try {
          const resp = await fetch("/api/settings/responsible-name")
          const j = await resp.json()
          setResponsibleName(String(j.responsible_name || ""))
        } catch {}
      } catch {}
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pdfEditorVersions")
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) setEditorVersions(parsed as EditorVersion[])
    } catch {}
  }, [])

  const saveEditorVersion = () => {
    try {
      const snapshot: EditorVersion = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        date: new Date().toISOString(),
        pdfFont,
        pdfFontSize,
        pdfColor,
        editorSections,
        coverTitle,
        coverSubtitle,
        summaryText,
        matrixRows,
        recs,
        brandLogo: brandLogo || null,
        responsibleName,
        pdfA,
        docs,
        quotes,
        designerEnabled,
        pageSize,
        pageMarginMm,
        elements,
      }
      const versionsRaw = localStorage.getItem("pdfEditorVersions")
      const versions = versionsRaw ? JSON.parse(versionsRaw) : []
      const next = [...(Array.isArray(versions) ? versions : []), snapshot].slice(-20)
      localStorage.setItem("pdfEditorVersions", JSON.stringify(next))
      setEditorVersions(next as EditorVersion[])
    } catch {}
  }

  const loadEditorVersion = (v: EditorVersion) => {
    pushHistory()
    setPdfFont(v.pdfFont)
    setPdfFontSize(v.pdfFontSize)
    setPdfColor(v.pdfColor)
    setEditorSections(v.editorSections)
    setCoverTitle(v.coverTitle)
    setCoverSubtitle(v.coverSubtitle)
    setSummaryText(v.summaryText)
    setMatrixRows(v.matrixRows)
    setRecs(v.recs)
    setResponsibleName(String(v.responsibleName || ""))
    setPdfA(Boolean(v.pdfA))
    setDocs(Array.isArray(v.docs) ? v.docs : [])
    setQuotes(Array.isArray(v.quotes) ? v.quotes : [])
    setDesignerEnabled(Boolean(v.designerEnabled))
    setPageSize((v.pageSize as PageSize) || "A4")
    setPageMarginMm(typeof v.pageMarginMm === "number" ? v.pageMarginMm : 20)
    setElements(Array.isArray(v.elements) ? (v.elements as DesignerElement[]) : [])
    setExpandedSections([])
  }

  const deleteEditorVersion = (id: string) => {
    try {
      const next = editorVersions.filter((v) => v.id !== id)
      localStorage.setItem("pdfEditorVersions", JSON.stringify(next))
      setEditorVersions(next)
    } catch {}
  }

  const pushHistory = () => {
    const snapshot = {
      pdfFont,
      pdfFontSize,
      pdfColor,
      editorSections,
      coverTitle,
      coverSubtitle,
      summaryText,
      matrixRows,
      recs,
      responsibleName,
    }
    setHistory((h) => [...h, snapshot])
    setRedo([])
  }
  const undoEdit = () => {
    setHistory((h) => {
      if (h.length === 0) return h
      const last = h[h.length - 1]
      setRedo((r) => [...r, { pdfFont, pdfFontSize, pdfColor, editorSections, coverTitle, coverSubtitle, summaryText, matrixRows, recs, responsibleName }])
      setPdfFont(last.pdfFont)
      setPdfFontSize(last.pdfFontSize)
      setPdfColor(last.pdfColor)
      setEditorSections(last.editorSections)
      setCoverTitle(last.coverTitle)
      setCoverSubtitle(last.coverSubtitle)
      setSummaryText(last.summaryText)
      setMatrixRows(last.matrixRows)
      setRecs(last.recs)
      setResponsibleName(last.responsibleName)
      return h.slice(0, -1)
    })
  }
  const redoEdit = () => {
    setRedo((r) => {
      if (r.length === 0) return r
      const last = r[r.length - 1]
      setHistory((h) => [...h, { pdfFont, pdfFontSize, pdfColor, editorSections, coverTitle, coverSubtitle, summaryText, matrixRows, recs, responsibleName }])
      setPdfFont(last.pdfFont)
      setPdfFontSize(last.pdfFontSize)
      setPdfColor(last.pdfColor)
      setEditorSections(last.editorSections)
      setCoverTitle(last.coverTitle)
      setCoverSubtitle(last.coverSubtitle)
      setSummaryText(last.summaryText)
      setMatrixRows(last.matrixRows)
      setRecs(last.recs)
      setResponsibleName(last.responsibleName)
      return r.slice(0, -1)
    })
  }

  const handleGenerate = async (templateId: string) => {
    setGenerating(templateId)
    setError(null)

    startTransition(async () => {
      try {
        // Obtener datos del periodo
        const data = await getReportData(period, projectId)

        // Generar informe con IA
        const result = await generateAIReport(templateId, data, projectId)

        // Mostrar el informe generado
        setViewingReport(result)
        setViewingId(result.id)
        setEditTitle(result.title)
        setEditContent(result.content)
        setIsViewOpen(true)

        // Actualizar lista de informes
        const newReport: GeneratedReport = {
          id: result.id,
          report_type: templateId,
          title: result.title,
          date_from: data.dateFrom,
          date_to: data.dateTo,
          created_at: new Date().toISOString(),
        }
        setGeneratedReports((prev) => [newReport, ...prev])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al generar el informe")
      } finally {
        setGenerating(null)
      }
    })
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }
  const toHtml = (md: string, meta?: GeneratedReport) => {
    let html = md || ""
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%;height:auto"/>')
    html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>")
    html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>")
    html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>")
    html = html.replace(/^(?!<h[1-6]>|<img)(.+)$/gm, "<p>$1</p>")
    const title = viewingReport?.title || editTitle || meta?.title || "Informe"
    const sub =
      meta?.date_from && meta?.date_to
        ? `Periodo: ${formatDate(meta.date_from)} - ${formatDate(meta.date_to)}`
        : new Date().toLocaleDateString("es-CL")
    const header =
      `<header style="display:flex;align-items:center;justify-between;margin-bottom:24px;border-bottom:1px solid #e5e7eb;padding-bottom:12px">
        <div style="display:flex;align-items:center;gap:12px">
          ${brandLogo ? `<img src="${brandLogo}" alt="Logo" style="height:56px;width:auto;object-fit:contain"/>` : ""}
          <div>
            <div style="font-size:20px;font-weight:600">${brandName || ""}</div>
            <div style="font-size:12px;color:#666">${sub}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:600">${title}</div>
        </div>
      </header>`
    return `${header}${html}`
  }
  const validateEditor = () => {
    if (designerEnabled) {
      const alerts: string[] = []
      if (!responsibleName || !responsibleName.trim()) alerts.push("Falta el nombre del responsable en el pie de página")
      if (!Array.isArray(elements) || elements.length === 0) alerts.push("El documento no tiene elementos")
      setEditorAlerts(alerts)
      return alerts.length === 0
    } else {
      const alerts = validateEditorState({
        pdfFont,
        pdfFontSize,
        pdfColor,
        editorSections,
        coverTitle,
        coverSubtitle,
        summaryText,
        matrixRows,
        recs,
        brandLogo,
        responsibleName,
        pdfA,
        docs,
        quotes,
      })
      setEditorAlerts(alerts)
      return alerts.length === 0
    }
  }
  const buildEditorHtml = () => {
    const state: EditorState = {
      pdfFont,
      pdfFontSize,
      pdfColor,
      editorSections,
      coverTitle,
      coverSubtitle,
      summaryText,
      matrixRows,
      recs,
      brandLogo,
      responsibleName,
      pdfA,
      docs,
      quotes,
      designerEnabled,
      pageSize,
      pageMarginMm,
      elements,
    }
    if (designerEnabled) return buildDesignerHtmlFromState(state)
    return buildEditorHtmlFromState(state)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Generador de Informes</h1>
        <p className="text-muted-foreground">Genera informes automaticos con IA a partir de los datos del sistema</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Dialog open={isViewOpen} onOpenChange={(v) => { setIsViewOpen(v); if (!v) { setIsEditing(false) } }}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Editar informe" : viewingReport?.title}</DialogTitle>
          </DialogHeader>
          {isEditing ? (
            <div className="space-y-4">
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Titulo del informe" />
              <textarea
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
                rows={16}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
            </div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              {viewingReport && <ReactMarkdown>{viewingReport.content}</ReactMarkdown>}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsViewOpen(false)}>
              Cerrar
            </Button>
            <Button variant="outline" onClick={() => setIsEditing(!isEditing)}>
              {isEditing ? "Previsualizar" : "Editar"}
            </Button>
            <Button
              variant="default"
              disabled={!isEditing || savingEdit || !viewingId}
              onClick={() => {
                if (!viewingId) return
                setSavingEdit(true)
                startTransition(async () => {
                  try {
                    await updateReport(viewingId, { title: editTitle, markdown: editContent })
                    setViewingReport({ title: editTitle, content: editContent })
                    setIsEditing(false)
                  } catch {
                    setError("No se pudo guardar el informe")
                  } finally {
                    setSavingEdit(false)
                  }
                })
              }}
            >
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </Button>
            <Button
              onClick={() => {
                const blob = new Blob([viewingReport?.content || editContent || ""], { type: "text/markdown" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `${viewingReport?.title || editTitle || "informe"}.md`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Descargar
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const w = window.open("", "_blank")
                if (!w) return
                const text = viewingReport?.content || editContent || ""
                const meta = generatedReports.find((r) => r.id === viewingId)
                const body = toHtml(text, meta)
                w.document.write(`<!doctype html><html><head><meta charset=\"utf-8\"><title>${viewingReport?.title || editTitle || "informe"}</title><style>body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:40px;line-height:1.7;color:#111827}img{display:block;margin:8px 0;max-width:100%;height:auto}h1{font-size:22px;margin:16px 0 8px}h2{font-size:18px;margin:12px 0 6px}h3{font-size:16px;margin:8px 0 4px}@page{size:A4;margin:20mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}<script>setTimeout(function(){window.print()},100)</script></body></html>`)
                w.document.close()
              }}
            >
              Imprimir
            </Button>
            <Button
              onClick={() => {
                const w = window.open("", "_blank")
                if (!w) return
                const text = viewingReport?.content || editContent || ""
                const meta = generatedReports.find((r) => r.id === viewingId)
                const body = toHtml(text, meta)
                w.document.write(`<!doctype html><html><head><meta charset=\"utf-8\"><title>${viewingReport?.title || editTitle || "informe"}</title><style>body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:40px;line-height:1.7;color:#111827}img{display:block;margin:8px 0;max-width:100%;height:auto}h1{font-size:22px;margin:16px 0 8px}h2{font-size:18px;margin:12px 0 6px}h3{font-size:16px;margin:8px 0 4px}@page{size:A4;margin:20mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}<script>setTimeout(function(){window.print()},100)</script></body></html>`)
                w.document.close()
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Descargar PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="editor" className="space-y-6">
        <TabsList>
          <TabsTrigger value="editor">Editor PDF</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        

        <TabsContent value="editor" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Editor de PDF</CardTitle>
              <CardDescription>Maqueta estructurada para prevención de riesgos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={pdfFont}
                  onChange={(e) => {
                    pushHistory()
                    setPdfFont(e.target.value as "sans-serif" | "serif")
                  }}
                  className="rounded border bg-background px-2 py-1 text-sm"
                >
                  <option value="sans-serif">Sans Serif</option>
                  <option value="serif">Serif</option>
                </select>
                <Input
                  type="number"
                  value={pdfFontSize}
                  onChange={(e) => {
                    pushHistory()
                    setPdfFontSize(Number(e.target.value) || 14)
                  }}
                  className="w-24"
                  placeholder="Tamaño"
                />
                <input
                  type="color"
                  value={pdfColor}
                  onChange={(e) => {
                    pushHistory()
                    setPdfColor(e.target.value)
                  }}
                />
                <Input
                  placeholder="Responsable del documento"
                  value={responsibleName}
                  onChange={(e) => {
                    pushHistory()
                    setResponsibleName(e.target.value)
                  }}
                />
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="rounded border bg-background px-2 py-1 text-sm"
                >
                  <option value="weekly">Esta semana</option>
                  <option value="last-week">Semana pasada</option>
                  <option value="monthly">Este mes</option>
                  <option value="last-month">Mes pasado</option>
                </select>
                <select
                  value={aiTemplate}
                  onChange={(e) => setAiTemplate(e.target.value as "weekly" | "monthly" | "findings" | "docs")}
                  className="rounded border bg-background px-2 py-1 text-sm"
                >
                  <option value="weekly">Plantilla semanal</option>
                  <option value="monthly">Plantilla mensual</option>
                  <option value="findings">Plantilla hallazgos</option>
                  <option value="docs">Plantilla documentos</option>
                </select>
                <Button
                  variant="outline"
                  onClick={() => {
                    setGenerating("fill")
                    startTransition(async () => {
                      try {
                        if (designerEnabled) {
                          pushHistory()
                          const state: EditorState = {
                            pdfFont,
                            pdfFontSize,
                            pdfColor,
                            editorSections,
                            coverTitle,
                            coverSubtitle,
                            summaryText,
                            matrixRows,
                            recs,
                            brandLogo,
                            responsibleName,
                            pdfA,
                            docs,
                            quotes,
                            designerEnabled,
                            pageSize,
                            pageMarginMm,
                            elements,
                          }
                          const filled = await fillPdfDesignerWithAI({ period, projectId, request: aiFillRequest, state })
                          if (filled?.coverTitle) setCoverTitle(String(filled.coverTitle))
                          if (filled?.coverSubtitle !== undefined) setCoverSubtitle(String(filled.coverSubtitle || ""))
                          if (Array.isArray(filled?.elements)) setElements(filled.elements as DesignerElement[])
                          setEditorAlerts([])
                        } else {
                          const data = await getReportData(period, projectId)
                          const result = await generateAIReport(aiTemplate, data, projectId)
                          const md = String(result?.content || "")
                          const plain = md
                            .replace(/^#{1,6}\s+/gm, "")
                            .replace(/\*\*/g, "")
                            .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
                            .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
                          setCoverTitle(String(result?.title || coverTitle))
                          setSummaryText(plain)
                          try {
                            const items = (await getFindings(projectId)) as unknown as FindingRow[]
                            const nextRows = (items || []).slice(0, 10).map((f) => ({
                              description: f.description || f.title,
                              severity: (["alta", "medio", "bajo"] as Severity[]).includes(f.severity as Severity)
                                ? (f.severity as Severity)
                                : "medio",
                              status: (["pendiente", "en progreso", "resuelto"] as Status[]).includes(f.status as Status)
                                ? (f.status as Status)
                                : "pendiente",
                              date: new Date(f.created_at).toISOString().slice(0, 10),
                              category: "",
                              owner: "",
                            }))
                            setMatrixRows(nextRows)
                          } catch {}
                          setEditorAlerts([])
                        }
                      } catch {
                        setEditorAlerts(["No se pudo rellenar con IA"])
                      } finally {
                        setGenerating(null)
                      }
                    })
                  }}
                >
                  {generating === "fill" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Rellenar con IA
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">Agregar sección</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => {
                        pushHistory()
                        setEditorSections((arr) => (arr.includes("cover") ? arr : [...arr, "cover"]))
                        setExpandedSections((arr) => (arr.includes("cover") ? arr : [...arr, "cover"]))
                      }}
                    >
                      Portada
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        pushHistory()
                        setEditorSections((arr) => (arr.includes("summary") ? arr : [...arr, "summary"]))
                        setExpandedSections((arr) => (arr.includes("summary") ? arr : [...arr, "summary"]))
                      }}
                    >
                      Resumen
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        pushHistory()
                        setEditorSections((arr) => (arr.includes("matrix") ? arr : [...arr, "matrix"]))
                        setExpandedSections((arr) => (arr.includes("matrix") ? arr : [...arr, "matrix"]))
                      }}
                    >
                      Matriz
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        pushHistory()
                        setEditorSections((arr) => (arr.includes("docs") ? arr : [...arr, "docs"]))
                        setExpandedSections((arr) => (arr.includes("docs") ? arr : [...arr, "docs"]))
                      }}
                    >
                      Documentos
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        pushHistory()
                        setEditorSections((arr) => (arr.includes("quotes") ? arr : [...arr, "quotes"]))
                        setExpandedSections((arr) => (arr.includes("quotes") ? arr : [...arr, "quotes"]))
                      }}
                    >
                      Citas
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        pushHistory()
                        setEditorSections((arr) => (arr.includes("recs") ? arr : [...arr, "recs"]))
                        setExpandedSections((arr) => (arr.includes("recs") ? arr : [...arr, "recs"]))
                      }}
                    >
                      Recomendaciones
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  onClick={() => {
                    undoEdit()
                  }}
                  disabled={history.length === 0}
                >
                  Deshacer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    redoEdit()
                  }}
                  disabled={redo.length === 0}
                >
                  Rehacer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    pushHistory()
                    setPdfA((v) => !v)
                  }}
                >
                  PDF/A
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    saveEditorVersion()
                  }}
                >
                  Guardar versión
                </Button>
                <Button
                  variant={designerEnabled ? "default" : "outline"}
                  onClick={() => {
                    setDesignerEnabled((v) => !v)
                  }}
                >
                  Modo diseñador
                </Button>
                {designerEnabled && (
                  <>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(e.target.value as PageSize)
                      }}
                      className="rounded border bg-background px-2 py-1 text-sm"
                    >
                      <option value="A4">A4</option>
                      <option value="Letter">Letter</option>
                      <option value="Legal">Legal</option>
                    </select>
                    <Input
                      type="number"
                      value={pageMarginMm}
                      onChange={(e) => {
                        setPageMarginMm(Number(e.target.value) || 20)
                      }}
                      className="w-28"
                      placeholder="Margen (mm)"
                    />
                  </>
                )}
              </div>
              {designerEnabled && (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Pedido para IA</p>
                  <textarea
                    className="w-full rounded border bg-background p-2 text-sm"
                    rows={3}
                    value={aiFillRequest}
                    onChange={(e) => setAiFillRequest(e.target.value)}
                    placeholder="Ej: Completa los textos con el resumen del periodo, KPIs y recomendaciones. Mantén el mismo layout."
                  />
                </div>
              )}
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  {!designerEnabled && (
                  <div
                    className="space-y-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const from = e.dataTransfer.getData("section")
                      const to = e.currentTarget.getAttribute("data-drop")
                      if (!from || !to) return
                    }}
                  >
                    {editorSections.map((sec, idx) => (
                      <div
                        key={sec + idx}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("section-index", String(idx))}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          const fromIdx = Number(e.dataTransfer.getData("section-index"))
                          const toIdx = idx
                          if (!Number.isFinite(fromIdx)) return
                          pushHistory()
                          setEditorSections((arr) => {
                            const copy = [...arr]
                            const [moved] = copy.splice(fromIdx, 1)
                            copy.splice(toIdx, 0, moved)
                            return copy
                          })
                        }}
                        className="rounded border p-3"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">
                            {sec === "cover"
                              ? "Portada"
                              : sec === "summary"
                              ? "Resumen Ejecutivo"
                              : sec === "matrix"
                              ? "Matriz de Hallazgos"
                              : sec === "docs"
                              ? "Documentos"
                              : sec === "quotes"
                              ? "Citas de Personal"
                              : "Recomendaciones"}
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={idx === 0}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (idx === 0) return
                                pushHistory()
                                setEditorSections((arr) => {
                                  const copy = [...arr]
                                  const tmp = copy[idx - 1]
                                  copy[idx - 1] = copy[idx]
                                  copy[idx] = tmp
                                  return copy
                                })
                              }}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={idx === editorSections.length - 1}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (idx === editorSections.length - 1) return
                                pushHistory()
                                setEditorSections((arr) => {
                                  const copy = [...arr]
                                  const tmp = copy[idx + 1]
                                  copy[idx + 1] = copy[idx]
                                  copy[idx] = tmp
                                  return copy
                                })
                              }}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedSections((arr) => (arr.includes(sec) ? arr.filter((s) => s !== sec) : [...arr, sec]))
                              }}
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${
                                  expandedSections.includes(sec) ? "rotate-180" : ""
                                }`}
                              />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                pushHistory()
                                setEditorSections((arr) => arr.filter((_, i) => i !== idx))
                                setExpandedSections((arr) => arr.filter((s) => s !== sec))
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              Quitar sección
                            </Button>
                          </div>
                        </div>
                        {expandedSections.includes(sec) && (
                          <div className="mt-2 space-y-2">
                        {sec === "cover" && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Portada</p>
                            <Input
                              placeholder="Título del documento"
                              value={coverTitle}
                              onChange={(e) => {
                                pushHistory()
                                setCoverTitle(e.target.value)
                              }}
                            />
                            <Input
                              placeholder="Subtítulo"
                              value={coverSubtitle}
                              onChange={(e) => {
                                pushHistory()
                                setCoverSubtitle(e.target.value)
                              }}
                            />
                          </div>
                        )}
                        {sec === "summary" && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Resumen Ejecutivo</p>
                            <textarea
                              className="w-full rounded border bg-background p-2 text-sm"
                              rows={8}
                              value={summaryText}
                              onChange={(e) => {
                                pushHistory()
                                setSummaryText(e.target.value)
                              }}
                            />
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  pushHistory()
                                  setSummaryText((t) => t + (t ? "\n" : "") + "<b>Texto en negrita</b>")
                                }}
                              >
                                Negrita
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  pushHistory()
                                  setSummaryText((t) => t + (t ? "\n" : "") + "<i>Texto en cursiva</i>")
                                }}
                              >
                                Cursiva
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  pushHistory()
                                  setSummaryText((t) => t + (t ? "\n" : "") + "<ul><li>Elemento</li></ul>")
                                }}
                              >
                                Viñetas
                              </Button>
                            </div>
                          </div>
                        )}
                        {sec === "matrix" && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Matriz de Hallazgos</p>
                            <div className="grid gap-2">
                              {matrixRows.map((row, i) => (
                                <div key={i} className="grid grid-cols-6 gap-2">
                                  <Input
                                    placeholder="Descripción"
                                    value={row.description}
                                    onChange={(e) => {
                                      pushHistory()
                                      setMatrixRows((rows) => {
                                        const copy = [...rows]
                                        copy[i] = { ...copy[i], description: e.target.value }
                                        return copy
                                      })
                                    }}
                                  />
                                  <Input
                                    placeholder="Categoría"
                                    value={row.category || ""}
                                    onChange={(e) => {
                                      pushHistory()
                                      setMatrixRows((rows) => {
                                        const copy = [...rows]
                                        copy[i] = { ...copy[i], category: e.target.value }
                                        return copy
                                      })
                                    }}
                                  />
                                  <Input
                                    placeholder="Responsable"
                                    value={row.owner || ""}
                                    onChange={(e) => {
                                      pushHistory()
                                      setMatrixRows((rows) => {
                                        const copy = [...rows]
                                        copy[i] = { ...copy[i], owner: e.target.value }
                                        return copy
                                      })
                                    }}
                                  />
                                  <select
                                    value={row.severity}
                                    onChange={(e) => {
                                      pushHistory()
                                      setMatrixRows((rows) => {
                                        const copy = [...rows]
                                        copy[i] = { ...copy[i], severity: e.target.value as Severity }
                                        return copy
                                      })
                                    }}
                                    className="rounded border bg-background px-2 py-1 text-sm"
                                  >
                                    <option value="alta">Alta</option>
                                    <option value="medio">Medio</option>
                                    <option value="bajo">Bajo</option>
                                  </select>
                                  <select
                                    value={row.status}
                                    onChange={(e) => {
                                      pushHistory()
                                      setMatrixRows((rows) => {
                                        const copy = [...rows]
                                        copy[i] = { ...copy[i], status: e.target.value as Status }
                                        return copy
                                      })
                                    }}
                                    className="rounded border bg-background px-2 py-1 text-sm"
                                  >
                                    <option value="pendiente">Pendiente</option>
                                    <option value="en progreso">En progreso</option>
                                    <option value="resuelto">Resuelto</option>
                                  </select>
                                  <Input
                                    type="date"
                                    value={row.date}
                                    onChange={(e) => {
                                      pushHistory()
                                      setMatrixRows((rows) => {
                                        const copy = [...rows]
                                        copy[i] = { ...copy[i], date: e.target.value }
                                        return copy
                                      })
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  pushHistory()
                                  setMatrixRows((rows) => [
                                    ...rows,
                                    { description: "", severity: "medio", status: "pendiente", date: new Date().toISOString().slice(0, 10), category: "", owner: "" },
                                  ])
                                 }}
                               >
                                 Agregar fila
                               </Button>
                               <Button
                                 variant="outline"
                                 onClick={() => {
                                   pushHistory()
                                   setMatrixRows((rows) => rows.slice(0, -1))
                                 }}
                                 disabled={matrixRows.length === 0}
                               >
                                 Quitar última
                               </Button>
                                <Button
                                  variant="outline"
                                  disabled={findingsLoading}
                                  onClick={() => {
                                    setFindingsLoading(true)
                                    startTransition(async () => {
                                      try {
                                        const items = (await getFindings(projectId)) as unknown as FindingRow[]
                                        setFindingsList(
                                          (items || []).map((f) => ({
                                            id: f.id,
                                            title: f.title,
                                            description: f.description ?? null,
                                            severity: f.severity,
                                            status: f.status,
                                            location: f.location ?? null,
                                            created_at: f.created_at,
                                            photos: Array.isArray(f.photos) ? f.photos : null,
                                          })),
                                        )
                                      } finally {
                                        setFindingsLoading(false)
                                      }
                                    })
                                  }}
                                >
                                  Buscar hallazgos
                                </Button>
                             </div>
                            {findingsList.length > 0 && (
                              <div className="space-y-2">
                                <Input
                                  placeholder="Buscar por #ID o texto"
                                  value={findingsQuery}
                                  onChange={(e) => setFindingsQuery(e.target.value)}
                                />
                                <div className="grid gap-2">
                                  {findingsList
                                    .filter((f) => {
                                      const q = findingsQuery.trim()
                                      if (!q) return true
                                      if (q.startsWith("#")) {
                                        const idStr = q.slice(1)
                                        const idNum = Number(idStr)
                                        return f.id === idNum
                                      }
                                      const s = q.toLowerCase()
                                      return f.title.toLowerCase().includes(s) || (f.description || "").toLowerCase().includes(s)
                                    })
                                    .slice(0, 6)
                                    .map((f) => {
                                      const checked = selectedFindingIds.includes(f.id)
                                      return (
                                        <div key={f.id} className="flex items-center justify-between rounded border px-3 py-2">
                                          <div className="flex items-center gap-3">
                                            <div className="flex h-8 w-8 items-center justify-center rounded bg-muted text-xs">#{f.id}</div>
                                            <div>
                                              <p className="text-sm font-medium">{f.title}</p>
                                              <div className="text-xs text-muted-foreground">
                                                {f.severity} · {f.status} · {formatDate(f.created_at)}
                                              </div>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Badge variant="outline">{f.location || "-"}</Badge>
                                            <Button
                                              variant={checked ? "secondary" : "outline"}
                                              size="sm"
                                              onClick={() => {
                                                setSelectedFindingIds((prev) => (checked ? prev.filter((id) => id !== f.id) : [...prev, f.id]))
                                              }}
                                            >
                                              {checked ? "Quitar" : "Agregar"}
                                            </Button>
                                          </div>
                                        </div>
                                      )
                                    })}
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    disabled={selectedFindingIds.length === 0}
                                    onClick={() => {
                                      const selected = findingsList.filter((f) => selectedFindingIds.includes(f.id))
                                      pushHistory()
                                      setMatrixRows((rows) => [
                                        ...rows,
                                        ...selected.map((f) => ({
                                          description: f.description || f.title,
                                          severity: (["alta", "medio", "bajo"] as Severity[]).includes(f.severity as Severity)
                                            ? (f.severity as Severity)
                                            : "medio",
                                          status: (["pendiente", "en progreso", "resuelto"] as Status[]).includes(f.status as Status)
                                            ? (f.status as Status)
                                            : "pendiente",
                                          date: new Date(f.created_at).toISOString().slice(0, 10),
                                          category: "",
                                          owner: "",
                                        })),
                                      ])
                                    }}
                                  >
                                    Insertar selección
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {sec === "recs" && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Recomendaciones</p>
                            <div className="grid gap-2">
                              {recs.map((r, i) => (
                                <div key={i} className="flex gap-2">
                                  <Input
                                    placeholder={`Recomendación ${i + 1}`}
                                    value={r}
                                    onChange={(e) => {
                                      pushHistory()
                                      setRecs((rs) => {
                                        const copy = [...rs]
                                        copy[i] = e.target.value
                                        return copy
                                      })
                                    }}
                                  />
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      pushHistory()
                                      setRecs((rs) => rs.filter((_, idx) => idx !== i))
                                    }}
                                  >
                                    Quitar
                                  </Button>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  pushHistory()
                                  setRecs((rs) => [...rs, ""])
                                }}
                              >
                                Agregar recomendación
                              </Button>
                            </div>
                          </div>
                        )}
                        {sec === "docs" && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Documentos</p>
                            <input
                              type="file"
                              multiple
                              accept=".pdf,.doc,.docx,.xls,.xlsx"
                              onChange={(e) => {
                                const files = Array.from(e.target.files || [])
                                if (files.length === 0) return
                                pushHistory()
                                const next: DocumentAttachment[] = []
                                files.forEach((file) => {
                                  const name = file.name
                                  const ext = name.split(".").pop()?.toLowerCase() || ""
                                  const type: DocumentAttachment["type"] =
                                    ext === "pdf" ? "pdf" : ext === "doc" || ext === "docx" ? "word" : ext === "xls" || ext === "xlsx" ? "excel" : "other"
                                  const url = URL.createObjectURL(file)
                                  next.push({ name, type, previewUrl: type === "pdf" ? url : null })
                                })
                                setDocs((d) => [...d, ...next])
                              }}
                            />
                            <div className="grid gap-3">
                              {docs.map((d, i) => (
                                <div key={i} className="rounded border p-3">
                                  <p className="text-sm font-medium">{d.name}</p>
                                  <p className="text-xs text-muted-foreground mb-2">Tipo: {d.type.toUpperCase()}</p>
                                  {d.previewUrl ? (
                                    <object data={d.previewUrl} type="application/pdf" className="h-48 w-full" aria-label="PDF preview" />
                                  ) : (
                                    <div className="h-24 w-full rounded bg-muted flex items-center justify-center text-xs">Vista previa no disponible</div>
                                  )}
                                  <div className="mt-2 flex gap-2">
                                    <Button
                                      variant="outline"
                                      onClick={() => {
                                        pushHistory()
                                        setDocs((arr) => arr.filter((_, idx) => idx !== i))
                                      }}
                                    >
                                      Quitar
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {sec === "quotes" && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Citas de Personal</p>
                            <div className="grid gap-2">
                              <Input
                                placeholder="Nombre"
                                value={quoteDraft.name}
                                onChange={(e) => setQuoteDraft((q) => ({ ...q, name: e.target.value }))}
                              />
                              <Input
                                placeholder="Cargo"
                                value={quoteDraft.role}
                                onChange={(e) => setQuoteDraft((q) => ({ ...q, role: e.target.value }))}
                              />
                              <Input
                                type="date"
                                value={quoteDraft.date}
                                onChange={(e) => setQuoteDraft((q) => ({ ...q, date: e.target.value }))}
                              />
                              <textarea
                                className="w-full rounded border bg-background p-2 text-sm"
                                rows={4}
                                placeholder="Contenido de la cita"
                                value={quoteDraft.content}
                                onChange={(e) => setQuoteDraft((q) => ({ ...q, content: e.target.value }))}
                              />
                              <div>
                                <p className="text-xs mb-2">Firma digital</p>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <input
                                    type="color"
                                    value={signaturePenColor}
                                    onChange={(e) => setSignaturePenColor(e.target.value)}
                                  />
                                  <Input
                                    type="number"
                                    value={signaturePenWidth}
                                    onChange={(e) => setSignaturePenWidth(Math.max(1, Number(e.target.value) || 2))}
                                    className="w-24"
                                    placeholder="Grosor"
                                  />
                                </div>
                                <canvas
                                  ref={signatureCanvasRef}
                                  className="h-24 w-full rounded border bg-background"
                                  style={{ touchAction: "none" }}
                                  onPointerDown={(e) => {
                                    e.preventDefault()
                                    const c = e.currentTarget
                                    const rect0 = c.getBoundingClientRect()
                                    const dpr = window.devicePixelRatio || 1
                                    const nextW = Math.max(1, Math.floor(rect0.width * dpr))
                                    const nextH = Math.max(1, Math.floor(rect0.height * dpr))
                                    if (c.width !== nextW || c.height !== nextH) {
                                      c.width = nextW
                                      c.height = nextH
                                    }
                                    const ctx = c.getContext("2d")
                                    if (!ctx) return
                                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
                                    ctx.lineCap = "round"
                                    ctx.lineJoin = "round"

                                    let drawing = true
                                    let lastX = e.clientX - rect0.left
                                    let lastY = e.clientY - rect0.top

                                    const move = (ev: PointerEvent) => {
                                      if (!drawing) return
                                      ev.preventDefault()
                                      const rect = c.getBoundingClientRect()
                                      const x = ev.clientX - rect.left
                                      const y = ev.clientY - rect.top
                                      ctx.strokeStyle = signaturePenColor
                                      ctx.lineWidth = signaturePenWidth
                                      ctx.beginPath()
                                      ctx.moveTo(lastX, lastY)
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
                                <div className="mt-2 flex gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      const c = signatureCanvasRef.current
                                      if (!c) return
                                      setQuoteDraft((q) => ({ ...q, signatureDataUrl: c.toDataURL("image/png") }))
                                    }}
                                  >
                                    Guardar firma
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      const c = signatureCanvasRef.current
                                      if (!c) return
                                      const ctx = c.getContext("2d")
                                      if (!ctx) return
                                      const dpr = window.devicePixelRatio || 1
                                      ctx.setTransform(1, 0, 0, 1, 0, 0)
                                      ctx.clearRect(0, 0, c.width, c.height)
                                      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
                                      setQuoteDraft((q) => ({ ...q, signatureDataUrl: null }))
                                    }}
                                  >
                                    Limpiar
                                  </Button>
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    if (!quoteDraft.name || !quoteDraft.role || !quoteDraft.date || !quoteDraft.content) return
                                    pushHistory()
                                    setQuotes((qs) => [...qs, quoteDraft])
                                    setQuoteDraft({ name: "", role: "", date: new Date().toISOString().slice(0, 10), content: "", signatureDataUrl: null })
                                  }}
                                >
                                  Agregar cita
                                </Button>
                              </div>
                              <div className="grid gap-2">
                                {quotes.map((q, i) => (
                                  <div key={i} className="rounded border p-3">
                                    <p className="text-sm font-medium">{q.name} · {q.role} · {q.date}</p>
                                    <p className="text-sm">{q.content}</p>
                                    {q.signatureDataUrl ? <img src={q.signatureDataUrl} alt="Firma" className="mt-2 max-h-12" /> : null}
                                    <div className="mt-2 flex gap-2">
                                      <Button
                                        variant="outline"
                                        onClick={() => {
                                          pushHistory()
                                          setQuotes((arr) => arr.filter((_, idx) => idx !== i))
                                        }}
                                      >
                                        Quitar
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                         </div>
                        )}
                        </div>
                        )}
                      </div>
                    ))}
                  </div>
                  )}
                  {designerEnabled && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `h1-${Date.now()}`, type: "heading", level: 1, text: "Título", align: "left" }])
                          }}
                        >
                          Agregar H1
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `h2-${Date.now()}`, type: "heading", level: 2, text: "Subtítulo", align: "left" }])
                          }}
                        >
                          Agregar H2
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `text-${Date.now()}`, type: "text", html: "", align: "left" }])
                          }}
                        >
                          Agregar texto
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `plain-text-${Date.now()}`, type: "plain_text", text: "", align: "left" }])
                          }}
                        >
                          Texto simple
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [
                              ...els,
                              { id: `simple-section-${Date.now()}`, type: "simple_section", title: "Sección", subtitle: "", body: "", bullets: [], chips: [], align: "left" },
                            ])
                          }}
                        >
                          Sección de texto
                        </Button>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (!f) return
                            const url = URL.createObjectURL(f)
                            setElements((els) => [...els, { id: `img-${Date.now()}`, type: "image", src: url, alt: f.name, widthPct: 100 }])
                          }}
                        />
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `table-${Date.now()}`, type: "table", rows: [["", ""], ["", ""]] }])
                          }}
                        >
                          Agregar tabla
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `matrix-${Date.now()}`, type: "matrix", rows: matrixRows }])
                          }}
                        >
                          Agregar matriz
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `quote-${Date.now()}`, type: "quote", item: quoteDraft }])
                          }}
                        >
                          Agregar cita
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `docs-${Date.now()}`, type: "docs", items: docs }])
                          }}
                        >
                          Agregar documentos
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setElements((els) => [...els, { id: `div-${Date.now()}`, type: "divider" }])
                          }}
                        >
                          Agregar divisor
                        </Button>
                      </div>
                      <div className="grid gap-3">
                        {elements.map((el, idx) => (
                          <div
                            key={el.id}
                            className="rounded border p-3"
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData("element-index", String(idx))}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              const fromIdx = Number(e.dataTransfer.getData("element-index"))
                              const toIdx = idx
                              if (!Number.isFinite(fromIdx)) return
                              setElements((arr) => {
                                const copy = [...arr]
                                const [moved] = copy.splice(fromIdx, 1)
                                copy.splice(toIdx, 0, moved)
                                return copy
                              })
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">{el.type}</p>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setExpandedElementId((id) => (id === el.id ? null : el.id))
                                  }}
                                >
                                  {expandedElementId === el.id ? "Cerrar" : "Editar"}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setElements((arr) => arr.filter((x) => x.id !== el.id))
                                  }}
                                >
                                  Quitar
                                </Button>
                              </div>
                            </div>
                            {expandedElementId === el.id ? (
                              <div className="mt-2 space-y-2">
                                {el.type === "heading" && (
                                  <div className="grid gap-2">
                                    <select
                                      value={String(el.level)}
                                      onChange={(e) => {
                                        const lvl = Number(e.target.value) as 1 | 2 | 3
                                        setElements((arr) => arr.map((it, i) => (i === idx && it.type === "heading" ? { ...it, level: lvl } : it)))
                                      }}
                                      className="rounded border bg-background px-2 py-1 text-sm"
                                    >
                                      <option value="1">H1</option>
                                      <option value="2">H2</option>
                                      <option value="3">H3</option>
                                    </select>
                                    <Input
                                      placeholder="Texto"
                                      value={el.text}
                                      onChange={(e) => {
                                        setElements((arr) => arr.map((it, i) => (i === idx && it.type === "heading" ? { ...it, text: e.target.value } : it)))
                                      }}
                                    />
                                    <select
                                      value={el.align || "left"}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) =>
                                            i === idx && it.type === "heading" ? { ...it, align: e.target.value as "left" | "center" | "right" } : it,
                                          ),
                                        )
                                      }}
                                      className="rounded border bg-background px-2 py-1 text-sm"
                                    >
                                      <option value="left">Izquierda</option>
                                      <option value="center">Centro</option>
                                      <option value="right">Derecha</option>
                                    </select>
                                  </div>
                                )}
                                {el.type === "text" && (
                                  <div className="grid gap-2">
                                    <textarea
                                      className="w-full rounded border bg-background p-2 text-sm"
                                      rows={6}
                                      value={el.html}
                                      onChange={(e) => {
                                        setElements((arr) => arr.map((it, i) => (i === idx && it.type === "text" ? { ...it, html: e.target.value } : it)))
                                      }}
                                    />
                                    <select
                                      value={el.align || "left"}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) =>
                                            i === idx && it.type === "text" ? { ...it, align: e.target.value as "left" | "center" | "right" } : it,
                                          ),
                                        )
                                      }}
                                      className="rounded border bg-background px-2 py-1 text-sm"
                                    >
                                      <option value="left">Izquierda</option>
                                      <option value="center">Centro</option>
                                      <option value="right">Derecha</option>
                                    </select>
                                  </div>
                                )}
                                {el.type === "plain_text" && (
                                  <div className="grid gap-2">
                                    <textarea
                                      className="w-full rounded border bg-background p-2 text-sm"
                                      rows={6}
                                      value={el.text}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "plain_text" ? { ...it, text: e.target.value } : it)),
                                        )
                                      }}
                                    />
                                    <select
                                      value={el.align || "left"}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) =>
                                            i === idx && it.type === "plain_text" ? { ...it, align: e.target.value as "left" | "center" | "right" } : it,
                                          ),
                                        )
                                      }}
                                      className="rounded border bg-background px-2 py-1 text-sm"
                                    >
                                      <option value="left">Izquierda</option>
                                      <option value="center">Centro</option>
                                      <option value="right">Derecha</option>
                                    </select>
                                  </div>
                                )}
                                {el.type === "simple_section" && (
                                  <div className="grid gap-2">
                                    <Input
                                      placeholder="Título"
                                      value={el.title}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "simple_section" ? { ...it, title: e.target.value } : it)),
                                        )
                                      }}
                                    />
                                    <Input
                                      placeholder="Subtítulo (opcional)"
                                      value={el.subtitle || ""}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "simple_section" ? { ...it, subtitle: e.target.value } : it)),
                                        )
                                      }}
                                    />
                                    <textarea
                                      className="w-full rounded border bg-background p-2 text-sm"
                                      rows={6}
                                      value={el.body}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "simple_section" ? { ...it, body: e.target.value } : it)),
                                        )
                                      }}
                                      placeholder="Texto"
                                    />
                                    <Input
                                      placeholder="Chips (separados por coma)"
                                      value={(el.chips || []).join(", ")}
                                      onChange={(e) => {
                                        const next = e.target.value
                                          .split(",")
                                          .map((s) => s.trim())
                                          .filter(Boolean)
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "simple_section" ? { ...it, chips: next } : it)),
                                        )
                                      }}
                                    />
                                    <textarea
                                      className="w-full rounded border bg-background p-2 text-sm"
                                      rows={4}
                                      value={(el.bullets || []).join("\n")}
                                      onChange={(e) => {
                                        const next = e.target.value
                                          .split("\n")
                                          .map((s) => s.trim())
                                          .filter(Boolean)
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "simple_section" ? { ...it, bullets: next } : it)),
                                        )
                                      }}
                                      placeholder="Bullets (uno por línea)"
                                    />
                                    <select
                                      value={el.align || "left"}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) =>
                                            i === idx && it.type === "simple_section"
                                              ? { ...it, align: e.target.value as "left" | "center" | "right" }
                                              : it,
                                          ),
                                        )
                                      }}
                                      className="rounded border bg-background px-2 py-1 text-sm"
                                    >
                                      <option value="left">Izquierda</option>
                                      <option value="center">Centro</option>
                                      <option value="right">Derecha</option>
                                    </select>
                                  </div>
                                )}
                                {el.type === "image" && (
                                  <div className="grid gap-2">
                                    <Input
                                      placeholder="Texto alternativo"
                                      value={el.alt || ""}
                                      onChange={(e) => {
                                        setElements((arr) => arr.map((it, i) => (i === idx && it.type === "image" ? { ...it, alt: e.target.value } : it)))
                                      }}
                                    />
                                    <Input
                                      type="number"
                                      value={el.widthPct || 100}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) =>
                                            i === idx && it.type === "image" ? { ...it, widthPct: Number(e.target.value) || 100 } : it,
                                          ),
                                        )
                                      }}
                                      className="w-28"
                                      placeholder="Ancho %"
                                    />
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0]
                                        if (!f) return
                                        const url = URL.createObjectURL(f)
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "image" ? { ...it, src: url, alt: f.name } : it)),
                                        )
                                      }}
                                    />
                                  </div>
                                )}
                                {el.type === "table" && (
                                  <div className="space-y-2">
                                    <div className="grid gap-2">
                                      {el.rows.map((row: string[], rIdx: number) => (
                                        <div key={rIdx} className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2">
                                          {row.map((cell: string, cIdx: number) => (
                                            <Input
                                              key={cIdx}
                                              value={cell}
                                              onChange={(e) => {
                                                const nextRows = el.rows.map((rr, ri) =>
                                                  ri === rIdx ? rr.map((cc, ci) => (ci === cIdx ? e.target.value : cc)) : rr,
                                                )
                                                setElements((arr) => arr.map((it, i) => (i === idx && it.type === "table" ? { ...it, rows: nextRows } : it)))
                                              }}
                                            />
                                          ))}
                                        </div>
                                      ))}
                                    </div>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        onClick={() => {
                                          const cols = el.rows[0]?.length || 2
                                          const nextRows = [...el.rows, Array(cols).fill("")]
                                          setElements((arr) => arr.map((it, i) => (i === idx && it.type === "table" ? { ...it, rows: nextRows } : it)))
                                        }}
                                      >
                                        Agregar fila
                                      </Button>
                                      <Button
                                        variant="outline"
                                        onClick={() => {
                                          const nextRows = el.rows.map((r) => [...r, ""])
                                          setElements((arr) => arr.map((it, i) => (i === idx && it.type === "table" ? { ...it, rows: nextRows } : it)))
                                        }}
                                      >
                                        Agregar columna
                                      </Button>
                                    </div>
                                  </div>
                                )}
                                {el.type === "matrix" && (
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      onClick={() => {
                                        setElements((arr) => arr.map((it, i) => (i === idx && it.type === "matrix" ? { ...it, rows: matrixRows } : it)))
                                      }}
                                    >
                                      Actualizar con matriz actual
                                    </Button>
                                  </div>
                                )}
                                {el.type === "quote" && (
                                  <div className="grid gap-2">
                                    <Input
                                      placeholder="Nombre"
                                      value={el.item.name}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "quote" ? { ...it, item: { ...it.item, name: e.target.value } } : it)),
                                        )
                                      }}
                                    />
                                    <Input
                                      placeholder="Cargo"
                                      value={el.item.role}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "quote" ? { ...it, item: { ...it.item, role: e.target.value } } : it)),
                                        )
                                      }}
                                    />
                                    <Input
                                      type="date"
                                      value={el.item.date}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) => (i === idx && it.type === "quote" ? { ...it, item: { ...it.item, date: e.target.value } } : it)),
                                        )
                                      }}
                                    />
                                    <textarea
                                      className="w-full rounded border bg-background p-2 text-sm"
                                      rows={4}
                                      value={el.item.content}
                                      onChange={(e) => {
                                        setElements((arr) =>
                                          arr.map((it, i) =>
                                            i === idx && it.type === "quote" ? { ...it, item: { ...it.item, content: e.target.value } } : it,
                                          ),
                                        )
                                      }}
                                    />
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0]
                                        if (!f) return
                                        const url = URL.createObjectURL(f)
                                        setElements((arr) =>
                                          arr.map((it, i) =>
                                            i === idx && it.type === "quote"
                                              ? { ...it, item: { ...it.item, signatureDataUrl: url } }
                                              : it,
                                          ),
                                        )
                                      }}
                                    />
                                  </div>
                                )}
                                {el.type === "docs" && (
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      onClick={() => {
                                        setElements((arr) => arr.map((it, i) => (i === idx && it.type === "docs" ? { ...it, items: docs } : it)))
                                      }}
                                    >
                                      Actualizar con documentos actuales
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-2">
                                {el.type === "heading" && <div className="text-sm">{el.text}</div>}
                                {el.type === "text" && <div className="text-sm" dangerouslySetInnerHTML={{ __html: el.html }} />}
                                {el.type === "plain_text" && <div className="text-sm whitespace-pre-wrap">{el.text}</div>}
                                {el.type === "simple_section" && (
                                  <div className="space-y-1">
                                    <div className="text-sm font-medium">{el.title}</div>
                                    {Array.isArray(el.chips) && el.chips.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {el.chips.slice(0, 6).map((c, i) => (
                                          <Badge key={i} variant="secondary">{c}</Badge>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                                {el.type === "image" && <img src={el.src} alt={el.alt || ""} className="max-h-36" />}
                                {el.type === "table" && (
                                  <table className="w-full border-collapse">
                                    <tbody>
                                      {el.type === "table" &&
                                        el.rows.map((row: string[], rIdx: number) => (
                                          <tr key={rIdx}>
                                            {row.map((cell: string, cIdx: number) => (
                                              <td key={cIdx} className="border px-2 py-1 text-sm">{cell}</td>
                                            ))}
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                )}
                                {el.type === "matrix" && <div className="text-xs text-muted-foreground">{el.rows.length} filas</div>}
                                {el.type === "quote" && <div className="text-sm">{el.item.name} · {el.item.role}</div>}
                                {el.type === "docs" && <div className="text-xs text-muted-foreground">{el.items?.length || 0} documentos</div>}
                                {el.type === "divider" && <hr />}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="rounded border p-3">
                    <p className="mb-2 text-sm font-medium">Previsualización</p>
                    <div
                      className="max-h-[60vh] overflow-auto rounded border"
                      dangerouslySetInnerHTML={{ __html: buildEditorHtml() }}
                    />
                  </div>
                </div>
              </div>
              {editorAlerts.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{editorAlerts.join(" · ")}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  onClick={() => {
                    if (!validateEditor()) return
                    const w = window.open("", "_blank")
                    if (!w) return
                    const html = buildEditorHtml() 
                    w.document.write(html.replace("</body></html>", `<script>setTimeout(function(){window.print()},100)</script></body></html>`))
                    w.document.close()
                  }}
                >
                  Exportar PDF
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!validateEditor()) return
                    const html = buildEditorHtml()
                    const blob = new Blob([html], { type: "application/msword" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = `${coverTitle || "informe"}.doc`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Exportar Word
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        

        <TabsContent value="history">
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Versiones del Editor PDF</CardTitle>
                  <CardDescription>Guardados locales en este navegador</CardDescription>
                </div>
                <Button variant="outline" onClick={() => saveEditorVersion()}>
                  Guardar versión
                </Button>
              </CardHeader>
              <CardContent>
                {editorVersions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-6">
                    No hay versiones guardadas aún.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {[...editorVersions].reverse().map((v) => (
                      <div key={v.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{v.coverTitle || "Documento"}</p>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <span>{new Date(v.date).toLocaleString("es-CL")}</span>
                            {v.designerEnabled ? <Badge variant="outline">Diseñador</Badge> : <Badge variant="outline">Secciones</Badge>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => loadEditorVersion(v)}>
                            Cargar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => deleteEditorVersion(v.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Informes Generados</CardTitle>
                <CardDescription>Historial de informes generados y manuales</CardDescription>
              </CardHeader>
              <CardContent>
                {generatedReports.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No hay informes aun. Crea o genera tu primer informe.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {generatedReports.map((report) => (
                      <div
                        key={report.id}
                        className="flex items-center justify-between rounded-lg border border-border p-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">{report.title}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Badge variant="outline">{report.report_type}</Badge>
                              <span>
                                {formatDate(report.date_from)} - {formatDate(report.date_to)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-success text-success-foreground">
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Generado
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              startTransition(async () => {
                                try {
                                  const full = await getReportById(report.id)
                                  let content = ""
                                  try {
                                    content =
                                      typeof full?.content === "string"
                                        ? JSON.parse(full.content).markdown
                                        : full?.content?.markdown || ""
                                  } catch {
                                    content = ""
                                  }
                                  setViewingReport({ title: full?.title || report.title, content })
                                  setViewingId(report.id)
                                  setEditTitle(full?.title || report.title)
                                  setEditContent(content)
                                  setIsViewOpen(true)
                                } catch {
                                  setError("No se pudo cargar el informe")
                                }
                              })
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Ver
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              startTransition(async () => {
                                try {
                                  const full = await getReportById(report.id)
                                  let content = ""
                                  try {
                                    content =
                                      typeof full?.content === "string"
                                        ? JSON.parse(full.content).markdown
                                        : full?.content?.markdown || ""
                                  } catch {
                                    content = ""
                                  }
                                  const blob = new Blob([content || ""], { type: "text/markdown" })
                                  const url = URL.createObjectURL(blob)
                                  const a = document.createElement("a")
                                  a.href = url
                                  a.download = `${full?.title || report.title || "informe"}.md`
                                  a.click()
                                  URL.revokeObjectURL(url)
                                } catch {
                                  setError("No se pudo descargar el informe")
                                }
                              })
                            }}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Descargar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
