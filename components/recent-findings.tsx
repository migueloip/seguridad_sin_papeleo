import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, MapPin } from "lucide-react"
import Link from "next/link"

interface Finding {
  id: number
  title: string
  severity: string
  status: string
  project_name: string
  created_at: string
}

export function RecentFindings({ findings }: { findings: Finding[] }) {
  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return <Badge variant="destructive">Crítico</Badge>
      case "high":
        return <Badge className="bg-destructive/80 text-destructive-foreground">Alto</Badge>
      case "medium":
        return <Badge className="bg-warning text-warning-foreground">Medio</Badge>
      default:
        return <Badge variant="secondary">Bajo</Badge>
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge variant="outline" className="border-destructive text-destructive">
            Abierto
          </Badge>
        )
      case "in_progress":
        return (
          <Badge variant="outline" className="border-warning text-warning">
            En Proceso
          </Badge>
        )
      default:
        return <Badge className="bg-success text-success-foreground">Resuelto</Badge>
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "short",
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Hallazgos Recientes
        </CardTitle>
        <Link href="/hallazgos" className="text-sm text-primary hover:underline">
          Ver todos
        </Link>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {findings.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No hay hallazgos pendientes</p>
          ) : (
            findings.map((finding) => (
              <div
                key={finding.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground">#{finding.id}</span>
                    {getSeverityBadge(finding.severity)}
                    {getStatusBadge(finding.status)}
                  </div>
                  <p className="font-medium truncate">{finding.title}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin className="h-3 w-3" />
                    {finding.project_name || "Sin proyecto"}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(finding.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
