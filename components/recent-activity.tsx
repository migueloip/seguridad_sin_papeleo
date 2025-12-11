"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Upload, ClipboardCheck, AlertTriangle, FileCheck } from "lucide-react"

const activities = [
  {
    id: 1,
    action: "Documento subido",
    description: "Licencia conducir - J. Pérez",
    user: "Juan Martínez",
    time: "Hace 10 min",
    icon: Upload,
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
  },
  {
    id: 2,
    action: "Checklist completado",
    description: "Inspección diaria - Sector A",
    user: "María López",
    time: "Hace 1 hora",
    icon: ClipboardCheck,
    iconBg: "bg-success/10",
    iconColor: "text-success",
  },
  {
    id: 3,
    action: "Hallazgo reportado",
    description: "Falta señalización en zona de carga",
    user: "Carlos Ruiz",
    time: "Hace 2 horas",
    icon: AlertTriangle,
    iconBg: "bg-warning/10",
    iconColor: "text-warning",
  },
  {
    id: 4,
    action: "Informe generado",
    description: "Reporte semanal de seguridad",
    user: "Sistema",
    time: "Hace 3 horas",
    icon: FileCheck,
    iconBg: "bg-accent/10",
    iconColor: "text-accent",
  },
]

export function RecentActivity() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actividad Reciente</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${activity.iconBg}`}>
                <activity.icon className={`h-5 w-5 ${activity.iconColor}`} />
              </div>
              <div className="flex-1">
                <p className="font-medium">{activity.action}</p>
                <p className="text-sm text-muted-foreground">{activity.description}</p>
                <p className="text-xs text-muted-foreground">
                  {activity.user} · {activity.time}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
