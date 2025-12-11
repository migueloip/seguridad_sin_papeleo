import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileCheck, AlertTriangle, Clock, Users } from "lucide-react"

interface KpiCardsProps {
  documents: { valid: number; expiring: number; expired: number }
  findings: { open: number; in_progress: number; resolved: number }
  workers: number
}

export function KpiCards({ documents, findings, workers }: KpiCardsProps) {
  const totalDocs = Number(documents.valid) + Number(documents.expiring) + Number(documents.expired)
  const openFindings = Number(findings.open) + Number(findings.in_progress)

  const kpis = [
    {
      title: "Documentos Vigentes",
      value: documents.valid.toString(),
      subtitle: `${documents.expiring} por vencer`,
      icon: FileCheck,
      color: "text-success",
    },
    {
      title: "Hallazgos Abiertos",
      value: openFindings.toString(),
      subtitle: `${findings.resolved} resueltos`,
      icon: AlertTriangle,
      color: openFindings > 0 ? "text-warning" : "text-success",
    },
    {
      title: "Docs por Vencer",
      value: documents.expiring.toString(),
      subtitle: `${documents.expired} vencidos`,
      icon: Clock,
      color: Number(documents.expiring) > 0 ? "text-warning" : "text-muted-foreground",
    },
    {
      title: "Personal Activo",
      value: workers.toString(),
      subtitle: `${totalDocs} documentos`,
      icon: Users,
      color: "text-primary",
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <Card key={kpi.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
            <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{kpi.value}</div>
            <p className="text-xs text-muted-foreground">{kpi.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
