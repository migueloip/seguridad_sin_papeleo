"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Search, Filter, Download, Eye, FileText, AlertCircle, CheckCircle, Clock, Plus, Upload, Trash2, Edit } from "lucide-react"
import { createDocument, deleteDocument, updateDocument } from "@/app/actions/documents"
import { useRouter } from "next/navigation"
import Link from "next/link"

interface Document {
  id: number
  worker_id: number
  document_type_id: number
  file_name: string
  file_url: string | null
  issue_date: string | null
  expiry_date: string | null
  status: string
  first_name: string
  last_name: string
  rut: string
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

export function DocumentsContent({
  initialDocuments,
  workers = [],
  documentTypes = [],
}: {
  initialDocuments: Document[]
  workers?: Worker[]
  documentTypes?: DocumentType[]
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

  const [newDocument, setNewDocument] = useState({
    worker_id: "",
    document_type_id: "",
    file_name: "",
    issue_date: "",
    expiry_date: "",
    file: null as File | null,
  })

  const filteredDocuments = documents.filter((doc) => {
    const fullName = `${doc.first_name} ${doc.last_name}`.toLowerCase()
    const matchesSearch =
      fullName.includes(search.toLowerCase()) ||
      (doc.document_type?.toLowerCase() || "").includes(search.toLowerCase()) ||
      doc.rut.includes(search)

    const matchesFilter = filter === "todos" || doc.status === filter

    return matchesSearch && matchesFilter
  })

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("es-CL")
  }

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
        ...(created as Document),
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
        document_type_id: editDoc.document_type_id,
        issue_date: editDoc.issue_date || undefined,
        expiry_date: editDoc.expiry_date || undefined,
      })
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)))
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
          <Button asChild>
            <Link href="/subir">
              <Upload className="mr-2 h-4 w-4" />
              Subir con OCR
            </Link>
          </Button>
        </div>
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

      {/* Filters */}
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
                      <TableCell>{doc.rut}</TableCell>
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
                  <p className="font-medium">{viewDoc.rut}</p>
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
                  value={String(editDoc.document_type_id)}
                  onValueChange={(value) => setEditDoc({ ...editDoc, document_type_id: Number.parseInt(value) })}
                >
                  <SelectTrigger>
                    <SelectValue />
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
    </div>
  )
}
