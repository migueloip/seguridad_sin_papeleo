"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Plus, ClipboardCheck, Clock, CheckCircle, AlertTriangle, Camera } from "lucide-react"

interface ChecklistItem {
  id: string
  text: string
  checked: boolean
  hasIssue: boolean
  note?: string
}

interface Checklist {
  id: string
  title: string
  sector: string
  status: "pendiente" | "en-progreso" | "completado"
  items: ChecklistItem[]
  completedAt?: string
}

const initialChecklists: Checklist[] = [
  {
    id: "1",
    title: "Inspección Diaria",
    sector: "Sector A - Edificio Principal",
    status: "pendiente",
    items: [
      { id: "1-1", text: "EPP completo para todos los trabajadores", checked: false, hasIssue: false },
      { id: "1-2", text: "Señalización de seguridad visible", checked: false, hasIssue: false },
      { id: "1-3", text: "Extintores en buen estado", checked: false, hasIssue: false },
      { id: "1-4", text: "Orden y limpieza en área de trabajo", checked: false, hasIssue: false },
      { id: "1-5", text: "Escaleras y andamios asegurados", checked: false, hasIssue: false },
    ],
  },
  {
    id: "2",
    title: "Revisión de Equipos",
    sector: "Zona de Maquinaria",
    status: "en-progreso",
    items: [
      { id: "2-1", text: "Grúa con certificación vigente", checked: true, hasIssue: false },
      { id: "2-2", text: "Sistemas de freno operativos", checked: true, hasIssue: false },
      {
        id: "2-3",
        text: "Alarmas de retroceso funcionando",
        checked: false,
        hasIssue: true,
        note: "Alarma de retroexcavadora sin sonido",
      },
      { id: "2-4", text: "Cabinas con vidrios limpios", checked: false, hasIssue: false },
    ],
  },
  {
    id: "3",
    title: "Control de Accesos",
    sector: "Perímetro",
    status: "completado",
    completedAt: "Hoy a las 09:30",
    items: [
      { id: "3-1", text: "Cerco perimetral sin daños", checked: true, hasIssue: false },
      { id: "3-2", text: "Control de ingreso funcionando", checked: true, hasIssue: false },
      { id: "3-3", text: "Registro de visitas al día", checked: true, hasIssue: false },
    ],
  },
]

export function ChecklistsContent() {
  const [checklists, setChecklists] = useState<Checklist[]>(initialChecklists)
  const [activeChecklist, setActiveChecklist] = useState<Checklist | null>(null)

  const toggleItem = (checklistId: string, itemId: string) => {
    setChecklists((prev) =>
      prev.map((cl) =>
        cl.id === checklistId
          ? {
              ...cl,
              status: "en-progreso",
              items: cl.items.map((item) => (item.id === itemId ? { ...item, checked: !item.checked } : item)),
            }
          : cl,
      ),
    )
    if (activeChecklist?.id === checklistId) {
      setActiveChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) => (item.id === itemId ? { ...item, checked: !item.checked } : item)),
            }
          : null,
      )
    }
  }

  const toggleIssue = (checklistId: string, itemId: string) => {
    setChecklists((prev) =>
      prev.map((cl) =>
        cl.id === checklistId
          ? {
              ...cl,
              items: cl.items.map((item) => (item.id === itemId ? { ...item, hasIssue: !item.hasIssue } : item)),
            }
          : cl,
      ),
    )
    if (activeChecklist?.id === checklistId) {
      setActiveChecklist((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) => (item.id === itemId ? { ...item, hasIssue: !item.hasIssue } : item)),
            }
          : null,
      )
    }
  }

  const completeChecklist = (checklistId: string) => {
    const now = new Date()
    const timeString = `Hoy a las ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
    setChecklists((prev) =>
      prev.map((cl) => (cl.id === checklistId ? { ...cl, status: "completado", completedAt: timeString } : cl)),
    )
    setActiveChecklist(null)
  }

  const getStatusBadge = (status: Checklist["status"]) => {
    switch (status) {
      case "pendiente":
        return <Badge variant="secondary">Pendiente</Badge>
      case "en-progreso":
        return <Badge className="bg-warning text-warning-foreground">En Progreso</Badge>
      case "completado":
        return <Badge className="bg-success text-success-foreground">Completado</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Checklists</h1>
          <p className="text-muted-foreground">Gestiona y completa inspecciones de seguridad</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Checklist
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {checklists.map((checklist) => (
          <Card key={checklist.id} className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">{checklist.title}</CardTitle>
                </div>
                {getStatusBadge(checklist.status)}
              </div>
              <CardDescription>{checklist.sector}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 space-y-2">
                {checklist.items.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm">
                    {item.checked ? (
                      <CheckCircle className="h-4 w-4 text-success" />
                    ) : item.hasIssue ? (
                      <AlertTriangle className="h-4 w-4 text-warning" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                    )}
                    <span className={item.checked ? "text-muted-foreground line-through" : ""}>{item.text}</span>
                  </div>
                ))}
                {checklist.items.length > 3 && (
                  <p className="text-sm text-muted-foreground">+{checklist.items.length - 3} más...</p>
                )}
              </div>

              {checklist.completedAt && (
                <p className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {checklist.completedAt}
                </p>
              )}

              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant={checklist.status === "completado" ? "outline" : "default"}
                    className="w-full"
                    onClick={() => setActiveChecklist(checklist)}
                  >
                    {checklist.status === "completado" ? "Ver Detalles" : "Continuar"}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{checklist.title}</DialogTitle>
                    <DialogDescription>{checklist.sector}</DialogDescription>
                  </DialogHeader>
                  <div className="max-h-[60vh] space-y-4 overflow-y-auto py-4">
                    {checklist.items.map((item) => (
                      <div key={item.id} className="space-y-2 rounded-lg border border-border p-3">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={item.checked}
                            onCheckedChange={() => toggleItem(checklist.id, item.id)}
                            disabled={checklist.status === "completado"}
                          />
                          <div className="flex-1">
                            <p className={item.checked ? "text-muted-foreground line-through" : ""}>{item.text}</p>
                          </div>
                          {checklist.status !== "completado" && (
                            <Button
                              variant={item.hasIssue ? "destructive" : "ghost"}
                              size="sm"
                              onClick={() => toggleIssue(checklist.id, item.id)}
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        {item.hasIssue && (
                          <div className="ml-7 space-y-2">
                            <Textarea
                              placeholder="Describe el hallazgo..."
                              defaultValue={item.note}
                              className="text-sm"
                              disabled={checklist.status === "completado"}
                            />
                            {checklist.status !== "completado" && (
                              <Button variant="outline" size="sm">
                                <Camera className="mr-2 h-4 w-4" />
                                Agregar Foto
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {checklist.status !== "completado" && (
                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={() => completeChecklist(checklist.id)}>
                        Completar Checklist
                      </Button>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
