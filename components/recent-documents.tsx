"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileText, ImageIcon, File } from "lucide-react"

const documents = [
  {
    id: 1,
    name: "Licencia conducir - J. Pérez",
    type: "pdf",
    status: "procesado",
    date: "Hace 2 horas",
  },
  {
    id: 2,
    name: "Certificado altura - M. González",
    type: "image",
    status: "procesando",
    date: "Hace 4 horas",
  },
  {
    id: 3,
    name: "Examen médico - R. Silva",
    type: "pdf",
    status: "procesado",
    date: "Hace 1 día",
  },
  {
    id: 4,
    name: "Charla seguridad - Grupo A",
    type: "pdf",
    status: "procesado",
    date: "Hace 2 días",
  },
]

const typeIcons = {
  pdf: FileText,
  image: ImageIcon,
  other: File,
}

export function RecentDocuments() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos Recientes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {documents.map((doc) => {
            const Icon = typeIcons[doc.type as keyof typeof typeIcons] || File
            return (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{doc.name}</p>
                    <p className="text-sm text-muted-foreground">{doc.date}</p>
                  </div>
                </div>
                <Badge
                  variant={doc.status === "procesado" ? "default" : "secondary"}
                  className={doc.status === "procesado" ? "bg-success text-success-foreground" : ""}
                >
                  {doc.status === "procesado" ? "Procesado" : "Procesando..."}
                </Badge>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
