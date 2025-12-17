"use client"

import { useState, useTransition } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Search, Plus, Users, CheckCircle, AlertCircle, FileText, Edit2, Trash2 } from "lucide-react"
import { createWorker, updateWorker, deleteWorker } from "@/app/actions/workers"
import { useRouter } from "next/navigation"

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
}

export function PersonnelContent({ initialWorkers }: { initialWorkers: Worker[] }) {
  const [search, setSearch] = useState("")
  const [workers, setWorkers] = useState<Worker[]>(initialWorkers)
  const [isPending, startTransition] = useTransition()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const router = useRouter()

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

  const filteredPersonnel = workers.filter(
    (p) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      p.rut.includes(search) ||
      (p.role?.toLowerCase() || "").includes(search.toLowerCase()),
  )

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
      alert("RUT, nombre y apellido son requeridos")
      return
    }

    startTransition(async () => {
      const created = await createWorker({
        rut: newWorker.rut,
        first_name: newWorker.first_name,
        last_name: newWorker.last_name,
        role: newWorker.role || undefined,
        company: newWorker.company || undefined,
        phone: newWorker.phone || undefined,
        email: newWorker.email || undefined,
      })

      setWorkers((prev) => [
        {
          ...(created as unknown as Worker),
          valid_docs: 0,
          expiring_docs: 0,
          expired_docs: 0,
          project_name: null,
        } as Worker,
        ...prev,
      ])
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
      alert("RUT, nombre y apellido son requeridos")
      return
    }

    startTransition(async () => {
      const updated = await updateWorker(editingWorker.id, {
        rut: editForm.rut,
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
  }

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

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
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
        <Card>
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
        <Card>
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
        <Card>
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
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, RUT o cargo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
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
                    <Button variant="outline" size="sm">
                      <FileText className="mr-2 h-4 w-4" />
                      Ver Docs
                    </Button>
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
