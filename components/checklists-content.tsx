"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { useTransition, useEffect } from "react"
import { createChecklistTemplate } from "@/app/actions/checklists"

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

interface TemplateRow {
  id: number
  user_id?: number
  category_id?: number | null
  name: string
  description?: string | null
  items?: { items?: ChecklistItem[] } | null
  category_name?: string | null
}

interface CompletedRow {
  id: number
  user_id?: number
  template_id: number
  project_id?: number | null
  inspector_name: string
  location?: string | null
  responses?: Record<string, boolean | string> | null
  notes?: string | null
  completed_at: string | Date
  template_name?: string | null
  project_name?: string | null
}



export function ChecklistsContent({ templates, completed }: { templates: TemplateRow[]; completed: CompletedRow[] }) {
  const mappedFromTemplates: Checklist[] = useMemo(() => {
    return (templates || []).map((t: TemplateRow) => {
      const arr = Array.isArray(t?.items?.items) ? t.items!.items! : []
      const items: ChecklistItem[] = arr.map((it: ChecklistItem, idx: number) => ({
        id: it.id ?? `tmpl-${t.id}-${idx}`,
        text: it.text ?? String(it),
        checked: Boolean(it.checked),
        hasIssue: Boolean(it.hasIssue),
        note: it.note,
      }))
      return {
        id: String(t.id),
        title: t.name ?? "Checklist",
        sector: t.description ?? t.category_name ?? "",
        status: "pendiente",
        items,
      }
    })
  }, [templates])

  type ProgressItem = { checked: boolean; hasIssue: boolean; note?: string }
  type ProgressMap = Record<string, ProgressItem>

  const getProgress = (templateId: string): ProgressMap => {
    if (typeof window === "undefined") return {}
    const raw = localStorage.getItem(`cl-progress:${templateId}`)
    if (!raw) return {}
    try {
      const obj = JSON.parse(raw) as unknown
      if (obj && typeof obj === "object") {
        const out: ProgressMap = {}
        const entries = Object.entries(obj as Record<string, unknown>)
        for (const [k, v] of entries) {
          if (typeof k === "string" && v && typeof v === "object") {
            const r = v as Record<string, unknown>
            const checked = r["checked"]
            const hasIssue = r["hasIssue"]
            const note = r["note"]
            if (typeof checked === "boolean" && typeof hasIssue === "boolean") {
              out[k] = { checked, hasIssue, note: typeof note === "string" ? note : undefined }
            }
          }
        }
        return out
      }
      return {}
    } catch {
      return {}
    }
  }

  const setProgress = (templateId: string, map: ProgressMap) => {
    if (typeof window === "undefined") return
    localStorage.setItem(`cl-progress:${templateId}`, JSON.stringify(map))
  }

  const applyProgress = (cl: Checklist): Checklist => {
    const prog = getProgress(cl.id)
    if (!prog || Object.keys(prog).length === 0) return cl
    const items = cl.items.map((it) => {
      const p = prog[it.id]
      if (!p) return it
      return { ...it, checked: p.checked, hasIssue: p.hasIssue, note: p.note }
    })
    const status: Checklist["status"] = items.some((i) => i.checked || i.hasIssue) ? "en-progreso" : cl.status
    return { ...cl, items, status }
  }

  

  const formatCompletedAt = (dt: string | Date) => {
    const d = new Date(dt)
    const now = new Date()
    const sameDay =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    const hh = d.getHours().toString().padStart(2, "0")
    const mm = d.getMinutes().toString().padStart(2, "0")
    return sameDay ? `Hoy a las ${hh}:${mm}` : `${d.toLocaleDateString()} ${hh}:${mm}`
  }

  const mappedFromCompleted: Checklist[] = useMemo(() => {
    return (completed || []).map((c: CompletedRow) => {
      const tmpl = (templates || []).find((t: TemplateRow) => t.id === c.template_id)
      const source = Array.isArray(tmpl?.items?.items) ? tmpl!.items!.items! : []
      const responses = c?.responses || {}
      const items: ChecklistItem[] = source.map((it: ChecklistItem, idx: number) => {
        const resp = (responses as Record<string, boolean | string>)[it.id]
        const isBool = typeof resp === "boolean"
        const isStr = typeof resp === "string"
        return {
          id: it.id ?? `comp-${c.id}-${idx}`,
          text: it.text ?? String(it),
          checked: isBool ? (resp as boolean) : Boolean(it.checked ?? true),
          hasIssue: isStr ? true : Boolean(it.hasIssue),
          note: isStr ? (resp as string) : it.note,
        }
      })
      return {
        id: String(c.id),
        title: tmpl?.name ?? c.template_name ?? "Checklist",
        sector: c.location ?? tmpl?.description ?? c.project_name ?? "",
        status: "completado",
        items,
        completedAt: formatCompletedAt(c.completed_at),
      }
    })
  }, [completed, templates])

  const [checklists, setChecklists] = useState<Checklist[]>([...mappedFromTemplates, ...mappedFromCompleted])
  useEffect(() => {
    setChecklists((prev) => prev.map((cl) => (cl.status === "completado" ? cl : applyProgress(cl))))
  }, [])
  const [activeChecklist, setActiveChecklist] = useState<Checklist | null>(null)
  const [isCreating, startCreate] = useTransition()
  const [newTitle, setNewTitle] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newItemsText, setNewItemsText] = useState("EPP completo\nSeñalización visible\nExtintores en buen estado")

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
    const current = checklists.find((c) => c.id === checklistId)
    if (current && current.status !== "completado") {
      const nextItems = current.items.map((item) => (item.id === itemId ? { ...item, checked: !item.checked } : item))
      const map: ProgressMap = {}
      for (const it of nextItems) {
        map[it.id] = { checked: it.checked, hasIssue: it.hasIssue, note: it.note }
      }
      setProgress(checklistId, map)
    }
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
    const current = checklists.find((c) => c.id === checklistId)
    if (current && current.status !== "completado") {
      const nextItems = current.items.map((item) => (item.id === itemId ? { ...item, hasIssue: !item.hasIssue } : item))
      const map: ProgressMap = {}
      for (const it of nextItems) {
        map[it.id] = { checked: it.checked, hasIssue: it.hasIssue, note: it.note }
      }
      setProgress(checklistId, map)
    }
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

  const getStatusBadge = (cl: Checklist) => {
    if (cl.status === "completado") {
      return <Badge className="bg-success text-success-foreground">Completado</Badge>
    }
    const hasIssue = cl.items.some((i) => i.hasIssue)
    if (hasIssue) {
      return <Badge className="bg-warning text-warning-foreground">Con Hallazgos</Badge>
    }
    const hasProgress = cl.items.some((i) => i.checked)
    if (hasProgress) {
      return <Badge className="bg-warning text-warning-foreground">En Progreso</Badge>
    }
    return <Badge variant="secondary">Pendiente</Badge>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Checklists</h1>
          <p className="text-muted-foreground">Gestiona y completa inspecciones de seguridad</p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Checklist
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Crear nueva checklist</DialogTitle>
              <DialogDescription>Define el título, descripción y los ítems (uno por línea).</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cl_title">Título</Label>
                <Input id="cl_title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Inspección Diaria" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl_desc">Descripción</Label>
                <Input id="cl_desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Sector o detalles" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl_items">Ítems (uno por línea)</Label>
                <Textarea id="cl_items" value={newItemsText} onChange={(e) => setNewItemsText(e.target.value)} rows={6} />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={isCreating || !newTitle.trim()}
                  onClick={() =>
                    startCreate(async () => {
                      const lines = newItemsText
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean)
                      const items: ChecklistItem[] = lines.map((text, idx) => ({
                        id: `tmpl-${Date.now()}-${idx}`,
                        text,
                        checked: false,
                        hasIssue: false,
                      }))
                      const created: { id: number } = await createChecklistTemplate({
                        name: newTitle.trim(),
                        description: newDescription.trim() || undefined,
                        items: { items },
                      })
                      setChecklists((prev) => [
                        {
                          id: String(created.id),
                          title: newTitle.trim(),
                          sector: newDescription.trim() || "",
                          status: "pendiente",
                          items,
                        },
                        ...prev,
                      ])
                      setNewTitle("")
                      setNewDescription("")
                      setNewItemsText("EPP completo\nSeñalización visible\nExtintores en buen estado")
                    })
                  }
                >
                  {isCreating ? "Creando..." : "Crear checklist"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
                {getStatusBadge(checklist)}
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
                <p className="mb-3 flex items-center gap-1 text-sm text-muted-foreground" suppressHydrationWarning={true}>
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
