"use client"

import { useEffect, useState, useTransition } from "react"
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
} from "lucide-react"
import { getReportData, generateAIReport, getReportById, createManualReport, updateReport } from "@/app/actions/reports"
import { getFindings } from "@/app/actions/findings"
import { Input } from "@/components/ui/input"
import ReactMarkdown from "react-markdown"

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
      } catch {}
    })()
    return () => {
      mounted = false
    }
  }, [])

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
                const text = viewingReport?.content || editContent || ""
                const meta = generatedReports.find((r) => r.id === viewingId)
                const body = toHtml(text, meta)
                const html = `<!doctype html><html><head><meta charset=\"utf-8\"><title>${viewingReport?.title || editTitle || "informe"}</title><style>body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:40px;line-height:1.7;color:#111827}img{display:block;margin:8px 0;max-width:100%;height:auto}h1{font-size:22px;margin:16px 0 8px}h2{font-size:18px;margin:12px 0 6px}h3{font-size:16px;margin:8px 0 4px}@page{size:A4;margin:20mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}</body></html>`
                const blob = new Blob([html], { type: "text/html" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `${viewingReport?.title || editTitle || "informe"}.html`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Descargar HTML
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

      <Tabs defaultValue="ai" className="space-y-6">
        <TabsList>
          <TabsTrigger value="ai">Generar con IA</TabsTrigger>
          <TabsTrigger value="manual">Crear Manual</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Periodo del Informe
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Seleccionar periodo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Esta semana</SelectItem>
                    <SelectItem value="last-week">Semana pasada</SelectItem>
                    <SelectItem value="monthly">Este mes</SelectItem>
                    <SelectItem value="last-month">Mes pasado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {reportTemplates.map((template) => (
              <Card key={template.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <FileBarChart className="h-5 w-5 text-primary" />
                      <CardTitle>{template.title}</CardTitle>
                    </div>
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      IA
                    </Badge>
                  </div>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <p className="mb-2 text-sm font-medium text-muted-foreground">Secciones incluidas:</p>
                    <div className="flex flex-wrap gap-2">
                      {template.sections.map((section) => (
                        <Badge key={section} variant="outline">
                          {section}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => handleGenerate(template.id)}
                    disabled={generating === template.id || isPending}
                  >
                    {generating === template.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generando con IA...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generar Informe
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="manual" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Nuevo Informe Manual</CardTitle>
              <CardDescription>Redacta y guarda un informe personalizado</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm">Titulo</p>
                  <Input value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="Titulo del informe" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm">Desde</p>
                  <Input type="date" value={manualDateFrom} onChange={(e) => setManualDateFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <p className="text-sm">Hasta</p>
                  <Input type="date" value={manualDateTo} onChange={(e) => setManualDateTo(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm">Contenido (Markdown)</p>
                <textarea
                  className="w-full rounded-md border border-input bg-background p-2 text-sm"
                  rows={16}
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  placeholder="# Informe\n\nContenido..."
                />
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Adjuntar hallazgos</p>
                  <div className="flex gap-2">
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
                      {findingsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Buscar hallazgos
                    </Button>
                    <Input
                      placeholder="Buscar por #ID o texto"
                      value={findingsQuery}
                      onChange={(e) => setFindingsQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  {findingsList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay hallazgos cargados</p>
                  ) : (
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
                        .slice(0, 10)
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
                                    setSelectedFindingIds((prev) =>
                                      checked ? prev.filter((id) => id !== f.id) : [...prev, f.id],
                                    )
                                  }}
                                >
                                  {checked ? "Quitar" : "Agregar"}
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={selectedFindingIds.length === 0}
                    onClick={() => {
                      const selected = findingsList.filter((f) => selectedFindingIds.includes(f.id))
                      const blocks = selected.map((f) => {
                        const lines = [
                          `### Hallazgo #${f.id} - ${f.title}`,
                          `- Severidad: ${f.severity}`,
                          `- Estado: ${f.status}`,
                          `- Ubicacion: ${f.location || "-"}`,
                          `- Fecha: ${formatDate(f.created_at)}`,
                          f.description ? `\n${f.description}` : "",
                          Array.isArray(f.photos) && f.photos.length
                            ? `\n${f.photos
                                .slice(0, 3)
                                .map((_, i) => `![Hallazgo #${f.id} Foto ${i + 1}](/api/findings/photo?id=${f.id}&index=${i})`)
                                .join("\n")}`
                            : "",
                        ]
                        return lines.filter(Boolean).join("\n")
                      })
                      const merged = `${manualContent}\n\n${blocks.join("\n\n")}`.trim()
                      setManualContent(merged)
                    }}
                  >
                    Insertar selección
                  </Button>
                  <Button
                    variant="outline"
                    disabled={selectedFindingIds.length === 0}
                    onClick={() => {
                      const idsStr = selectedFindingIds.map((id) => `#${id}`).join(", ")
                      const merged = `${manualContent}\n\nIncidentes seleccionados: ${idsStr}`.trim()
                      setManualContent(merged)
                    }}
                  >
                    Insertar números de incidentes
                  </Button>
                  <Button
                    variant="outline"
                    disabled={selectedFindingIds.length === 0}
                    onClick={() => {
                      const total = selectedFindingIds.length
                      const merged = `${manualContent}\n\nTotal de incidentes seleccionados: ${total}`.trim()
                      setManualContent(merged)
                    }}
                  >
                    Insertar conteo de incidentes
                  </Button>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  disabled={savingManual || !manualTitle || !manualDateFrom || !manualDateTo || !manualContent}
                  onClick={() => {
                    setSavingManual(true)
                    startTransition(async () => {
                      try {
                        const id = await createManualReport(manualTitle, manualDateFrom, manualDateTo, manualContent, projectId)
                        if (id) {
                          const newReport: GeneratedReport = {
                            id,
                            report_type: "manual",
                            title: manualTitle,
                            date_from: manualDateFrom,
                            date_to: manualDateTo,
                            created_at: new Date().toISOString(),
                          }
                          setGeneratedReports((prev) => [newReport, ...prev])
                          setViewingReport({ title: manualTitle, content: manualContent })
                          setViewingId(id)
                          setEditTitle(manualTitle)
                          setEditContent(manualContent)
                          setIsViewOpen(true)
                          setIsEditing(false)
                          setManualTitle("")
                          setManualDateFrom("")
                          setManualDateTo("")
                          setManualContent("")
                        } else {
                          setError("No se pudo crear el informe")
                        }
                      } catch {
                        setError("No se pudo crear el informe")
                      } finally {
                        setSavingManual(false)
                      }
                    })
                  }}
                >
                  {savingManual ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Guardar Informe
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
