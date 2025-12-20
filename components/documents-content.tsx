"use client"

import { useState, useTransition, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Search,
  Filter,
  Download,
  Eye,
  FileText,
  AlertCircle,
  CheckCircle,
  Clock,
  Plus,
  Upload,
  Trash2,
  Edit,
  Sparkles,
} from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import {
  createDocument,
  deleteDocument,
  updateDocument,
  getDocumentsTimeline,
  getDocumentAnalytics,
  getMobileDocumentCandidates,
  createDocumentFromMobilePhoto,
  getMobilePhoto,
  extractDocumentDataFromMobilePhoto,
  deleteMobilePhoto,
} from "@/app/actions/documents"
import { UploadContent } from "@/components/upload-content"
import { useRouter } from "next/navigation"

interface Document {
  id: number
  worker_id: number
  document_type_id: number | null
  file_name: string
  file_url: string | null
  issue_date: string | null
  expiry_date: string | null
  status: string
  first_name: string
  last_name: string
  rut: string | null
  document_type: string
  extracted_data?: Record<string, unknown> | null
}

interface Worker {
  id: number
  first_name: string
  last_name: string
  rut: string
}

interface DocumentType {
  id: number
  name: string
}

interface MobileDocumentCandidate {
  mobile_document_id: number
  photo_index: number
  project_name: string | null
  title: string
  description: string | null
  created_at: string
  file_name: string
}

type DocumentsTimelinePoint = {
  label: string
  issued: number
  expiry: number
}

type DocumentsAnalyticsState = {
  total: number
  valid: number
  expiring: number
  expired: number
  no_expiry: number
  avg_days_to_expiry: number | null
  avg_days_expired: number | null
  top_types: Array<{
    name: string
    total: number
    expired: number
    expiring: number
  }>
  oldest_expired: {
    id: number
    file_name: string
    worker_name: string
    document_type: string
    expiry_date: string
    days_expired: number
  } | null
}

type DocumentsTab = "main" | "scan" | "mobile"

