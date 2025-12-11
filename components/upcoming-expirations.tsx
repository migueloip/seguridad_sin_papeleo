import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Clock } from "lucide-react"

interface Expiration {
  id: number
  first_name: string
  last_name: string
  document_type: string
  expiry_date: string
}

export function UpcomingExpirations({ expirations }: { expirations: Expiration[] }) {
  const getDaysLeft = (expiryDate: string) => {
    const today = new Date()
    const expiry = new Date(expiryDate)
    const diffTime = expiry.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  const getStatus = (daysLeft: number) => {
    if (daysLeft <= 7) return "critical"
    if (daysLeft <= 15) return "warning"
    return "normal"
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Próximos Vencimientos
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {expirations.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No hay documentos por vencer</p>
          ) : (
            expirations.map((item) => {
              const daysLeft = getDaysLeft(item.expiry_date)
              const status = getStatus(daysLeft)

              return (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    {status === "critical" && <AlertCircle className="h-5 w-5 text-destructive" />}
                    {status === "warning" && <AlertCircle className="h-5 w-5 text-warning" />}
                    {status === "normal" && <Clock className="h-5 w-5 text-muted-foreground" />}
                    <div>
                      <p className="font-medium">{item.document_type}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.first_name} {item.last_name}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={status === "critical" ? "destructive" : status === "warning" ? "secondary" : "outline"}
                  >
                    {daysLeft} días
                  </Badge>
                </div>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}
