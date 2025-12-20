"use client"

import { useState, useTransition, useEffect } from "react"
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
import { AlertTriangle, Plus, Clock, CheckCircle, MapPin, User, Calendar, Edit2, Trash2 } from "lucide-react"
import { updateFinding, createFinding, scanFindingImage, generateCorrectiveAction, deleteFinding } from "@/app/actions/findings"
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
  resolution_notes?: string | null
  photos?: string[] | null
  created_at: string
}

async function prepareImageForVision(dataUrl: string): Promise<{ dataUrl: string; mime: string; base64: string }> {
  if (!dataUrl.startsWith("data:image/")) {
    return { dataUrl, mime: "image/png", base64: dataUrl.split(",")[1] || "" }
  }
  const img = new Image()
  img.decoding = "async"
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("No se pudo cargar la imagen"))
    img.src = dataUrl
  })

  const maxSide = 1600
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const maxDim = Math.max(w, h)
  const scale = maxDim > maxSide ? maxSide / maxDim : 1

  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return { dataUrl, mime: "image/png", base64: dataUrl.split(",")[1] || "" }
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const mime = "image/jpeg"
  const optimizedDataUrl = canvas.toDataURL(mime, 0.82)
  return { dataUrl: optimizedDataUrl, mime, base64: optimizedDataUrl.split(",")[1] || "" }
}