export function DocumentsContent({
  initialDocuments,
  workers = [],
  documentTypes = [],
  projectId,
}: {
  initialDocuments: Document[]
  workers?: Worker[]
  documentTypes?: DocumentType[]
  projectId?: number
}) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<string>("todos")
  const [documents, setDocuments] = useState(initialDocuments)
  const [isPending, startTransition] = useTransition()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const router = useRouter()
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [viewDoc, setViewDoc] = useState<Document | null>(null)
  const [editDoc, setEditDoc] = useState<Document | null>(null)
  const [timelineMode, setTimelineMode] = useState<"day" | "week" | "month">("week")
  const [timelineData, setTimelineData] = useState<DocumentsTimelinePoint[]>([])
  const [isTimelineLoading, setIsTimelineLoading] = useState(false)
  const [analytics, setAnalytics] = useState<DocumentsAnalyticsState | null>(null)
  const [tab, setTab] = useState<DocumentsTab>("main")
  const [mobileDocuments, setMobileDocuments] = useState<MobileDocumentCandidate[]>([])
  const [isMobileLoading, setIsMobileLoading] = useState(false)
  const [mobilePreview, setMobilePreview] = useState<{
    candidate: MobileDocumentCandidate
    imageUrl: string
  } | null>(null)
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false)
  const [isMobilePreviewLoading, setIsMobilePreviewLoading] = useState(false)
  const [mobileManualCandidate, setMobileManualCandidate] = useState<MobileDocumentCandidate | null>(null)
  const [isMobileManualOpen, setIsMobileManualOpen] = useState(false)
  const [mobileManualForm, setMobileManualForm] = useState<{
    worker_id: string
    document_type_id: string
    issue_date: string
    expiry_date: string
    file_name: string
  }>({
    worker_id: "",
    document_type_id: "",
    issue_date: "",
    expiry_date: "",
    file_name: "",
  })
  const [isMobileManualSaving, setIsMobileManualSaving] = useState(false)
  const [mobileAiCandidate, setMobileAiCandidate] = useState<MobileDocumentCandidate | null>(null)
  const [isMobileAiOpen, setIsMobileAiOpen] = useState(false)
  const [isMobileAiLoading, setIsMobileAiLoading] = useState(false)
  const [isMobileAiSaving, setIsMobileAiSaving] = useState(false)
  const [mobileAiForm, setMobileAiForm] = useState<{
    worker_id: string
    document_type_id: string
    issue_date: string
    expiry_date: string
    file_name: string
    rut: string
    nombre: string
    tipoDocumento: string
    empresa: string
    cargo: string
  }>({
    worker_id: "",
    document_type_id: "",
    issue_date: "",
    expiry_date: "",
    file_name: "",
    rut: "",
    nombre: "",
    tipoDocumento: "",
    empresa: "",
    cargo: "",
  })

  const [newDocument, setNewDocument] = useState({
    worker_id: "",
    document_type_id: "",
    file_name: "",
    issue_date: "",
    expiry_date: "",
    file: null as File | null,
  })

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getDocumentAnalytics(projectId)
        setAnalytics(result as DocumentsAnalyticsState)
      } catch {}
    })
  }, [projectId, startTransition])

  useEffect(() => {
    setIsTimelineLoading(true)
    startTransition(async () => {
      try {
        const rows = await getDocumentsTimeline(timelineMode, projectId)
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
            issued: r.issued_count,
            expiry: r.expiry_count,
          })),
        )
      } catch {}
      setIsTimelineLoading(false)
    })
  }, [timelineMode, projectId, startTransition])

  useEffect(() => {
    if (tab !== "mobile") return
    setIsMobileLoading(true)
    startTransition(async () => {
      try {
        const rows = await getMobileDocumentCandidates(projectId)
        setMobileDocuments((rows || []) as MobileDocumentCandidate[])
      } catch {
      }
      setIsMobileLoading(false)
    })
  }, [tab, projectId, startTransition])

  const filteredDocuments = documents.filter((doc) => {
    const fullName = `${doc.first_name} ${doc.last_name}`.toLowerCase()
    const matchesSearch =
      fullName.includes(search.toLowerCase()) ||
      (doc.document_type?.toLowerCase() || "").includes(search.toLowerCase()) ||
      (doc.rut || "").includes(search)

    const matchesFilter = filter === "todos" || doc.status === filter

    return matchesSearch && matchesFilter
  })

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("es-CL")
  }

  const parseAiDate = (value: string | null | undefined) => {
    if (!value) return ""
    const parts = value.split(/[\/\-]/)
    if (parts.length === 3) {
      const [a, b, c] = parts
      if (c.length === 4) {
        const day = a.padStart(2, "0")
        const month = b.padStart(2, "0")
        return `${c}-${month}-${day}`
      }
    }
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10)
    }
    return ""
  }

  const mobileKey = (c: MobileDocumentCandidate) => `${c.mobile_document_id}:${c.photo_index}`

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "valid":
        return (
          <Badge className="bg-success text-success-foreground">
            <CheckCircle className="mr-1 h-3 w-3" />
            Vigente
          </Badge>
        )
      case "expiring":
        return (
          <Badge className="bg-warning text-warning-foreground">
            <Clock className="mr-1 h-3 w-3" />
            Por Vencer
          </Badge>
        )
      case "expired":
        return (
          <Badge variant="destructive">
            <AlertCircle className="mr-1 h-3 w-3" />
            Vencido
          </Badge>
        )
      default:
        return <Badge variant="secondary">Desconocido</Badge>
    }
  }

  const handleCreateDocument = () => {
    if (!newDocument.worker_id || !newDocument.document_type_id || !newDocument.file_name) {
      alert("Trabajador, tipo de documento y nombre de archivo son requeridos")
      return
    }

    startTransition(async () => {
      let fileUrl: string | undefined
      if (newDocument.file) {
        fileUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(newDocument.file!)
        })
      }
      const created = await createDocument({
        worker_id: Number.parseInt(newDocument.worker_id),
        document_type_id: Number.parseInt(newDocument.document_type_id),
        file_name: newDocument.file_name,
        file_url: fileUrl,
        issue_date: newDocument.issue_date || undefined,
        expiry_date: newDocument.expiry_date || undefined,
      })

      // Find worker and document type names for display
      const worker = workers.find((w) => w.id === Number.parseInt(newDocument.worker_id))
      const docType = documentTypes.find((dt) => dt.id === Number.parseInt(newDocument.document_type_id))

      const newDoc: Document = {
        ...(created as unknown as Document),
        first_name: worker?.first_name || "",
        last_name: worker?.last_name || "",
        rut: worker?.rut || "",
        document_type: docType?.name || "",
      }
      setDocuments((prev) => [newDoc, ...prev])
      setNewDocument({
        worker_id: "",
        document_type_id: "",
        file_name: "",
        issue_date: "",
        expiry_date: "",
        file: null,
      })
      setIsCreateOpen(false)
      router.refresh()
    })
  }

  const handleViewMobilePhoto = (candidate: MobileDocumentCandidate) => {
    setIsMobilePreviewOpen(true)
    setIsMobilePreviewLoading(true)
    startTransition(async () => {
      try {
        const url = await getMobilePhoto(candidate.mobile_document_id, candidate.photo_index)
        if (url) {
          setMobilePreview({
            candidate,
            imageUrl: url,
          })
        } else {
          setMobilePreview(null)
          alert("No se pudo cargar la imagen")
        }
      } finally {
        setIsMobilePreviewLoading(false)
      }
    })
  }

  const openMobileManualDialog = (candidate: MobileDocumentCandidate) => {
    setMobileManualCandidate(candidate)
    setMobileManualForm({
      worker_id: "",
      document_type_id: "",
      issue_date: "",
      expiry_date: "",
      file_name: candidate.file_name,
    })
    setIsMobileManualOpen(true)
  }

  const handleSaveMobileManual = () => {
    if (!mobileManualCandidate) return
    if (!mobileManualForm.worker_id || !mobileManualForm.document_type_id || !mobileManualForm.file_name) {
      alert("Trabajador, tipo de documento y nombre de archivo son requeridos")
      return
    }
    const key = mobileKey(mobileManualCandidate)
    startTransition(async () => {
      setIsMobileManualSaving(true)
      try {
        const created = await createDocumentFromMobilePhoto({
          mobile_document_id: mobileManualCandidate.mobile_document_id,
          photo_index: mobileManualCandidate.photo_index,
          worker_id: Number.parseInt(mobileManualForm.worker_id),
          document_type_id: Number.parseInt(mobileManualForm.document_type_id),
          issue_date: mobileManualForm.issue_date || undefined,
          expiry_date: mobileManualForm.expiry_date || undefined,
          file_name: mobileManualForm.file_name,
        })
        const worker = workers.find((w) => w.id === Number.parseInt(mobileManualForm.worker_id))
        const docType = documentTypes.find(
          (dt) => dt.id === Number.parseInt(mobileManualForm.document_type_id),
        )
        const newDoc: Document = {
          ...(created as unknown as Document),
          first_name: worker?.first_name || "",
          last_name: worker?.last_name || "",
          rut: worker?.rut || "",
          document_type: docType?.name || "",
        }
        setDocuments((prev) => [newDoc, ...prev])
        setMobileDocuments((prev) => prev.filter((c) => mobileKey(c) !== key))
        setIsMobileManualOpen(false)
        setMobileManualCandidate(null)
      } finally {
        setIsMobileManualSaving(false)
      }
    })
  }

  const openMobileAiDialog = (candidate: MobileDocumentCandidate) => {
    setMobileAiCandidate(candidate)
    setMobileAiForm({
      worker_id: "",
      document_type_id: "",
      issue_date: "",
      expiry_date: "",
      file_name: candidate.file_name,
      rut: "",
      nombre: "",
      tipoDocumento: "",
      empresa: "",
      cargo: "",
    })
    setIsMobileAiOpen(true)
    setIsMobileAiLoading(true)
    startTransition(async () => {
      try {
        const data = await extractDocumentDataFromMobilePhoto({
          mobile_document_id: candidate.mobile_document_id,
          photo_index: candidate.photo_index,
        })
        setMobileAiForm((prev) => ({
          ...prev,
          rut: data.rut || "",
          nombre: data.nombre || "",
          tipoDocumento: data.tipoDocumento || "",
          empresa: data.empresa || "",
          cargo: data.cargo || "",
          issue_date: parseAiDate(data.fechaEmision),
          expiry_date: parseAiDate(data.fechaVencimiento),
        }))
      } finally {
        setIsMobileAiLoading(false)
      }
    })
  }

  const handleSaveMobileAi = () => {
    if (!mobileAiCandidate) return
    if (!mobileAiForm.worker_id || !mobileAiForm.document_type_id || !mobileAiForm.file_name) {
      alert("Trabajador, tipo de documento y nombre de archivo son requeridos")
      return
    }
    const key = mobileKey(mobileAiCandidate)
    const extracted = {
      rut: mobileAiForm.rut || null,
      nombre: mobileAiForm.nombre || null,
      fechaEmision: mobileAiForm.issue_date || null,
      fechaVencimiento: mobileAiForm.expiry_date || null,
      tipoDocumento: mobileAiForm.tipoDocumento || null,
      empresa: mobileAiForm.empresa || null,
      cargo: mobileAiForm.cargo || null,
    }
    startTransition(async () => {
      setIsMobileAiSaving(true)
      try {
        const created = await createDocumentFromMobilePhoto({
          mobile_document_id: mobileAiCandidate.mobile_document_id,
          photo_index: mobileAiCandidate.photo_index,
          worker_id: Number.parseInt(mobileAiForm.worker_id),
          document_type_id: Number.parseInt(mobileAiForm.document_type_id),
          issue_date: mobileAiForm.issue_date || undefined,
          expiry_date: mobileAiForm.expiry_date || undefined,
          file_name: mobileAiForm.file_name,
          extracted_data: extracted,
        })
        const worker = workers.find((w) => w.id === Number.parseInt(mobileAiForm.worker_id))
        const docType = documentTypes.find(
          (dt) => dt.id === Number.parseInt(mobileAiForm.document_type_id),
        )
        const newDoc: Document = {
          ...(created as unknown as Document),
          first_name: worker?.first_name || "",
          last_name: worker?.last_name || "",
          rut: worker?.rut || "",
          document_type: docType?.name || "",
        }
        setDocuments((prev) => [newDoc, ...prev])
        setMobileDocuments((prev) => prev.filter((c) => mobileKey(c) !== key))
        setIsMobileAiOpen(false)
        setMobileAiCandidate(null)
      } finally {
        setIsMobileAiSaving(false)
      }
    })
  }

  const handleDeleteMobileCandidate = (candidate: MobileDocumentCandidate) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("¿Seguro que quieres eliminar esta foto desde el teléfono?")
    ) {
      return
    }
    const key = mobileKey(candidate)
    startTransition(async () => {
      try {
        await deleteMobilePhoto({
          mobile_document_id: candidate.mobile_document_id,
          photo_index: candidate.photo_index,
        })
        setMobileDocuments((prev) => prev.filter((c) => mobileKey(c) !== key))
      } catch {
      }
    })
  }

  const handleView = (doc: Document) => {
    setViewDoc(doc)
    setIsViewOpen(true)
  }

  const handleDownloadData = (doc: Document) => {
    const payload = {
      rut: doc.rut,
      nombre: `${doc.first_name} ${doc.last_name}`.trim(),
      tipoDocumento: doc.document_type,
      fechaEmision: doc.issue_date,
      fechaVencimiento: doc.expiry_date,
      extracted: doc.extracted_data || null,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${doc.file_name.replace(/\.[^/.]+$/, "")}-datos.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = (docId: number) => {
    startTransition(async () => {
      await deleteDocument(docId)
      setDocuments((prev) => prev.filter((d) => d.id !== docId))
      router.refresh()
    })
  }

  const handleOpenEdit = (doc: Document) => {
    setEditDoc(doc)
    setIsEditOpen(true)
  }

  const handleSaveEdit = () => {
    if (!editDoc) return
    startTransition(async () => {
      const updated = await updateDocument(editDoc.id, {
        worker_id: editDoc.worker_id,
        document_type_id: editDoc.document_type_id ?? undefined,
        issue_date: editDoc.issue_date || undefined,
        expiry_date: editDoc.expiry_date || undefined,
      })
      const updatedDoc = updated as unknown as Document
      setDocuments((prev) => prev.map((d) => (d.id === updatedDoc.id ? { ...d, ...updatedDoc } : d)))
      setIsEditOpen(false)
      setEditDoc(null)
      router.refresh()
    })
  }

  const stats = {
    total: documents.length,
    vigentes: documents.filter((d) => d.status === "valid").length,
    porVencer: documents.filter((d) => d.status === "expiring").length,
    vencidos: documents.filter((d) => d.status === "expired").length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Documentos</h1>
          <p className="text-muted-foreground">Gestiona todos los documentos del personal</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Agregar Manual
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Agregar Documento</DialogTitle>
                <DialogDescription>Registra un nuevo documento manualmente</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div>
                  <Label htmlFor="worker">Trabajador *</Label>
                  <Select
                    value={newDocument.worker_id}
                    onValueChange={(value) => setNewDocument({ ...newDocument, worker_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un trabajador" />
                    </SelectTrigger>
                    <SelectContent>
                      {workers.map((worker) => (
                        <SelectItem key={worker.id} value={worker.id.toString()}>
                          {worker.first_name} {worker.last_name} - {worker.rut}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="doc_type">Tipo de Documento *</Label>
                  <Select
                    value={newDocument.document_type_id}
                    onValueChange={(value) => setNewDocument({ ...newDocument, document_type_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona el tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {documentTypes.map((docType) => (
                        <SelectItem key={docType.id} value={docType.id.toString()}>
                          {docType.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="file_name">Nombre del Archivo *</Label>
                  <Input
                    id="file_name"
                    value={newDocument.file_name}
                    onChange={(e) => setNewDocument({ ...newDocument, file_name: e.target.value })}
                    placeholder="documento.pdf"
                  />
                </div>
                <div>
                  <Label htmlFor="file_upload">Subir Archivo</Label>
                  <Input
                    id="file_upload"
                    type="file"
                    onChange={(e) => setNewDocument({ ...newDocument, file: e.target.files?.[0] || null })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="issue_date">Fecha de Emision</Label>
                    <Input
                      id="issue_date"
                      type="date"
                      value={newDocument.issue_date}
                      onChange={(e) => setNewDocument({ ...newDocument, issue_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="expiry_date">Fecha de Vencimiento</Label>
                    <Input
                      id="expiry_date"
                      type="date"
                      value={newDocument.expiry_date}
                      onChange={(e) => setNewDocument({ ...newDocument, expiry_date: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateDocument} disabled={isPending}>
                  {isPending ? "Guardando..." : "Agregar Documento"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button type="button" variant="outline" onClick={() => setTab("scan")}>
            <Upload className="mr-2 h-4 w-4" />
            Documentos escaneados
          </Button>
          <Button type="button" variant="outline" onClick={() => setTab("mobile")}>
            <Upload className="mr-2 h-4 w-4" />
            Desde teléfono
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as DocumentsTab)} className="space-y-6">
        <TabsList>
          <TabsTrigger value="main">Documentos</TabsTrigger>
          <TabsTrigger value="scan">Documentos escaneados</TabsTrigger>
          <TabsTrigger value="mobile">Desde teléfono</TabsTrigger>
        </TabsList>
        <TabsContent value="main" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold">{stats.total}</p>
                  </div>
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Vigentes</p>
                    <p className="text-2xl font-bold text-success">{stats.vigentes}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-success" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Por Vencer</p>
                    <p className="text-2xl font-bold text-warning">{stats.porVencer}</p>
                  </div>
                  <Clock className="h-8 w-8 text-warning" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Vencidos</p>
                    <p className="text-2xl font-bold text-destructive">{stats.vencidos}</p>
                  </div>
                  <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Evolución de documentos</CardTitle>
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
                    Sin documentos en el periodo seleccionado
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
                        dataKey="issued"
                        name="Emitidos"
                        fill="var(--color-chart-1)"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="expiry"
                        name="Vencimientos"
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
                    <p className="text-sm text-muted-foreground">Promedio días hasta vencimiento</p>
                    <p className="text-2xl font-bold">
                      {analytics && analytics.avg_days_to_expiry !== null
                        ? `${analytics.avg_days_to_expiry.toFixed(1)} días`
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
                    <p className="text-sm text-muted-foreground">Promedio días vencidos</p>
                    <p className="text-2xl font-bold">
                      {analytics && analytics.avg_days_expired !== null
                        ? `${analytics.avg_days_expired.toFixed(1)} días`
                        : "-"}
                    </p>
                  </div>
                  <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Sin fecha de vencimiento</p>
                    <p className="text-2xl font-bold">
                      {analytics ? analytics.no_expiry : 0}
                    </p>
                  </div>
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Tipos de documento con más vencidos</CardTitle>
              </CardHeader>
              <CardContent>
                {analytics && analytics.top_types.length > 0 ? (
                  <div className="space-y-2 text-sm">
                    {analytics.top_types.map((t, idx) => (
                      <div key={idx} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.expired} vencidos · {t.expiring} por vencer · {t.total} total
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Aún no hay datos por tipo.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Documento más antiguo vencido</CardTitle>
              </CardHeader>
              <CardContent>
                {analytics && analytics.oldest_expired ? (
                  <div className="space-y-2 text-sm">
                    <p className="font-medium">
                      #{analytics.oldest_expired.id} · {analytics.oldest_expired.file_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {analytics.oldest_expired.worker_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {analytics.oldest_expired.document_type} · Venció el {analytics.oldest_expired.expiry_date}
                    </p>
                    <p className="text-sm text-destructive">
                      Vencido hace {analytics.oldest_expired.days_expired} días
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay documentos vencidos actualmente.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Lista de Documentos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-col gap-4 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nombre, tipo o RUT..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Filtrar por estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="valid">Vigentes</SelectItem>
                    <SelectItem value="expiring">Por Vencer</SelectItem>
                    <SelectItem value="expired">Vencidos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo de Documento</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead>RUT</TableHead>
                      <TableHead>Emision</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocuments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                          No se encontraron documentos
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDocuments.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell className="font-medium">{doc.document_type || "Sin tipo"}</TableCell>
                          <TableCell>
                            {doc.first_name} {doc.last_name}
                          </TableCell>
                          <TableCell>{doc.rut || "-"}</TableCell>
                          <TableCell>{formatDate(doc.issue_date)}</TableCell>
                          <TableCell>{formatDate(doc.expiry_date)}</TableCell>
                          <TableCell>{getStatusBadge(doc.status)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(doc)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleView(doc)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDownloadData(doc)}>
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(doc.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Detalle del Documento</DialogTitle>
              </DialogHeader>
              {viewDoc && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Persona</p>
                      <p className="font-medium">{viewDoc.first_name} {viewDoc.last_name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">RUT</p>
                      <p className="font-medium">{viewDoc.rut || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tipo</p>
                      <p className="font-medium">{viewDoc.document_type || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Archivo</p>
                      <p className="font-medium">{viewDoc.file_name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Emisión</p>
                      <p className="font-medium">{formatDate(viewDoc.issue_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Vencimiento</p>
                      <p className="font-medium">{formatDate(viewDoc.expiry_date)}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="mb-2 text-sm font-medium">Datos extraídos</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Nombre</p>
                        <p className="font-medium">{String((viewDoc.extracted_data as Record<string, unknown>)?.nombre ?? "-")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Empresa</p>
                        <p className="font-medium">{String((viewDoc.extracted_data as Record<string, unknown>)?.empresa ?? "-")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Cargo</p>
                        <p className="font-medium">{String((viewDoc.extracted_data as Record<string, unknown>)?.cargo ?? "-")}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Tipo</p>
                        <p className="font-medium">{String((viewDoc.extracted_data as Record<string, unknown>)?.tipoDocumento ?? "-")}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Editar Documento</DialogTitle>
                <DialogDescription>Actualiza la asignación y fechas</DialogDescription>
              </DialogHeader>
              {editDoc && (
                <div className="grid gap-4 py-4">
                  <div>
                    <Label>Trabajador</Label>
                    <Select
                      value={String(editDoc.worker_id)}
                      onValueChange={(value) => setEditDoc({ ...editDoc, worker_id: Number.parseInt(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {workers.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>
                            {w.first_name} {w.last_name} - {w.rut}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tipo de Documento</Label>
                    <Select
                      value={editDoc.document_type_id ? String(editDoc.document_type_id) : ""}
                      onValueChange={(value) => setEditDoc({ ...editDoc, document_type_id: Number.parseInt(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {documentTypes.map((dt) => (
                          <SelectItem key={dt.id} value={String(dt.id)}>
                            {dt.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Emisión</Label>
                      <Input type="date" value={editDoc.issue_date || ""} onChange={(e) => setEditDoc({ ...editDoc, issue_date: e.target.value })} />
                    </div>
                    <div>
                      <Label>Vencimiento</Label>
                      <Input type="date" value={editDoc.expiry_date || ""} onChange={(e) => setEditDoc({ ...editDoc, expiry_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                    <Button onClick={handleSaveEdit} disabled={isPending}>{isPending ? "Guardando..." : "Guardar Cambios"}</Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>
        <TabsContent value="scan">
          <UploadContent projectId={projectId} />
        </TabsContent>
        <TabsContent value="mobile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Documentos desde teléfono</CardTitle>
            </CardHeader>
            <CardContent>
              {isMobileLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Cargando fotos desde el teléfono...
                </div>
              ) : mobileDocuments.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No hay fotos pendientes desde el teléfono.
                </div>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Proyecto</TableHead>
                        <TableHead>Nombre archivo</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mobileDocuments.map((c) => {
                        const key = mobileKey(c)
                        return (
                          <TableRow key={key}>
                            <TableCell>{formatDate(c.created_at)}</TableCell>
                            <TableCell>{c.project_name || "-"}</TableCell>
                            <TableCell>
                              <div className="max-w-[220px] truncate">{c.file_name}</div>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-[260px] truncate">{c.title || c.description || "-"}</div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleViewMobilePhoto(c)}
                                >
                                  <Eye className="mr-1 h-4 w-4" />
                                  Ver foto
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openMobileManualDialog(c)}
                                >
                                  <FileText className="mr-1 h-4 w-4" />
                                  Completar
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => openMobileAiDialog(c)}
                                  disabled={Boolean(
                                    isMobileAiLoading &&
                                      mobileAiCandidate &&
                                      mobileKey(mobileAiCandidate) === key,
                                  )}
                                >
                              <Sparkles className="mr-1 h-4 w-4" />
                              IA
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteMobileCandidate(c)}
                            >
                              <Trash2 className="mr-1 h-4 w-4 text-destructive" />
                              Eliminar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={isMobilePreviewOpen}
            onOpenChange={(open) => {
              setIsMobilePreviewOpen(open)
              if (!open) {
                setMobilePreview(null)
              }
            }}
          >
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Foto desde teléfono</DialogTitle>
              </DialogHeader>
              {isMobilePreviewLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Cargando foto...
                </div>
              ) : mobilePreview ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {mobilePreview.candidate.project_name || "Sin proyecto"} ·{" "}
                    {formatDate(mobilePreview.candidate.created_at)}
                  </p>
                  <div className="max-h-[60vh] overflow-hidden rounded-md border bg-muted">
                    <img
                      src={mobilePreview.imageUrl}
                      alt={mobilePreview.candidate.title || mobilePreview.candidate.file_name}
                      className="h-full w-full object-contain"
                    />
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No se pudo cargar la imagen.
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog
            open={isMobileManualOpen}
            onOpenChange={(open) => {
              setIsMobileManualOpen(open)
              if (!open) {
                setMobileManualCandidate(null)
              }
            }}
          >
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Crear documento desde foto</DialogTitle>
                <DialogDescription>
                  Asigna el trabajador y completa los datos del documento.
                </DialogDescription>
              </DialogHeader>
              {mobileManualCandidate && (
                <div className="grid gap-4 py-4">
                  <div>
                    <Label>Trabajador *</Label>
                    <Select
                      value={mobileManualForm.worker_id}
                      onValueChange={(value) =>
                        setMobileManualForm((prev) => ({
                          ...prev,
                          worker_id: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un trabajador" />
                      </SelectTrigger>
                      <SelectContent>
                        {workers.map((worker) => (
                          <SelectItem key={worker.id} value={worker.id.toString()}>
                            {worker.first_name} {worker.last_name}{" "}
                            {worker.rut ? `- ${worker.rut}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Tipo de documento *</Label>
                    <Select
                      value={mobileManualForm.document_type_id}
                      onValueChange={(value) =>
                        setMobileManualForm((prev) => ({
                          ...prev,
                          document_type_id: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona el tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {documentTypes.map((dt) => (
                          <SelectItem key={dt.id} value={dt.id.toString()}>
                            {dt.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Nombre del archivo *</Label>
                    <Input
                      value={mobileManualForm.file_name}
                      onChange={(e) =>
                        setMobileManualForm((prev) => ({
                          ...prev,
                          file_name: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Emisión</Label>
                      <Input
                        type="date"
                        value={mobileManualForm.issue_date}
                        onChange={(e) =>
                          setMobileManualForm((prev) => ({
                            ...prev,
                            issue_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Vencimiento</Label>
                      <Input
                        type="date"
                        value={mobileManualForm.expiry_date}
                        onChange={(e) =>
                          setMobileManualForm((prev) => ({
                            ...prev,
                            expiry_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsMobileManualOpen(false)
                        setMobileManualCandidate(null)
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSaveMobileManual}
                      disabled={isMobileManualSaving}
                    >
                      {isMobileManualSaving ? "Guardando..." : "Crear documento"}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog
            open={isMobileAiOpen}
            onOpenChange={(open) => {
              setIsMobileAiOpen(open)
              if (!open) {
                setMobileAiCandidate(null)
              }
            }}
          >
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Completar con IA</DialogTitle>
                <DialogDescription>
                  Revisar y corrige la información detectada antes de crear el documento.
                </DialogDescription>
              </DialogHeader>
              {mobileAiCandidate && (
                <div className="grid gap-4 py-4">
                  {isMobileAiLoading ? (
                    <div className="py-4 text-sm text-muted-foreground">
                      Analizando la foto con IA...
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Trabajador *</Label>
                      <Select
                        value={mobileAiForm.worker_id}
                        onValueChange={(value) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            worker_id: value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un trabajador" />
                        </SelectTrigger>
                        <SelectContent>
                          {workers.map((worker) => (
                            <SelectItem key={worker.id} value={worker.id.toString()}>
                              {worker.first_name} {worker.last_name}{" "}
                              {worker.rut ? `- ${worker.rut}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Tipo de documento *</Label>
                      <Select
                        value={mobileAiForm.document_type_id}
                        onValueChange={(value) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            document_type_id: value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona el tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          {documentTypes.map((dt) => (
                            <SelectItem key={dt.id} value={dt.id.toString()}>
                              {dt.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Nombre del archivo *</Label>
                    <Input
                      value={mobileAiForm.file_name}
                      onChange={(e) =>
                        setMobileAiForm((prev) => ({
                          ...prev,
                          file_name: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Emisión</Label>
                      <Input
                        type="date"
                        value={mobileAiForm.issue_date}
                        onChange={(e) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            issue_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Vencimiento</Label>
                      <Input
                        type="date"
                        value={mobileAiForm.expiry_date}
                        onChange={(e) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            expiry_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>RUT detectado</Label>
                      <Input
                        value={mobileAiForm.rut}
                        onChange={(e) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            rut: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Nombre detectado</Label>
                      <Input
                        value={mobileAiForm.nombre}
                        onChange={(e) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            nombre: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Tipo de documento (IA)</Label>
                      <Input
                        value={mobileAiForm.tipoDocumento}
                        onChange={(e) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            tipoDocumento: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Empresa</Label>
                      <Input
                        value={mobileAiForm.empresa}
                        onChange={(e) =>
                          setMobileAiForm((prev) => ({
                            ...prev,
                            empresa: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Cargo</Label>
                    <Input
                      value={mobileAiForm.cargo}
                      onChange={(e) =>
                        setMobileAiForm((prev) => ({
                          ...prev,
                          cargo: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsMobileAiOpen(false)
                        setMobileAiCandidate(null)
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSaveMobileAi}
                      disabled={isMobileAiSaving}
                    >
                      {isMobileAiSaving ? "Guardando..." : "Crear documento"}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  )
}
