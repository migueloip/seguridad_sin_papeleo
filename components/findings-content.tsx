"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertTriangle, Plus, Clock, CheckCircle, MapPin, User, Calendar } from "lucide-react"
import { updateFinding, createFinding } from "@/app/actions/findings"
import { useRouter } from "next/navigation"

interface Finding {
  id: number
  title: string
  description: string | null
  location: string | null
  responsible_person: string | null
  severity: string
  status: string
  project_name: string | null
  due_date: string | null
  created_at: string
}

export function FindingsContent({ initialFindings }: { initialFindings: Finding[] }) {
  const [findings, setFindings] = useState<Finding[]>(initialFindings)
  const [filter, setFilter] = useState<string>("todos")
  const [isPending, startTransition] = useTransition()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const router = useRouter()

  const [newFinding, setNewFinding] = useState({
    title: "",
    description: "",
    severity: "medium" as "low" | "medium" | "high" | "critical",
    location: "",
    responsible_person: "",
    due_date: "",
  })

  const filteredFindings = findings.filter((f) => {
    if (filter === "todos") return true
    return f.status === filter
  })

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("es-CL")
  }

  const getDaysOpen = (createdAt: string, status: string) => {
    if (status === "resolved" || status === "closed") return 0
    const created = new Date(createdAt)
    const now = new Date()
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
  }

  const getPriorityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return <Badge variant="destructive">Critico</Badge>
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
            <Clock className="mr-1 h-3 w-3" />
            Abierto
          </Badge>
        )
      case "in_progress":
        return (
          <Badge variant="outline" className="border-warning text-warning">
            <Clock className="mr-1 h-3 w-3" />
            En Proceso
          </Badge>
        )
      case "resolved":
      case "closed":
        return (
          <Badge className="bg-success text-success-foreground">
            <CheckCircle className="mr-1 h-3 w-3" />
            Cerrado
          </Badge>
        )
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const closeFinding = (id: number) => {
    startTransition(async () => {
      await updateFinding(id, { status: "resolved" })
      setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, status: "resolved" } : f)))
    })
  }

  const handleCreateFinding = () => {
    if (!newFinding.title) {
      alert("El titulo es requerido")
      return
    }

    startTransition(async () => {
      const created = await createFinding({
        title: newFinding.title,
        description: newFinding.description || undefined,
        severity: newFinding.severity,
        location: newFinding.location || undefined,
        responsible_person: newFinding.responsible_person || undefined,
        due_date: newFinding.due_date || undefined,
      })

      setFindings((prev) => [{ ...created, project_name: null }, ...prev])
      setNewFinding({
        title: "",
        description: "",
        severity: "medium",
        location: "",
        responsible_person: "",
        due_date: "",
      })
      setIsCreateOpen(false)
      router.refresh()
    })
  }

  const stats = {
    total: findings.length,
    abiertos: findings.filter((f) => f.status === "open").length,
    enProceso: findings.filter((f) => f.status === "in_progress").length,
    cerrados: findings.filter((f) => f.status === "resolved" || f.status === "closed").length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hallazgos</h1>
          <p className="text-muted-foreground">Gestiona los hallazgos de seguridad reportados</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Hallazgo
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Nuevo Hallazgo</DialogTitle>
              <DialogDescription>Registra un nuevo hallazgo de seguridad</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <Label htmlFor="title">Titulo *</Label>
                <Input
                  id="title"
                  value={newFinding.title}
                  onChange={(e) => setNewFinding({ ...newFinding, title: e.target.value })}
                  placeholder="Ej: Cable electrico expuesto"
                />
              </div>
              <div>
                <Label htmlFor="description">Descripcion</Label>
                <Textarea
                  id="description"
                  value={newFinding.description}
                  onChange={(e) => setNewFinding({ ...newFinding, description: e.target.value })}
                  placeholder="Describe el hallazgo en detalle..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="severity">Severidad</Label>
                  <Select
                    value={newFinding.severity}
                    onValueChange={(value: "low" | "medium" | "high" | "critical") =>
                      setNewFinding({ ...newFinding, severity: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Bajo</SelectItem>
                      <SelectItem value="medium">Medio</SelectItem>
                      <SelectItem value="high">Alto</SelectItem>
                      <SelectItem value="critical">Critico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="due_date">Fecha Limite</Label>
                  <Input
                    id="due_date"
                    type="date"
                    value={newFinding.due_date}
                    onChange={(e) => setNewFinding({ ...newFinding, due_date: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="location">Ubicacion</Label>
                <Input
                  id="location"
                  value={newFinding.location}
                  onChange={(e) => setNewFinding({ ...newFinding, location: e.target.value })}
                  placeholder="Ej: Piso 3, Sector A"
                />
              </div>
              <div>
                <Label htmlFor="responsible">Responsable</Label>
                <Input
                  id="responsible"
                  value={newFinding.responsible_person}
                  onChange={(e) => setNewFinding({ ...newFinding, responsible_person: e.target.value })}
                  placeholder="Nombre del responsable"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateFinding} disabled={isPending}>
                {isPending ? "Guardando..." : "Crear Hallazgo"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Abiertos</p>
                <p className="text-2xl font-bold text-destructive">{stats.abiertos}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">En Proceso</p>
                <p className="text-2xl font-bold text-warning">{stats.enProceso}</p>
              </div>
              <Clock className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Cerrados</p>
                <p className="text-2xl font-bold text-success">{stats.cerrados}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="open">Abiertos</SelectItem>
            <SelectItem value="in_progress">En Proceso</SelectItem>
            <SelectItem value="resolved">Cerrados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Findings List */}
      <div className="grid gap-4 md:grid-cols-2">
        {filteredFindings.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center text-muted-foreground">No se encontraron hallazgos</CardContent>
          </Card>
        ) : (
          filteredFindings.map((finding) => {
            const daysOpen = getDaysOpen(finding.created_at, finding.status)
            const isOpen = finding.status === "open" || finding.status === "in_progress"

            return (
              <Card key={finding.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-muted-foreground">#{finding.id}</span>
                      {getPriorityBadge(finding.severity)}
                    </div>
                    {getStatusBadge(finding.status)}
                  </div>
                  <CardTitle className="text-lg">{finding.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  {finding.description && <p className="mb-4 text-sm text-muted-foreground">{finding.description}</p>}

                  <div className="mb-4 space-y-2 text-sm">
                    {finding.location && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        {finding.location}
                      </div>
                    )}
                    {finding.responsible_person && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-4 w-4" />
                        {finding.responsible_person}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {formatDate(finding.created_at)}
                    </div>
                  </div>

                  {isOpen && daysOpen > 0 && (
                    <p className="mb-4 text-sm text-destructive">Abierto hace {daysOpen} dias</p>
                  )}

                  <div className="flex gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="flex-1 bg-transparent">
                          Ver Detalles
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Hallazgo #{finding.id}</DialogTitle>
                          <DialogDescription>{finding.title}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div>
                            <p className="mb-1 text-sm font-medium">Descripcion</p>
                            <p className="text-sm text-muted-foreground">{finding.description || "Sin descripcion"}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="mb-1 text-sm font-medium">Ubicacion</p>
                              <p className="text-sm text-muted-foreground">{finding.location || "-"}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-sm font-medium">Responsable</p>
                              <p className="text-sm text-muted-foreground">{finding.responsible_person || "-"}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-sm font-medium">Severidad</p>
                              {getPriorityBadge(finding.severity)}
                            </div>
                            <div>
                              <p className="mb-1 text-sm font-medium">Estado</p>
                              {getStatusBadge(finding.status)}
                            </div>
                          </div>
                          {isOpen && (
                            <div>
                              <p className="mb-2 text-sm font-medium">Accion correctiva</p>
                              <Textarea placeholder="Describe la accion tomada..." />
                            </div>
                          )}
                        </div>
                        {isOpen && (
                          <Button className="w-full" onClick={() => closeFinding(finding.id)} disabled={isPending}>
                            {isPending ? "Cerrando..." : "Cerrar Hallazgo"}
                          </Button>
                        )}
                      </DialogContent>
                    </Dialog>
                    {isOpen && (
                      <Button
                        variant="default"
                        className="flex-1"
                        onClick={() => closeFinding(finding.id)}
                        disabled={isPending}
                      >
                        Cerrar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
