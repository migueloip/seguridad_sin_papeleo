"use client"

import { useState, useTransition, useEffect } from "react"
import { toast } from "sonner"
import { confirmToast } from "@/lib/confirm"
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
import { AlertTriangle, Plus, Clock, CheckCircle, MapPin, User, Calendar, Edit2, Trash2, Camera, Sparkles } from "lucide-react"
import {
  updateFinding,
  createFinding,
  scanFindingImage,
  generateCorrectiveAction,
  deleteFinding,
  getFindingsTimeline,
  getFindingAnalytics,
} from "@/app/actions/findings"
import { getPlanZonesByProject } from "@/app/actions/plans"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { useRouter } from "next/navigation"

const SEV: Record<string, { label: string; color: string; tint: string }> = {
  critical: { label: "Crítico", color: "var(--sev-critical)", tint: "var(--sev-critical-tint)" },
  high: { label: "Alto", color: "var(--sev-high)", tint: "var(--sev-high-tint)" },
  medium: { label: "Medio", color: "var(--sev-medium)", tint: "var(--sev-medium-tint)" },
  low: { label: "Bajo", color: "var(--sev-low)", tint: "var(--sev-low-tint)" },
}
const ST: Record<string, { label: string; color: string; tint: string }> = {
  open: { label: "Abierto", color: "var(--danger)", tint: "var(--danger-tint)" },
  in_progress: { label: "En proceso", color: "var(--warning)", tint: "var(--warning-tint)" },
  resolved: { label: "Resuelto", color: "var(--success)", tint: "var(--success-tint)" },
  closed: { label: "Cerrado", color: "var(--success)", tint: "var(--success-tint)" },
}

interface Finding {
  id: number
  title: string
  description: string | null
  location: string | null
  responsible_person: string | null
  severity: string
  status: string
  project_name: string | null
  plan_zone_id?: number | null
  plan_zone_name?: string | null
  plan_floor_name?: string | null
  due_date: string | null
  resolution_notes?: string | null
  photos?: string[] | null
  created_at: string
}

type FindingsTimelinePoint = {
  label: string
  created: number
  resolved: number
}

type FindingsAnalyticsState = {
  total: number
  open: number
  in_progress: number
  resolved: number
  overdue: number
  avg_resolution_days: number | null
  avg_open_days: number | null
  top_zones: Array<{
    label: string
    floor: string | null
    total: number
    open: number
  }>
  oldest_open: {
    id: number
    title: string
    severity: string
    location: string | null
    project_name: string | null
    plan_zone_name: string | null
    created_at: string
    days_open: number
  } | null
}

