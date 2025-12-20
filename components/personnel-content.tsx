"use client"

import { useState, useTransition, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Search, Plus, Users, CheckCircle, AlertCircle, FileText, Edit2, Trash2 } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { createWorker, updateWorker, deleteWorker, getWorkerStatsTimeline } from "@/app/actions/workers"
import { getDocuments, createDocument, findDocumentTypeByName, getDocumentTypes } from "@/app/actions/documents"
import { createAdmonition, getAdmonitions, deleteAdmonition } from "@/app/actions/admonitions"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { isValidRut, normalizeRut } from "@/lib/utils"

interface Worker {
  id: number
  rut: string
  first_name: string
  last_name: string
  role: string | null
  company: string | null
  phone: string | null
  email: string | null
  project_name: string | null
  status: string
  valid_docs: number
  expiring_docs: number
  expired_docs: number
  admonitions_count: number
}

type AdmonitionTab = "create" | "history"

type AdmonitionFilters = {
  from: string
  to: string
  type: "verbal" | "escrita" | "suspension" | "todos"
  status: "active" | "archived" | "archivada" | "todos"
  approval_status: "pending" | "approved" | "rejected" | "todos"
}

type AdmonitionRow = Awaited<ReturnType<typeof getAdmonitions>>[number]
type NormalizedAdmonitionRow = Omit<AdmonitionRow, "admonition_date"> & { admonition_date: string }

type CandidateDoc = { id: number; file_name: string; file_url: string | null }
type DocumentRow = Awaited<ReturnType<typeof getDocuments>>[number]

function normalizeAdmonitionRows(rows: AdmonitionRow[] | null | undefined): NormalizedAdmonitionRow[] {
  return (rows || []).map((row) => {
    const raw = (row as unknown as { admonition_date: string | Date }).admonition_date
    const normalizedDate =
      typeof raw === "string" ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10)
    return { ...row, admonition_date: normalizedDate }
  })
}

