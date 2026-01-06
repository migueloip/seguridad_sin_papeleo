"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, GripVertical, Trash2, History, Loader2, Sparkles, FileText, ArrowUp, ArrowDown } from "lucide-react"
import type { DesignerElement, EditorState, MatrixRow, PageSize, Severity, Status } from "@/lib/pdf-editor"
import { buildDesignerHtmlFromState, buildEditorHtmlFromState, validateEditorState } from "@/lib/pdf-editor"
import { fillPdfDesignerWithAI, fillMatrixWithAI } from "@/app/actions/reports"
import { getWorkers } from "@/app/actions/workers"
import { createDocument, getDocumentTypes } from "@/app/actions/documents"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { AiReportChat } from "@/components/ai-report-chat"

interface ReportsContentProps {
  initialReports?: unknown[]
  projectId?: number
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const defaultRow = (): MatrixRow => ({
  description: "",
  category: "",
  owner: "",
  severity: "medio",
  status: "pendiente",
  date: todayIso(),
})

export function ReportsContent({ initialReports, projectId }: ReportsContentProps) {
  void initialReports

  const router = useRouter()
  const [mode, setMode] = useState<"designer" | "ai-chat">("designer")
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
  const [elements, setElements] = useState<DesignerElement[]>([])
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [isBoardCollapsed, setIsBoardCollapsed] = useState(false)

  const [isSignatureOpen, setIsSignatureOpen] = useState(false)
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null)

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
      const data = ev.data as { type?: string; elementId?: string }
      if (!data || data.type !== "REPORT_DESIGNER_SELECT") return
      if (!data.elementId) return
      setSelectedElementId(data.elementId)
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

  const addElement = (el: DesignerElement) => {
    setElements((arr) => [...arr, el])
    setSelectedElementId(el.id)
  }

  const updateElement = (id: string, updater: (prev: DesignerElement) => DesignerElement) => {
    setElements((arr) => arr.map((e) => (e.id === id ? updater(e) : e)))
  }