export function FindingsContent({ initialFindings, projectId }: { initialFindings: Finding[]; projectId?: number }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
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
  const [imageDataUrl, setImageDataUrl] = useState<string>("")
  const [imageMimeType, setImageMimeType] = useState<string>("")
  const [isScanning, setIsScanning] = useState(false)
  const [correctiveById, setCorrectiveById] = useState<Record<number, string>>({})
  const [genPendingById, setGenPendingById] = useState<Record<number, boolean>>({})
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editFinding, setEditFinding] = useState<Finding | null>(null)
  const [editForm, setEditForm] = useState<{
    title: string
    description: string
    severity: "low" | "medium" | "high" | "critical"
    location: string
    responsible_person: string
    due_date: string
    resolution_notes: string
  }>({
    title: "",
    description: "",
    severity: "medium",
    location: "",
    responsible_person: "",
    due_date: "",
    resolution_notes: "",
  })

  const filteredFindings = findings.filter((f) => {
    if (filter === "todos") return true
    if (filter === "resolved") return f.status === "resolved" || f.status === "closed"
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

  useEffect(() => {
    const map: Record<number, string> = {}
    for (const f of initialFindings) {
      if (f.resolution_notes) map[f.id] = String(f.resolution_notes || "")
    }
    setCorrectiveById(map)
  }, [initialFindings])
  if (!mounted) return null

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
            Completado
          </Badge>
        )
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const closeFinding = (id: number) => {
    startTransition(async () => {
      const notes = correctiveById[id] ?? ""
      await updateFinding(id, { status: "resolved", resolution_notes: notes || undefined })
      setFindings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "resolved", resolution_notes: notes || null } : f)),
      )
    })
  }

  const reopenFinding = (id: number) => {
    startTransition(async () => {
      await updateFinding(id, { status: "open" })
      setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, status: "open" } : f)))
    })
  }

  const openEdit = (f: Finding) => {
    setEditFinding(f)
    setEditForm({
      title: f.title || "",
      description: f.description || "",
      severity: (f.severity as "low" | "medium" | "high" | "critical") || "medium",
      location: f.location || "",
      responsible_person: f.responsible_person || "",
      due_date: f.due_date || "",
      resolution_notes: f.resolution_notes || "",
    })
    setIsEditOpen(true)
  }

  const saveEdit = () => {
    if (!editFinding) return
    startTransition(async () => {
      const nextStatus: "in_progress" | undefined =
        editFinding.status === "open" && editForm.resolution_notes.trim() ? "in_progress" : undefined
      await updateFinding(editFinding.id, {
        title: editForm.title || undefined,
        description: editForm.description || undefined,
        severity: editForm.severity || undefined,
        location: editForm.location || undefined,
        responsible_person: editForm.responsible_person || undefined,
        due_date: editForm.due_date || undefined,
        resolution_notes: editForm.resolution_notes || undefined,
        status: nextStatus,
      })
      setFindings((prev) =>
        prev.map((f) =>
          f.id === editFinding.id
            ? {
                ...f,
                title: editForm.title,
                description: editForm.description || null,
                severity: editForm.severity,
                location: editForm.location || null,
                responsible_person: editForm.responsible_person || null,
                due_date: editForm.due_date || null,
                resolution_notes: editForm.resolution_notes || null,
                status: nextStatus ?? f.status,
              }
            : f,
        ),
      )
      setCorrectiveById((prev) => ({ ...prev, [editFinding.id]: editForm.resolution_notes }))
      setIsEditOpen(false)
      setEditFinding(null)
      router.refresh()
    })
  }

  const handleCreateFinding = () => {
    if (!newFinding.title) {
      alert("El titulo es requerido")
      return
    }

    startTransition(async () => {
      const created = await createFinding({
        project_id: projectId,
        title: newFinding.title,
        description: newFinding.description || undefined,
        severity: newFinding.severity,
        location: newFinding.location || undefined,
        responsible_person: newFinding.responsible_person || undefined,
        due_date: newFinding.due_date || undefined,
        photos: imageDataUrl ? [imageDataUrl] : undefined,
      })

      const createdFinding = created as unknown as Finding
      setFindings((prev) => [{ ...createdFinding, project_name: null }, ...prev])
      setNewFinding({
        title: "",
        description: "",
        severity: "medium",
        location: "",
        responsible_person: "",
        due_date: "",
      })
      setImageDataUrl("")
      setImageMimeType("")
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
              Insertar Hallazgo
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Insertar Hallazgo</DialogTitle>
              <DialogDescription>Ingresa los datos completos del nuevo hallazgo</DialogDescription>
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
                  className="min-h-[140px]"
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
              <div className="space-y-2">
                <Label htmlFor="photo">Foto del hallazgo</Label>
                <Input
                  id="photo"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setImageMimeType(f.type)
                    const reader = new FileReader()
                    reader.onload = () => {
                      const url = String(reader.result || "")
                      setImageDataUrl(url)
                    }
                    reader.readAsDataURL(f)
                  }}
                />
                    {imageDataUrl && (
                      <div className="flex items-center gap-2">
                        <img src={imageDataUrl} alt="hallazgo" className="h-16 w-16 rounded object-cover" />
                        <Button
                          type="button"
                          variant="secondary"
                      disabled={isScanning}
                      onClick={async () => {
                        if (!imageDataUrl || !imageMimeType) return
                        setIsScanning(true)
                        try {
                          const prepared = await prepareImageForVision(imageDataUrl)
                          const result = await scanFindingImage(prepared.base64, prepared.mime)
                          setNewFinding((prev) => ({
                            title: prev.title || result.title || "",
                            description: prev.description || result.description || "",
                            severity: (result.severity || prev.severity) as "low" | "medium" | "high" | "critical",
                            location: prev.location || result.location || "",
                            responsible_person: prev.responsible_person || result.responsible_person || "",
                            due_date: prev.due_date || result.due_date || "",
                          }))
                        } catch (e) {
                          const msg =
                            e instanceof Error ? e.message : "No se pudo escanear con IA. Intenta con otra imagen."
                          alert(msg)
                        } finally {
                          setIsScanning(false)
                        }
                      }}
                    >
                      {isScanning ? "Escaneando..." : "Escanear con IA"}
                    </Button>
                  </div>
                )}
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
                <p className="text-sm text-muted-foreground">Completados</p>
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
            <SelectItem value="resolved">Completados</SelectItem>
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

                  <div className="flex items-center gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="flex-1 bg-transparent">
                          Ver Detalles
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-h-[85vh] overflow-y-auto">
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
                        {Array.isArray(finding.photos) && finding.photos.length > 0 && (
                          <div>
                            <p className="mb-2 text-sm font-medium">Fotos</p>
                            <div className="grid grid-cols-3 gap-2">
                              {finding.photos.map((url, idx) => (
                                <a key={idx} href={url} target="_blank" rel="noreferrer">
                                  <img
                                    src={url}
                                    alt={`Foto ${idx + 1}`}
                                    className="h-24 w-full rounded object-cover"
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="mb-2 text-sm font-medium">Accion correctiva</p>
                          {isOpen ? (
                            <>
                              <Textarea
                                placeholder="Describe la accion tomada..."
                                value={correctiveById[finding.id] ?? ""}
                                onChange={(e) =>
                                  setCorrectiveById((prev) => ({ ...prev, [finding.id]: e.target.value }))
                                }
                              />
                              <div className="mt-2 flex gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  disabled={!!genPendingById[finding.id]}
                                  onClick={async () => {
                                    setGenPendingById((prev) => ({ ...prev, [finding.id]: true }))
                                    try {
                                      const text = await generateCorrectiveAction({
                                        title: finding.title,
                                        description: finding.description || undefined,
                                        severity:
                                          (finding.severity as "low" | "medium" | "high" | "critical") || "medium",
                                        location: finding.location || undefined,
                                        photos:
                                          Array.isArray(finding.photos) && finding.photos.length > 0
                                            ? [finding.photos[0]]
                                            : undefined,
                                      })
                                      setCorrectiveById((prev) => ({ ...prev, [finding.id]: text || "" }))
                                    } finally {
                                      setGenPendingById((prev) => ({ ...prev, [finding.id]: false }))
                                    }
                                  }}
                                >
                                  {genPendingById[finding.id] ? "Generando..." : "Generar con IA"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    const notes = correctiveById[finding.id] ?? ""
                                    startTransition(async () => {
                                      const shouldMoveToInProgress =
                                        finding.status === "open" && notes.trim().length > 0
                                      await updateFinding(finding.id, {
                                        resolution_notes: notes || undefined,
                                        status: shouldMoveToInProgress ? "in_progress" : undefined,
                                      })
                                      setFindings((prev) =>
                                        prev.map((f) =>
                                          f.id === finding.id
                                            ? {
                                                ...f,
                                                status: shouldMoveToInProgress ? "in_progress" : f.status,
                                                resolution_notes: notes || null,
                                              }
                                            : f,
                                        ),
                                      )
                                    })
                                  }}
                                >
                                  Guardar Accion
                                </Button>
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {finding.resolution_notes || "Sin accion correctiva"}
                            </p>
                          )}
                        </div>
                        </div>
                        <div className="sticky bottom-0 mt-4 bg-background/80 p-2 backdrop-blur">
                          {isOpen ? (
                            <Button className="w-full" onClick={() => closeFinding(finding.id)} disabled={isPending}>
                              {isPending ? "Cerrando..." : "Cerrar Hallazgo"}
                            </Button>
                          ) : (
                            <Button className="w-full" onClick={() => reopenFinding(finding.id)} disabled={isPending}>
                              {isPending ? "Reabriendo..." : "Reabrir Hallazgo"}
                            </Button>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button variant="outline" className="flex-1 bg-transparent" onClick={() => openEdit(finding)}>
                      <Edit2 className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 bg-transparent text-destructive hover:text-destructive"
                      onClick={() => {
                        if (!confirm("¿Eliminar hallazgo? Esta accion no se puede deshacer.")) return
                        startTransition(async () => {
                          await deleteFinding(finding.id)
                          setFindings((prev) => prev.filter((f) => f.id !== finding.id))
                          router.refresh()
                        })
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar
                    </Button>
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
                    {!isOpen && (
                      <Button
                        variant="default"
                        className="flex-1"
                        onClick={() => reopenFinding(finding.id)}
                        disabled={isPending}
                      >
                        Reabrir
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Hallazgo</DialogTitle>
            <DialogDescription>Actualiza los datos del hallazgo</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="edit_title">Titulo</Label>
              <Input
                id="edit_title"
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit_description">Descripcion</Label>
              <Textarea
                id="edit_description"
                value={editForm.description}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                className="min-h-[140px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_severity">Severidad</Label>
                <Select
                  value={editForm.severity}
                  onValueChange={(value: "low" | "medium" | "high" | "critical") =>
                    setEditForm((prev) => ({ ...prev, severity: value }))
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
                <Label htmlFor="edit_due">Fecha Limite</Label>
                <Input
                  id="edit_due"
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit_location">Ubicacion</Label>
              <Input
                id="edit_location"
                value={editForm.location}
                onChange={(e) => setEditForm((prev) => ({ ...prev, location: e.target.value }))}
                placeholder="Ej: Piso 3, Sector A"
              />
            </div>
            <div>
              <Label htmlFor="edit_resp">Responsable</Label>
              <Input
                id="edit_resp"
                value={editForm.responsible_person}
                onChange={(e) => setEditForm((prev) => ({ ...prev, responsible_person: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit_notes">Accion correctiva</Label>
              <Textarea
                id="edit_notes"
                value={editForm.resolution_notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, resolution_notes: e.target.value }))}
                className="min-h-[120px]"
              />
            </div>
          </div>
          <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-background/80 p-2 backdrop-blur">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={isPending}>
              {isPending ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