export function PersonnelContent({ initialWorkers, projectId }: { initialWorkers: Worker[]; projectId?: number }) {
  const [search, setSearch] = useState("")
  const [filterExpiredDocsOnly, setFilterExpiredDocsOnly] = useState(false)
  const [filterManyAdmonitionsOnly, setFilterManyAdmonitionsOnly] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  const [workers, setWorkers] = useState<Worker[]>(initialWorkers)
  const [isPending, startTransition] = useTransition()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const router = useRouter()

  const [isAdmonitionOpen, setIsAdmonitionOpen] = useState(false)
  const [activeWorkerId, setActiveWorkerId] = useState<number | null>(null)
  const [admonitionTab, setAdmonitionTab] = useState<AdmonitionTab>("create")
  const [admonitions, setAdmonitions] = useState<NormalizedAdmonitionRow[]>([])
  const [isAdmonitionsLoading, setIsAdmonitionsLoading] = useState(false)
  const [admonitionFilters, setAdmonitionFilters] = useState<AdmonitionFilters>({
    from: "",
    to: "",
    type: "todos",
    status: "todos",
    approval_status: "todos",
  })
  const [admonitionForm, setAdmonitionForm] = useState({
    worker_id: "",
    admonition_date: new Date().toISOString().slice(0, 10),
    admonition_type: "verbal" as "verbal" | "escrita" | "suspension",
    reason: "",
    supervisor_signature: "" as string | null,
    attachments: [] as { file_name: string; file_url: string | null; mime?: string | null }[],
  })
  const [candidateDocs, setCandidateDocs] = useState<CandidateDoc[]>([])
  const [newAttachment, setNewAttachment] = useState<{ file: File | null; file_name: string }>({ file: null, file_name: "" })
  const [timelineMode, setTimelineMode] = useState<"day" | "week" | "month">("day")
  const [timelineMetric, setTimelineMetric] = useState<
    "total" | "complete" | "incomplete" | "critical" | "admonitions"
  >("admonitions")
  const [timelineData, setTimelineData] = useState<
    Array<{
      label: string
      total_workers: number
      complete_workers: number
      incomplete_workers: number
      critical_workers: number
      total_admonitions: number
    }>
  >([])
  const [isTimelineLoading, setIsTimelineLoading] = useState(false)

  useEffect(() => {
    if (!isAdmonitionOpen) return
    if (admonitionTab !== "history") return
    setIsAdmonitionsLoading(true)
    startTransition(async () => {
      try {
        const rows = await getAdmonitions({
          worker_id: activeWorkerId || undefined,
          from: admonitionFilters.from || undefined,
          to: admonitionFilters.to || undefined,
          type: admonitionFilters.type,
          status: admonitionFilters.status,
          approval_status: admonitionFilters.approval_status,
        })
        setAdmonitions(normalizeAdmonitionRows(rows))
      } catch {}
      setIsAdmonitionsLoading(false)
    })
  }, [
    isAdmonitionOpen,
    admonitionTab,
    activeWorkerId,
    admonitionFilters.from,
    admonitionFilters.to,
    admonitionFilters.type,
    admonitionFilters.status,
    admonitionFilters.approval_status,
    startTransition,
  ])

  const [newWorker, setNewWorker] = useState({
    rut: "",
    first_name: "",
    last_name: "",
    role: "",
    company: "",
    phone: "",
    email: "",
  })

  const [editForm, setEditForm] = useState({
    rut: "",
    first_name: "",
    last_name: "",
    role: "",
    company: "",
    phone: "",
    email: "",
  })

  useEffect(() => {
    setIsTimelineLoading(true)
    startTransition(async () => {
      try {
        const rows = await getWorkerStatsTimeline(timelineMode)
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
            label: formatLabel(r.bucket as string),
            total_workers: r.total_workers,
            complete_workers: r.complete_workers,
            incomplete_workers: r.incomplete_workers,
            critical_workers: r.critical_workers,
            total_admonitions: r.total_admonitions,
          })),
        )
      } catch {
      }
      setIsTimelineLoading(false)
    })
  }, [timelineMode, startTransition])

  const filteredPersonnel = workers.filter((p) => {
    const matchesSearch =
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      p.rut.includes(search) ||
      (p.role?.toLowerCase() || "").includes(search.toLowerCase())

    if (!matchesSearch) return false
    if (filterExpiredDocsOnly && Number(p.expired_docs) <= 0) return false
    if (filterManyAdmonitionsOnly && Number(p.admonitions_count) <= 3) return false
    return true
  })

  const getDocStatus = (worker: Worker) => {
    const totalDocs = Number(worker.valid_docs) + Number(worker.expiring_docs) + Number(worker.expired_docs)
    if (Number(worker.expired_docs) > 0) return "critico"
    if (Number(worker.expiring_docs) > 0) return "incompleto"
    if (totalDocs === 0) return "incompleto"
    return "completo"
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completo":
        return (
          <Badge className="bg-success text-success-foreground">
            <CheckCircle className="mr-1 h-3 w-3" />
            Completo
          </Badge>
        )
      case "incompleto":
        return (
          <Badge className="bg-warning text-warning-foreground">
            <AlertCircle className="mr-1 h-3 w-3" />
            Incompleto
          </Badge>
        )
      case "critico":
        return (
          <Badge variant="destructive">
            <AlertCircle className="mr-1 h-3 w-3" />
            Critico
          </Badge>
        )
      default:
        return <Badge variant="secondary">Sin docs</Badge>
    }
  }

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase()
  }

  const getDocProgress = (worker: Worker) => {
    const total = Number(worker.valid_docs) + Number(worker.expiring_docs) + Number(worker.expired_docs)
    if (total === 0) return 0
    return (Number(worker.valid_docs) / total) * 100
  }

  const handleCreateWorker = () => {
    if (!newWorker.rut || !newWorker.first_name || !newWorker.last_name) {
      toast.error("RUT, nombre y apellido son requeridos")
      return
    }

    const normalized = normalizeRut(newWorker.rut)
    if (!isValidRut(normalized)) {
      toast.error("RUT inválido")
      return
    }

    const existsWithSameRut = workers.some((w) => normalizeRut(w.rut) === normalized)
    if (existsWithSameRut) {
      toast.error("Ya existe un trabajador con este RUT en este proyecto")
      return
    }

    startTransition(async () => {
      try {
        const created = await createWorker({
          rut: newWorker.rut,
          first_name: newWorker.first_name,
          last_name: newWorker.last_name,
          role: newWorker.role || undefined,
          company: newWorker.company || undefined,
          phone: newWorker.phone || undefined,
          email: newWorker.email || undefined,
          project_id: projectId,
        })
        const createdWorker = created as unknown as Worker
        setWorkers((prev) => {
          const exists = prev.some((w) => w.id === createdWorker.id)
          if (exists) return prev
          return [
            {
              ...createdWorker,
              valid_docs: 0,
              expiring_docs: 0,
              expired_docs: 0,
              admonitions_count: 0,
              project_name: null,
            } as Worker,
            ...prev,
          ]
        })
        setNewWorker({
          rut: "",
          first_name: "",
          last_name: "",
          role: "",
          company: "",
          phone: "",
          email: "",
        })
        setIsCreateOpen(false)
        router.refresh()
        toast.success("Trabajador creado correctamente")
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error al crear trabajador"
        toast.error(msg)
      }
    })
  }

  const handleOpenEdit = (worker: Worker) => {
    setEditingWorker(worker)
    setEditForm({
      rut: worker.rut,
      first_name: worker.first_name,
      last_name: worker.last_name,
      role: worker.role || "",
      company: worker.company || "",
      phone: worker.phone || "",
      email: worker.email || "",
    })
    setIsEditOpen(true)
  }

  const handleUpdateWorker = () => {
    if (!editingWorker || !editForm.rut || !editForm.first_name || !editForm.last_name) {
      toast.error("RUT, nombre y apellido son requeridos")
      return
    }

    const normalized = normalizeRut(editForm.rut)
    if (!isValidRut(normalized)) {
      toast.error("RUT inválido")
      return
    }

    startTransition(async () => {
      const updated = await updateWorker(editingWorker.id, {
        rut: normalized,
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        role: editForm.role || undefined,
        company: editForm.company || undefined,
        phone: editForm.phone || undefined,
        email: editForm.email || undefined,
      })
      const updatedWorker = updated as unknown as Worker
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === editingWorker.id
            ? {
                ...w,
                ...updatedWorker,
              }
            : w,
        ),
      )
      setIsEditOpen(false)
      setEditingWorker(null)
      router.refresh()
      toast.success("Trabajador actualizado")
    })
  }

  const handleDeleteWorker = (worker: Worker) => {
    if (!confirm(`¿Estas seguro de eliminar a ${worker.first_name} ${worker.last_name}?`)) {
      return
    }

    startTransition(async () => {
      await deleteWorker(worker.id)
      setWorkers((prev) => prev.filter((w) => w.id !== worker.id))
      router.refresh()
    })
  }

  const stats = {
    total: workers.length,
    completos: workers.filter((p) => getDocStatus(p) === "completo").length,
    incompletos: workers.filter((p) => getDocStatus(p) === "incompleto").length,
    criticos: workers.filter((p) => getDocStatus(p) === "critico").length,
    admonitions: workers.reduce((acc, w) => acc + Number(w.admonitions_count || 0), 0),
  }

  if (!mounted) return null
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Personal</h1>
          <p className="text-muted-foreground">Gestiona el personal y su documentacion</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Agregar Personal
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Agregar Personal</DialogTitle>
              <DialogDescription>Registra un nuevo trabajador en el sistema</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <Label htmlFor="rut">RUT *</Label>
                <Input
                  id="rut"
                  value={newWorker.rut}
                  onChange={(e) => setNewWorker({ ...newWorker, rut: e.target.value })}
                  placeholder="12.345.678-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="first_name">Nombre *</Label>
                  <Input
                    id="first_name"
                    value={newWorker.first_name}
                    onChange={(e) => setNewWorker({ ...newWorker, first_name: e.target.value })}
                    placeholder="Juan"
                  />
                </div>
                <div>
                  <Label htmlFor="last_name">Apellido *</Label>
                  <Input
                    id="last_name"
                    value={newWorker.last_name}
                    onChange={(e) => setNewWorker({ ...newWorker, last_name: e.target.value })}
                    placeholder="Perez"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="role">Cargo</Label>
                  <Input
                    id="role"
                    value={newWorker.role}
                    onChange={(e) => setNewWorker({ ...newWorker, role: e.target.value })}
                    placeholder="Electricista"
                  />
                </div>
                <div>
                  <Label htmlFor="company">Empresa</Label>
                  <Input
                    id="company"
                    value={newWorker.company}
                    onChange={(e) => setNewWorker({ ...newWorker, company: e.target.value })}
                    placeholder="Constructora XYZ"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="phone">Telefono</Label>
                  <Input
                    id="phone"
                    value={newWorker.phone}
                    onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })}
                    placeholder="+56 9 1234 5678"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newWorker.email}
                    onChange={(e) => setNewWorker({ ...newWorker, email: e.target.value })}
                    placeholder="juan@email.com"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateWorker} disabled={isPending}>
                {isPending ? "Guardando..." : "Agregar Personal"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Editar Personal</DialogTitle>
            <DialogDescription>Modifica los datos del trabajador</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="edit_rut">RUT *</Label>
              <Input
                id="edit_rut"
                value={editForm.rut}
                onChange={(e) => setEditForm({ ...editForm, rut: e.target.value })}
                placeholder="12.345.678-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_first_name">Nombre *</Label>
                <Input
                  id="edit_first_name"
                  value={editForm.first_name}
                  onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                  placeholder="Juan"
                />
              </div>
              <div>
                <Label htmlFor="edit_last_name">Apellido *</Label>
                <Input
                  id="edit_last_name"
                  value={editForm.last_name}
                  onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                  placeholder="Perez"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_role">Cargo</Label>
                <Input
                  id="edit_role"
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  placeholder="Electricista"
                />
              </div>
              <div>
                <Label htmlFor="edit_company">Empresa</Label>
                <Input
                  id="edit_company"
                  value={editForm.company}
                  onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                  placeholder="Constructora XYZ"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_phone">Telefono</Label>
                <Input
                  id="edit_phone"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="+56 9 1234 5678"
                />
              </div>
              <div>
                <Label htmlFor="edit_email">Email</Label>
                <Input
                  id="edit_email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="juan@email.com"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateWorker} disabled={isPending}>
              {isPending ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 sm:grid-cols-5">
        <Card
          onClick={() => setTimelineMetric("total")}
          className={timelineMetric === "total" ? "border-primary" : ""}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card
          onClick={() => setTimelineMetric("complete")}
          className={timelineMetric === "complete" ? "border-primary" : ""}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Doc. Completa</p>
                <p className="text-2xl font-bold text-success">{stats.completos}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card
          onClick={() => setTimelineMetric("incomplete")}
          className={timelineMetric === "incomplete" ? "border-primary" : ""}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Incompletos</p>
                <p className="text-2xl font-bold text-warning">{stats.incompletos}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>
        <Card
          onClick={() => setTimelineMetric("critical")}
          className={timelineMetric === "critical" ? "border-primary" : ""}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Criticos</p>
                <p className="text-2xl font-bold text-destructive">{stats.criticos}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card
          onClick={() => setTimelineMetric("admonitions")}
          className={timelineMetric === "admonitions" ? "border-primary" : ""}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Cartas de amonestación</p>
                <p className="text-2xl font-bold">{stats.admonitions}</p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            {timelineMetric === "total" && "Evolución de trabajadores totales"}
            {timelineMetric === "complete" && "Evolución de trabajadores con documentación completa"}
            {timelineMetric === "incomplete" && "Evolución de trabajadores incompletos"}
            {timelineMetric === "critical" && "Evolución de trabajadores críticos"}
            {timelineMetric === "admonitions" && "Evolución de cartas de amonestación"}
          </CardTitle>
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
                Sin cartas de amonestación en el periodo seleccionado
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
                  <Bar
                    dataKey={
                      timelineMetric === "total"
                        ? "total_workers"
                        : timelineMetric === "complete"
                          ? "complete_workers"
                          : timelineMetric === "incomplete"
                            ? "incomplete_workers"
                            : timelineMetric === "critical"
                              ? "critical_workers"
                              : "total_admonitions"
                    }
                    name={
                      timelineMetric === "total"
                        ? "Trabajadores"
                        : timelineMetric === "complete"
                          ? "Completos"
                          : timelineMetric === "incomplete"
                            ? "Incompletos"
                            : timelineMetric === "critical"
                              ? "Críticos"
                              : "Cartas"
                    }
                    fill="var(--color-chart-1)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, RUT o cargo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={filterExpiredDocsOnly} onCheckedChange={(v) => setFilterExpiredDocsOnly(v === true)} />
            Documentos vencidos
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={filterManyAdmonitionsOnly}
              onCheckedChange={(v) => setFilterManyAdmonitionsOnly(v === true)}
            />
            Más de 3 amonestaciones
          </label>
        </div>
      </div>

      {/* Personnel Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPersonnel.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center text-muted-foreground">No se encontro personal</CardContent>
          </Card>
        ) : (
          filteredPersonnel.map((person) => {
            const totalDocs = Number(person.valid_docs) + Number(person.expiring_docs) + Number(person.expired_docs)
            const docStatus = getDocStatus(person)

            return (
              <Card key={person.id}>
                <CardContent className="p-6">
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {getInitials(person.first_name, person.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold">
                          {person.first_name} {person.last_name}
                        </p>
                        <p className="text-sm text-muted-foreground">{person.role || "Sin cargo"}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEdit(person)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteWorker(person)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mb-4 space-y-1">
                    <p className="text-sm text-muted-foreground">RUT: {person.rut}</p>
                    {person.company && <p className="text-sm text-muted-foreground">Empresa: {person.company}</p>}
                    {person.email && <p className="text-sm text-muted-foreground">Email: {person.email}</p>}
                    {person.phone && <p className="text-sm text-muted-foreground">Tel: {person.phone}</p>}
                  </div>

                  <div className="mb-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Documentacion</span>
                      <span className="font-medium">
                        {person.valid_docs}/{totalDocs}
                      </span>
                    </div>
                    <Progress value={getDocProgress(person)} className="h-2" />
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="h-2 w-2 rounded-full bg-success" />
                      <span>{person.valid_docs} vigentes</span>
                    </div>
                    {Number(person.expiring_docs) > 0 && (
                      <div className="flex items-center gap-1">
                        <div className="h-2 w-2 rounded-full bg-warning" />
                        <span>{person.expiring_docs} por vencer</span>
                      </div>
                    )}
                    {Number(person.expired_docs) > 0 && (
                      <div className="flex items-center gap-1">
                        <div className="h-2 w-2 rounded-full bg-destructive" />
                        <span>{person.expired_docs} vencidos</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    {getStatusBadge(docStatus)}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => {
                        setActiveWorkerId(person.id)
                        setIsAdmonitionOpen(true)
                        setAdmonitionTab("create")
                        startTransition(async () => {
                          try {
                            const docs = await getDocuments(person.id)
                            setCandidateDocs((docs || []).map((d: DocumentRow) => ({ id: d.id, file_name: d.file_name, file_url: d.file_url || null })))
                            setAdmonitionForm((f) => ({ ...f, worker_id: String(person.id) }))
                          } catch {}
                        })
                      }}>
                        Registrar Amonestación
                      </Button>
                      <Button variant="outline" size="sm">
                      <FileText className="mr-2 h-4 w-4" />
                      Ver Docs
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <Dialog
        open={isAdmonitionOpen}
        onOpenChange={(v) => {
          setIsAdmonitionOpen(v)
          if (!v) setIsAdmonitionsLoading(false)
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cartas de Amonestación</DialogTitle>
            <DialogDescription>Registro, historial y aprobación</DialogDescription>
          </DialogHeader>
          <Tabs
            value={admonitionTab}
            onValueChange={(v) => {
              if (v === "create" || v === "history") setAdmonitionTab(v)
            }}
            className="space-y-4"
          >
            <TabsList>
              <TabsTrigger value="create" onClick={() => setAdmonitionTab("create")}>Registrar</TabsTrigger>
              <TabsTrigger value="history" onClick={() => setAdmonitionTab("history")}>Historial</TabsTrigger>
            </TabsList>
            <TabsContent value="create">
              <div className="grid gap-3">
                <div>
                  <Label>Empleado *</Label>
                  <Select
                    value={admonitionForm.worker_id}
                    onValueChange={(val) => setAdmonitionForm((f) => ({ ...f, worker_id: val }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un empleado" />
                    </SelectTrigger>
                    <SelectContent>
                      {workers.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {w.first_name} {w.last_name} {w.company ? `· ${w.company}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Fecha *</Label>
                    <Input
                      type="date"
                      value={admonitionForm.admonition_date}
                      onChange={(e) => setAdmonitionForm((f) => ({ ...f, admonition_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Tipo *</Label>
                    <Select
                      value={admonitionForm.admonition_type}
                      onValueChange={(val) =>
                        setAdmonitionForm((f) => ({ ...f, admonition_type: val as "verbal" | "escrita" | "suspension" }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="verbal">Verbal</SelectItem>
                        <SelectItem value="escrita">Escrita</SelectItem>
                        <SelectItem value="suspension">Suspensión</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Motivo detallado *</Label>
                  <textarea
                    className="w-full rounded border bg-background p-2 text-sm"
                    rows={6}
                    value={admonitionForm.reason}
                    onChange={(e) => setAdmonitionForm((f) => ({ ...f, reason: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Sanción</Label>
                  <Input
                    placeholder="p. ej., Advertencia escrita, suspensión 2 días"
                    value={admonitionForm.supervisor_signature || ""}
                    onChange={(e) => setAdmonitionForm((f) => ({ ...f, supervisor_signature: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Adjuntar documentos relacionados</Label>
                  <div className="grid gap-2">
                    {candidateDocs.slice(0, 10).map((d) => {
                      const selected = admonitionForm.attachments.some((a) => a.file_name === d.file_name)
                      return (
                        <div key={d.id} className="flex items-center justify-between rounded border px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">{d.file_name}</p>
                            <p className="text-xs text-muted-foreground">{d.file_url ? "Con archivo" : "Sin archivo"}</p>
                          </div>
                          <Button
                            variant={selected ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => {
                              setAdmonitionForm((f) => {
                                const next = selected
                                  ? f.attachments.filter((a) => a.file_name !== d.file_name)
                                  : [...f.attachments, { file_name: d.file_name, file_url: d.file_url, mime: null }]
                                return { ...f, attachments: next }
                              })
                            }}
                          >
                            {selected ? "Quitar" : "Agregar"}
                          </Button>
                        </div>
                      )
                    })}
                    <div className="rounded border p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <Label>Archivo</Label>
                          <Input
                            type="file"
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null
                              setNewAttachment({ file: f, file_name: f?.name || "" })
                            }}
                          />
                        </div>
                        <div>
                          <Label>Nombre del archivo</Label>
                          <Input
                            value={newAttachment.file_name}
                            onChange={(e) => setNewAttachment((prev) => ({ ...prev, file_name: e.target.value }))}
                            placeholder="nombre.ext"
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (!admonitionForm.worker_id) {
                              toast.error("Selecciona el empleado antes de subir un documento")
                              return
                            }
                            if (!newAttachment.file || !newAttachment.file_name) {
                              toast.error("Selecciona un archivo y nombre")
                              return
                            }
                            startTransition(async () => {
                              try {
                                const fileUrl = await new Promise<string>((resolve, reject) => {
                                  const reader = new FileReader()
                                  reader.onload = () => resolve(reader.result as string)
                                  reader.onerror = reject
                                  reader.readAsDataURL(newAttachment.file as File)
                                })
                                let docTypeId: number | undefined
                                const otros = await findDocumentTypeByName("Otros")
                                if (otros?.id) {
                                  docTypeId = otros.id
                                } else {
                                  const anexo = await findDocumentTypeByName("Anexo")
                                  if (anexo?.id) {
                                    docTypeId = anexo.id
                                  } else {
                                    const contrato = await findDocumentTypeByName("Contrato")
                                    if (contrato?.id) {
                                      docTypeId = contrato.id
                                    } else {
                                      const all = await getDocumentTypes()
                                      docTypeId = all[0]?.id
                                    }
                                  }
                                }
                                if (!docTypeId) {
                                  toast.error("No hay tipos de documento disponibles")
                                  return
                                }
                                const created = await createDocument({
                                  worker_id: Number(admonitionForm.worker_id),
                                  document_type_id: docTypeId,
                                  file_name: newAttachment.file_name,
                                  file_url: fileUrl,
                                })
                                setCandidateDocs((prev) => [{ id: created.id, file_name: created.file_name, file_url: created.file_url || null }, ...prev])
                                setAdmonitionForm((f) => ({
                                  ...f,
                                  attachments: [{ file_name: created.file_name, file_url: created.file_url || null, mime: null }, ...f.attachments],
                                }))
                                setNewAttachment({ file: null, file_name: "" })
                                toast.success("Documento subido y adjuntado")
                              } catch {
                                toast.error("No se pudo subir el documento")
                              }
                            })
                          }}
                        >
                          Subir y adjuntar
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsAdmonitionOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => {
                      if (!admonitionForm.worker_id || !admonitionForm.admonition_date || !admonitionForm.reason) {
                        toast.error("Completa los campos obligatorios")
                        return
                      }
                      startTransition(async () => {
                        try {
                          const workerId = Number(admonitionForm.worker_id)
                          await createAdmonition({
                            worker_id: Number(admonitionForm.worker_id),
                            admonition_date: admonitionForm.admonition_date,
                            admonition_type: admonitionForm.admonition_type,
                            reason: admonitionForm.reason,
                            supervisor_signature: admonitionForm.supervisor_signature,
                            attachments: admonitionForm.attachments,
                          })
                          setWorkers((prev) =>
                            prev.map((w) =>
                              w.id === workerId
                                ? { ...w, admonitions_count: Number(w.admonitions_count || 0) + 1 }
                                : w,
                            ),
                          )
                          setActiveWorkerId(workerId)
                          toast.success("Amonestación registrada y enviada para aprobación")
                          setAdmonitionForm({
                            worker_id: admonitionForm.worker_id,
                            admonition_date: new Date().toISOString().slice(0, 10),
                            admonition_type: "verbal",
                            reason: "",
                            supervisor_signature: "",
                            attachments: [],
                          })
                          setAdmonitionFilters({
                            from: "",
                            to: "",
                            type: "todos",
                            status: "todos",
                            approval_status: "todos",
                          })
                          try {
                            const rows = await getAdmonitions({ worker_id: workerId, type: "todos", status: "todos", approval_status: "todos" })
                            setAdmonitions(normalizeAdmonitionRows(rows))
                          } catch {
                            toast.error("No se pudo actualizar el historial de amonestaciones")
                          }
                          setAdmonitionTab("history")
                        } catch {
                          toast.error("No se pudo registrar la amonestación")
                        }
                      })
                    }}
                  >
                    Guardar y enviar aprobación
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="history">
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <Label>Desde</Label>
                    <Input type="date" value={admonitionFilters.from} onChange={(e) => setAdmonitionFilters((f) => ({ ...f, from: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Hasta</Label>
                    <Input type="date" value={admonitionFilters.to} onChange={(e) => setAdmonitionFilters((f) => ({ ...f, to: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Tipo</Label>
                    <Select
                      value={admonitionFilters.type}
                      onValueChange={(v) => {
                        if (v === "todos" || v === "verbal" || v === "escrita" || v === "suspension") {
                          setAdmonitionFilters((f) => ({ ...f, type: v }))
                        }
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="verbal">Verbal</SelectItem>
                        <SelectItem value="escrita">Escrita</SelectItem>
                        <SelectItem value="suspension">Suspensión</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Estado</Label>
                    <Select
                      value={admonitionFilters.status}
                      onValueChange={(v) => {
                        if (v === "todos" || v === "active" || v === "archived" || v === "archivada") {
                          setAdmonitionFilters((f) => ({ ...f, status: v }))
                        }
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="active">Activa</SelectItem>
                        <SelectItem value="archived">Archivada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Aprobación</Label>
                  <Select
                    value={admonitionFilters.approval_status}
                    onValueChange={(v) => {
                      if (v === "todos" || v === "pending" || v === "approved" || v === "rejected") {
                        setAdmonitionFilters((f) => ({ ...f, approval_status: v }))
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Aprobación" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="pending">Pendiente</SelectItem>
                      <SelectItem value="approved">Aprobada</SelectItem>
                      <SelectItem value="rejected">Rechazada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsAdmonitionsLoading(true)
                      startTransition(async () => {
                        try {
                          const rows = await getAdmonitions({
                            worker_id: activeWorkerId || undefined,
                            from: admonitionFilters.from || undefined,
                            to: admonitionFilters.to || undefined,
                            type: admonitionFilters.type,
                            status: admonitionFilters.status,
                            approval_status: admonitionFilters.approval_status,
                          })
                          setAdmonitions(normalizeAdmonitionRows(rows))
                        } catch {}
                        setIsAdmonitionsLoading(false)
                      })
                    }}
                  >
                    Aplicar filtros
                  </Button>
                </div>
                <div className="grid gap-2">
                  {isAdmonitionsLoading ? (
                    <Card><CardContent className="p-4 text-center text-muted-foreground">Cargando...</CardContent></Card>
                  ) : admonitions.length === 0 ? (
                    <Card><CardContent className="p-4 text-center text-muted-foreground">Sin amonestaciones</CardContent></Card>
                  ) : (
                    admonitions.map((a) => (
                      <Card key={a.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">
                                #{a.id} · {a.first_name} {a.last_name} · {a.company || "Sin empresa"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {a.admonition_date} · {a.admonition_type} · {a.approval_status} · {a.status}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  startTransition(async () => {
                                    try {
                                      const ok = window.confirm(`Eliminar amonestación #${a.id}?`)
                                      if (!ok) return
                                      await deleteAdmonition(a.id)
                                      setAdmonitions((prev) => prev.filter((row) => row.id !== a.id))
                                      toast.success("Amonestación eliminada")
                                    } catch {}
                                  })
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar
                              </Button>
                            </div>
                          </div>
                          <p className="mt-2 text-sm">{a.reason}</p>
                          {Array.isArray(a.attachments) && a.attachments.length > 0 ? (
                            <div className="mt-2 grid gap-2">
                              {a.attachments.map((att, idx) => (
                                <div key={idx} className="text-xs text-muted-foreground">
                                  {att.file_name} {att.file_url ? "· archivo adjunto" : ""}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
          </DialogContent>
        </Dialog>
      </div>
  )
}