  const deleteElement = (id: string) => {
    setElements((arr) => arr.filter((e) => e.id !== id))
    setSelectedElementId((sel) => (sel === id ? null : sel))
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Editor de PDF</h1>
        <p className="text-muted-foreground">Crea informes manualmente o con ayuda de IA</p>
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

        <Tabs value={mode} onValueChange={(v) => setMode(v as "designer" | "ai-chat")} className="space-y-6">
          <TabsList>
            <TabsTrigger value="designer">Diseñador</TabsTrigger>
            <TabsTrigger value="ai-chat">Editor IA</TabsTrigger>
          </TabsList>

          <TabsContent value="designer" className="space-y-6">
            <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1.4fr)_310px]">
              <Card>
                <CardHeader>
                  <CardTitle>Componentes</CardTitle>
                  <CardDescription>Agrega y arrastra para ordenar</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Documento</div>
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
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Plantillas rápidas</div>
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
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Agregar</div>
                    <div className="grid gap-1 sm:grid-cols-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `h1-${Date.now()}`, type: "heading", level: 1, text: "Título", align: "left" })}
                      >
                        Encabezado H1
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `h2-${Date.now()}`, type: "heading", level: 2, text: "Subtítulo", align: "left" })}
                      >
                        Encabezado H2
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `pt-${Date.now()}`, type: "plain_text", text: "Texto", align: "left" })}
                      >
                        Texto
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() =>
                          addElement({
                            id: `sec-${Date.now()}`,
                            type: "simple_section",
                            title: "Sección",
                            subtitle: null,
                            body: "",
                            bullets: [],
                            chips: [],
                            align: "left",
                          })
                        }
                      >
                        Sección
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `ls-${Date.now()}`, type: "list", ordered: false, items: ["Item 1", "Item 2"], align: "left" })}
                      >
                        Lista
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `img-${Date.now()}`, type: "image", src: "", alt: "", widthPct: 100 })}
                      >
                        Imagen
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `mx-${Date.now()}`, type: "matrix", rows: matrixRows })}
                      >
                        Matriz (desde formulario)
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => {
                          const items = recsText
                            .split("\n")
                            .map((r) => r.trim())
                            .filter((r) => r.length > 0)
                          addElement({ id: `rec-${Date.now()}`, type: "list", ordered: true, items, align: "left" })
                        }}
                      >
                        Recomendaciones (desde formulario)
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `hr-${Date.now()}`, type: "divider" })}
                      >
                        Separador
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs break-words justify-start"
                        onClick={() => addElement({ id: `pb-${Date.now()}`, type: "page_break" })}
                      >
                        Salto de página
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Previsualización</CardTitle>
                  <CardDescription>Vista previa del HTML que se exporta</CardDescription>
                </CardHeader>
                <CardContent>
                  <iframe className="h-[70vh] w-full rounded-md border" srcDoc={previewHtml} />
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Propiedades</CardTitle>
                    <CardDescription>Edita el componente seleccionado</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedElement ? (
                      <>
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
                            <div className="text-sm font-medium">URL</div>
                            <Input
                              value={selectedElement.src}
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

                        {selectedElement.type === "matrix" ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Matriz</div>
                            <div className="text-sm text-muted-foreground">
                              {selectedElement.rows.length} filas
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setEditingMatrixElementId(selectedElement.id)
                                  setMatrixElementDraftRows(selectedElement.rows || [])
                                  setIsMatrixElementDialogOpen(true)
                                }}
                              >
                                Editar matriz
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">Selecciona un componente en la pizarra.</div>
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

                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Sparkles className="h-4 w-4" />
                          <span>IA del informe</span>
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
                          variant="secondary"
                          size="sm"
                          onClick={handleFillWithAI}
                          disabled={isAiPending}
                          className="flex items-center gap-2"
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

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button onClick={exportPdf}>Exportar PDF</Button>
                      <Button variant="secondary" onClick={exportWord}>
                        Exportar Word
                      </Button>
                      <Button variant="outline" onClick={handleOpenSaveDialog} className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Guardar en Documentos
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Pizarra</CardTitle>
                    <CardDescription>Arrastra para reordenar el contenido</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {elements.length === 0 ? (
                      <div className="rounded-md border p-4 text-sm text-muted-foreground">
                        Agrega un componente o usa “Cargar plantilla básica”.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {elements.map((el) => {
                          const isSelected = el.id === selectedElementId
                          const label =
                            el.type === "heading"
                              ? `Heading H${el.level}`
                              : el.type === "plain_text"
                                ? "Texto"
                                : el.type === "text"
                                  ? "HTML"
                                  : el.type === "simple_section"
                                    ? "Sección"
                                    : el.type === "list"
                                      ? "Lista"
                                      : el.type === "image"
                                        ? "Imagen"
                                        : el.type === "matrix"
                                          ? "Matriz"
                                          : el.type === "divider"
                                            ? "Separador"
                                            : el.type === "page_break"
                                              ? "Salto de página"
                                              : el.type === "quote"
                                                ? "Cita"
                                                : "Documento"
                          return (
                            <div
                              key={el.id}
                              className={`flex items-center justify-between gap-3 rounded-md border p-3 ${isSelected ? "border-primary" : ""}`}
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
                              onClick={() => setSelectedElementId(el.id)}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">{label}</div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {el.type === "heading"
                                      ? el.text
                                      : el.type === "plain_text"
                                        ? el.text
                                        : el.type === "simple_section"
                                          ? el.title
                                          : el.type === "list"
                                            ? `${el.items.length} items`
                                            : el.type === "image"
                                              ? el.src || "(sin URL)"
                                              : ""}
                                  </div>
                                </div>
                              </div>
                              <Button
                                variant="destructive"
                                size="icon-sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  deleteElement(el.id)
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="ai-chat">
            <div className="h-[calc(100vh-12rem)] overflow-hidden rounded-lg border">
              <PanelGroup direction="horizontal">
                <Panel defaultSize={30} minSize={20}>
                  <div className="h-full overflow-hidden">
                    <AiReportChat projectId={projectId} onAddElement={addElement} />
                  </div>
                </Panel>
                <PanelResizeHandle className="w-1 bg-border" />
                <Panel defaultSize={70}>
                  <div className="h-full overflow-auto bg-muted/20 p-8">
                    <div className="mx-auto bg-white shadow-sm" style={{ width: "210mm", minHeight: "297mm", padding: "20mm" }}>
                      <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                  </div>
                </Panel>
              </PanelGroup>
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Guardar informe en Documentos</DialogTitle>
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
