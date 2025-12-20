"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus, FileText } from "lucide-react"
import { createProject } from "@/app/actions/projects"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

type ProjectRow = {
  id: number
  name: string
  location: string | null
  client: string | null
  start_date: string | null
  end_date: string | null
  status: string
  worker_count?: number
  open_findings?: number
}

 

export function ProjectsContent({ initialProjects }: { initialProjects: ProjectRow[] }) {
  const [projects, setProjects] = useState<ProjectRow[]>(initialProjects)
  const [isPending, startTransition] = useTransition()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newProject, setNewProject] = useState({
    name: "",
    location: "",
    client: "",
    start_date: "",
    end_date: "",
  })
  const [openingProjectId, setOpeningProjectId] = useState<number | null>(null)
  const router = useRouter()
  
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("es-CL")
  }

  const handleCreate = () => {
    if (!newProject.name.trim()) {
      toast.error("El nombre del proyecto es requerido")
      return
    }
    startTransition(async () => {
      try {
        const created = await createProject({
          name: newProject.name.trim(),
          location: newProject.location || undefined,
          client: newProject.client || undefined,
          start_date: newProject.start_date || undefined,
          end_date: newProject.end_date || undefined,
        })
        const row: ProjectRow = created as unknown as ProjectRow
        setProjects((prev) => [{ ...row, worker_count: 0, open_findings: 0 }, ...prev])
        setNewProject({ name: "", location: "", client: "", start_date: "", end_date: "" })
        setIsCreateOpen(false)
        toast.success("Proyecto creado")
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error al crear proyecto"
        toast.error(msg)
      }
    })
  }

  const openProject = (id: number) => {
    setOpeningProjectId(id)
    setTimeout(() => {
      router.push(`/proyectos/${id}/planos`)
    }, 350)
  }
 
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Proyectos</h1>
          <p className="text-muted-foreground">Selecciona un proyecto o crea uno nuevo</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Proyecto
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Crear Proyecto</DialogTitle>
              <DialogDescription>Define los datos del proyecto</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div>
                <Label htmlFor="proj_name">Nombre *</Label>
                <Input id="proj_name" value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="proj_location">Ubicación</Label>
                  <Input id="proj_location" value={newProject.location} onChange={(e) => setNewProject({ ...newProject, location: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="proj_client">Cliente</Label>
                  <Input id="proj_client" value={newProject.client} onChange={(e) => setNewProject({ ...newProject, client: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="proj_start">Inicio</Label>
                  <Input id="proj_start" type="date" value={newProject.start_date} onChange={(e) => setNewProject({ ...newProject, start_date: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="proj_end">Fin</Label>
                  <Input id="proj_end" type="date" value={newProject.end_date} onChange={(e) => setNewProject({ ...newProject, end_date: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={isPending}>
                {isPending ? "Creando..." : "Crear"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {projects.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center text-muted-foreground">No hay proyectos</CardContent>
          </Card>
        ) : (
          projects.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">#{p.id}</span>
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button variant="outline" className="w-full bg-transparent" onClick={() => openProject(p.id)}>
                    <FileText className="mr-2 h-4 w-4" />
                    Documentos del proyecto
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      {openingProjectId !== null && (
        <div
          className="fixed inset-0 z-50 bg-background/80 transition-opacity"
          style={{ opacity: 1, transitionDuration: "400ms" }}
        />
      )}
      
    </div>
  )
}