type PlanZoneOption = {
  id: number
  name: string
  code: string | null
  floor_name: string | null
  plan_name: string | null
  project_id: number | null
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
    plan_zone_id: null as number | null,
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
  const [timelineMode, setTimelineMode] = useState<"day" | "week" | "month">("week")
  const [timelineData, setTimelineData] = useState<FindingsTimelinePoint[]>([])
  const [isTimelineLoading, setIsTimelineLoading] = useState(false)
  const [analytics, setAnalytics] = useState<FindingsAnalyticsState | null>(null)
  const [planZones, setPlanZones] = useState<PlanZoneOption[]>([])

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

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getFindingAnalytics(projectId)
        setAnalytics(result as FindingsAnalyticsState)
      } catch {}
    })
  }, [projectId, startTransition])

  useEffect(() => {
    startTransition(async () => {
      try {
        const zones = await getPlanZonesByProject(projectId)
        setPlanZones(zones as PlanZoneOption[])
      } catch {}
    })
  }, [projectId, startTransition])

  useEffect(() => {
    setIsTimelineLoading(true)
    startTransition(async () => {
      try {
        const rows = await getFindingsTimeline(timelineMode, projectId)
        const formatLabel = (bucket: string) => {
          const d = new Date(bucket)
          if (!Number.isFinite(d.getTime())) return bucket
          const day = d.getDate().toString().padStart(2, "0")
          const month = (d.getMonth() + 1).toString().padStart(2, "0")
          const year = d.getFullYear()
          if (timelineMode === "day") return `${day}/${month}`
          if (timelineMode === "week") return `${day}/${month}`
          return `${month}/${year}`
        }
        setTimelineData(
          (rows || []).map((r) => ({
            label: formatLabel(r.bucket),
            created: r.created_count,
            resolved: r.resolved_count,
          })),
        )
      } catch {
      }
      setIsTimelineLoading(false)
    })
  }, [timelineMode, projectId, startTransition])
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
      toast.error("El titulo es requerido")
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
        plan_zone_id: newFinding.plan_zone_id ?? undefined,
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
        plan_zone_id: null,
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
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">Hallazgos</h1>
          <p className="text-sm text-muted-foreground">
            Reporte y seguimiento de condiciones de riesgo
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex h-[42px] items-center gap-2 rounded-[11px] bg-primary px-[17px] text-sm font-semibold text-white transition-colors hover:bg-[#241f17]"
            >
              <Plus className="h-[17px] w-[17px] text-brand" />
              Reportar hallazgo
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Reportar hallazgo</DialogTitle>
              <DialogDescription>Ingresa los datos del nuevo hallazgo</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <Label htmlFor="title">Título *</Label>
                <Input
                  id="title"
                  value={newFinding.title}
                  onChange={(e) => setNewFinding({ ...newFinding, title: e.target.value })}
                  placeholder="Ej: Cable electrico expuesto"
                />
              </div>
              <div>
                <Label htmlFor="description">Descripción</Label>
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
                  <Label htmlFor="due_date">Fecha límite</Label>
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
                        {/* eslint-disable-next-line @next/next/no-img-element -- data URL en cliente */}
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
                            plan_zone_id: prev.plan_zone_id,
                            responsible_person: prev.responsible_person || result.responsible_person || "",
                            due_date: prev.due_date || result.due_date || "",
                          }))
                        } catch (e) {
                          const msg =
                            e instanceof Error ? e.message : "No se pudo escanear con IA. Intenta con otra imagen."
                          toast.error(msg)
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
              {planZones.length > 0 && (
                <div>
                  <Label htmlFor="plan_zone">Sector del plano</Label>
                  <Select
                    value={newFinding.plan_zone_id ? String(newFinding.plan_zone_id) : "none"}
                    onValueChange={(value) =>
                      setNewFinding({
                        ...newFinding,
                        plan_zone_id: value === "none" ? null : Number(value),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona sector (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin sector</SelectItem>
                      {planZones.map((z) => (
                        <SelectItem key={z.id} value={String(z.id)}>
                          {z.plan_name ? `${z.plan_name} · ` : ""}
                          {z.floor_name ? `${z.floor_name} · ` : ""}
                          {z.name}
                          {z.code ? ` (${z.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="location">Ubicación</Label>
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

      {/* Banner de captura por IA */}
      <div className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl bg-primary p-[18px] px-5 text-sidebar-foreground">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg,rgba(243,164,10,.07) 0 18px,transparent 18px 36px)",
          }}
        />
        <div className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-brand">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div className="relative min-w-[200px] flex-1">
          <div className="font-display text-base font-semibold">Detección por foto con IA</div>
          <div className="text-[13px] text-sidebar-foreground/60">
            Toma una foto desde terreno y la IA identifica el riesgo, sugiere categoría, severidad y
            acciones correctivas.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="relative flex h-10 shrink-0 items-center gap-2 rounded-[11px] border border-brand/40 bg-brand/10 px-4 text-[13px] font-semibold text-brand transition-colors hover:bg-brand/20"
        >
          <Camera className="h-4 w-4" />
          Escanear ahora
        </button>
      </div>

      {/* Filtros con conteo */}
      <div className="flex flex-wrap gap-2.5">
        {(
          [
            { key: "todos", label: "Todos", value: stats.total, color: undefined },
            { key: "open", label: "Abiertos", value: stats.abiertos, color: "var(--danger)" },
            { key: "in_progress", label: "En proceso", value: stats.enProceso, color: "var(--warning)" },
            { key: "resolved", label: "Resueltos", value: stats.cerrados, color: "var(--success)" },
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setFilter(s.key)}
            className={`min-w-[150px] flex-1 rounded-[13px] border p-4 text-left transition-colors ${
              filter === s.key
                ? "border-foreground/30 bg-secondary"
                : "border-border bg-card hover:border-foreground/15"
            }`}
          >
            <div
              className="font-display text-2xl font-bold"
              style={s.color ? { color: s.color } : undefined}
            >
              {s.value}
            </div>
            <div className="text-[13px] text-muted-foreground">{s.label}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Evolución de hallazgos</CardTitle>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={timelineMode === "day" ? "default" : "outline"}
              onClick={() => setTimelineMode("day")}
            >
              Día a día (1 mes)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={timelineMode === "week" ? "default" : "outline"}
              onClick={() => setTimelineMode("week")}
            >
              Semana a semana (3 meses)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={timelineMode === "month" ? "default" : "outline"}
              onClick={() => setTimelineMode("month")}
            >
              Mes a mes
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            {isTimelineLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Cargando gráfico...
              </div>
            ) : timelineData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sin hallazgos en el periodo seleccionado
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  />
                  <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="created"
                    name="Creados"
                    fill="var(--color-chart-1)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="resolved"
                    name="Resueltos"
                    fill="var(--color-chart-5)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tiempo promedio de resolución</p>
                <p className="text-2xl font-bold">
                  {analytics && analytics.avg_resolution_days !== null
                    ? `${analytics.avg_resolution_days.toFixed(1)} días`
                    : "-"}
                </p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Edad promedio hallazgos abiertos</p>
                <p className="text-2xl font-bold">
                  {analytics && analytics.avg_open_days !== null
                    ? `${analytics.avg_open_days.toFixed(1)} días`
                    : "-"}
                </p>
              </div>
              <Clock className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Hallazgos vencidos</p>
                <p className="text-2xl font-bold text-destructive">
                  {analytics ? analytics.overdue : 0}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Zonas con más hallazgos</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics && analytics.top_zones.length > 0 ? (
              <div className="space-y-2 text-sm">
                {analytics.top_zones.map((z, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {z.label}
                        {z.floor ? ` · ${z.floor}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {z.open} abiertos · {z.total} total
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aún no hay datos de zonas.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Hallazgo más antiguo sin resolver</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics && analytics.oldest_open ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">
                  #{analytics.oldest_open.id} · {analytics.oldest_open.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {analytics.oldest_open.project_name
                    ? analytics.oldest_open.project_name
                    : "Sin proyecto"}
                  {analytics.oldest_open.plan_zone_name
                    ? ` · ${analytics.oldest_open.plan_zone_name}`
                    : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {analytics.oldest_open.location || "Sin ubicación"}
                </p>
                <p className="text-sm text-destructive">
                  Abierto hace {analytics.oldest_open.days_open} días
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay hallazgos abiertos actualmente.
              </p>
            )}
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
      <div className="flex flex-col gap-3">
        {filteredFindings.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center text-muted-foreground">No se encontraron hallazgos</CardContent>
          </Card>
        ) : (
          filteredFindings.map((finding) => {
            const daysOpen = getDaysOpen(finding.created_at, finding.status)
            const isOpen = finding.status === "open" || finding.status === "in_progress"

            const sevMeta = SEV[finding.severity] || SEV.medium
            const stMeta = ST[finding.status] || ST.open
            const hasPhoto = Array.isArray(finding.photos) && finding.photos.length > 0
            return (
              <div key={finding.id} className="flex gap-4 rounded-2xl border border-border bg-card p-[18px]">
                {hasPhoto && (
                  <a
                    href={finding.photos![0]}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden h-[88px] w-[88px] shrink-0 overflow-hidden rounded-xl bg-[#262017] sm:block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL externa de Supabase Storage */}
                    <img src={finding.photos![0]} alt="" className="h-full w-full object-cover" />
                  </a>
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2.5">
                    <span className="font-mono text-xs text-muted-foreground">#{finding.id}</span>
                    <span
                      className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                      style={{ color: sevMeta.color, background: sevMeta.tint }}
                    >
                      {sevMeta.label}
                    </span>
                    <span
                      className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                      style={{ color: stMeta.color, background: stMeta.tint }}
                    >
                      {stMeta.label}
                    </span>
                    {isOpen && daysOpen > 0 && (
                      <span className="text-[11px] font-medium text-[var(--danger)]">
                        · Abierto hace {daysOpen} días
                      </span>
                    )}
                  </div>
                  <div className="mb-1.5 font-display text-base font-semibold tracking-[-0.01em]">
                    {finding.title}
                  </div>
                  {finding.description && (
                    <p className="mb-3 text-[13px] leading-relaxed text-[#6f6a60]">{finding.description}</p>
                  )}
                  <div className="mb-3.5 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    {finding.location && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        {finding.location}
                      </span>
                    )}
                    {finding.plan_zone_name && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        {finding.plan_zone_name}
                        {finding.plan_floor_name ? ` · ${finding.plan_floor_name}` : ""}
                      </span>
                    )}
                    {finding.responsible_person && (
                      <span className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" />
                        {finding.responsible_person}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(finding.created_at)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="flex-1">
                          Ver ficha
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Hallazgo #{finding.id}</DialogTitle>
                          <DialogDescription>{finding.title}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div>
                            <p className="mb-1 text-sm font-medium">Descripción</p>
                            <p className="text-sm text-muted-foreground">{finding.description || "Sin descripcion"}</p>
                          </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="mb-1 text-sm font-medium">Ubicación</p>
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
                                  {/* eslint-disable-next-line @next/next/no-img-element -- URL externa de Supabase Storage, evita configurar remotePatterns */}
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
                        confirmToast("¿Eliminar hallazgo? Esta acción no se puede deshacer.", () => {
                          startTransition(async () => {
                            await deleteFinding(finding.id)
                            setFindings((prev) => prev.filter((f) => f.id !== finding.id))
                            router.refresh()
                          })
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
                </div>
              </div>
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
              <Label htmlFor="edit_title">Título</Label>
              <Input
                id="edit_title"
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="edit_description">Descripción</Label>
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
                <Label htmlFor="edit_due">Fecha límite</Label>
                <Input
                  id="edit_due"
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit_location">Ubicación</Label>
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
