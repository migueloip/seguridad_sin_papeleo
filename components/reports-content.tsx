"use client"

import { useState, useTransition } from "react"
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
import { getReportData, generateAIReport, getReportById } from "@/app/actions/reports"
import ReactMarkdown from "react-markdown"

interface GeneratedReport {
  id: number
  report_type: string
  title: string
  date_from: string
  date_to: string
  created_at: string
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
}

export function ReportsContent({ initialReports = [] }: ReportsContentProps) {
  const [generating, setGenerating] = useState<string | null>(null)
  const [period, setPeriod] = useState("weekly")
  const [isPending, startTransition] = useTransition()
  const [generatedReports, setGeneratedReports] = useState<GeneratedReport[]>(initialReports)
  const [error, setError] = useState<string | null>(null)
  const [viewingReport, setViewingReport] = useState<{ title: string; content: string } | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)

  const handleGenerate = async (templateId: string) => {
    setGenerating(templateId)
    setError(null)

    startTransition(async () => {
      try {
        // Obtener datos del periodo
        const data = await getReportData(period)

        // Generar informe con IA
        const result = await generateAIReport(templateId, data)

        // Mostrar el informe generado
        setViewingReport(result)
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

      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewingReport?.title}</DialogTitle>
          </DialogHeader>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {viewingReport && <ReactMarkdown>{viewingReport.content}</ReactMarkdown>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsViewOpen(false)}>
              Cerrar
            </Button>
            <Button
              onClick={() => {
                // Crear blob y descargar
                const blob = new Blob([viewingReport?.content || ""], { type: "text/markdown" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = `${viewingReport?.title || "informe"}.md`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Descargar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="generate" className="space-y-6">
        <TabsList>
          <TabsTrigger value="generate">Generar Informe</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6">
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

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Informes Generados</CardTitle>
              <CardDescription>Historial de informes generados por el sistema</CardDescription>
            </CardHeader>
            <CardContent>
              {generatedReports.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No hay informes generados aun. Genera tu primer informe en la pestaña Generar Informe.
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
