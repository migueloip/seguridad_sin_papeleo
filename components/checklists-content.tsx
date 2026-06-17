"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ClipboardCheck,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  MapPin,
  User,
  Calendar,
  Eye,
} from "lucide-react"
import {
  completeChecklist,
  deleteChecklistTemplate,
  deleteCompletedChecklist,
  type ChecklistResponseItem,
  type ChecklistTemplateSummary,
  type CompletedChecklistSummary,
} from "@/app/actions/checklists"

type ProjectOption = { id: number; name: string }

interface ChecklistsContentProps {
  initialTemplates: ChecklistTemplateSummary[]
  initialCompleted: CompletedChecklistSummary[]
  projects: ProjectOption[]
  defaultInspector: string | null
}

function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function ChecklistsContent({
  initialTemplates,
  initialCompleted,
  projects,
  defaultInspector,
}: ChecklistsContentProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<"templates" | "completed">("templates")

  // ---- Estado del formulario de completado ----
  const [fillTemplate, setFillTemplate] = useState<ChecklistTemplateSummary | null>(null)
  const [fillItems, setFillItems] = useState<ChecklistResponseItem[]>([])
  const [inspector, setInspector] = useState("")
  const [projectId, setProjectId] = useState<string>("none")
  const [location, setLocation] = useState("")
  const [notes, setNotes] = useState("")
  const [createFindings, setCreateFindings] = useState(true)
  const [saving, setSaving] = useState(false)

  // ---- Detalle de un checklist completado ----
  const [detail, setDetail] = useState<CompletedChecklistSummary | null>(null)

  function openFill(template: ChecklistTemplateSummary) {
    setFillTemplate(template)
    setFillItems(template.items.map((i) => ({ ...i, checked: false, hasIssue: false, note: "" })))
    setInspector(defaultInspector || "")
    setProjectId("none")
    setLocation("")
    setNotes("")
    setCreateFindings(true)
  }

  function updateItem(id: string, patch: Partial<ChecklistResponseItem>) {
    setFillItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  const issueCount = fillItems.filter((i) => i.hasIssue).length
  const checkedCount = fillItems.filter((i) => i.checked).length

  async function handleSave() {
    if (!fillTemplate) return
    setSaving(true)
    try {
      const res = await completeChecklist({
        template_id: fillTemplate.id,
        project_id: projectId === "none" ? null : Number(projectId),
        inspector_name: inspector.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        items: fillItems,
        createFindings,
      })
      setFillTemplate(null)
      setTab("completed")
      if (res.findingsCreated > 0) {
        alert(`Checklist guardado. Se crearon ${res.findingsCreated} hallazgo(s) de los ítems con problema.`)
      }
      router.refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al guardar el checklist")
    } finally {
      setSaving(false)
    }
  }

  function handleDeleteTemplate(id: number) {
    if (!confirm("¿Eliminar esta plantilla de checklist?")) return
    startTransition(async () => {
      await deleteChecklistTemplate(id)
      router.refresh()
    })
  }

  function handleDeleteCompleted(id: number) {
    if (!confirm("¿Eliminar este checklist completado?")) return
    startTransition(async () => {
      await deleteCompletedChecklist(id)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Checklists</h1>
        <p className="text-muted-foreground">
          Completa inspecciones a partir de tus plantillas y genera hallazgos automáticamente.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "templates" | "completed")}>
        <TabsList>
          <TabsTrigger value="templates" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Plantillas ({initialTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Completados ({initialCompleted.length})
          </TabsTrigger>
        </TabsList>

        {/* ---- Plantillas ---- */}
        <TabsContent value="templates" className="mt-4">
          {initialTemplates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <ClipboardList className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">Aún no tienes plantillas de checklist</p>
                <p className="text-sm text-muted-foreground">
                  Crea una desde la sección <strong>Subir</strong> tomando una foto de un checklist.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {initialTemplates.map((t) => (
                <Card key={t.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{t.name}</CardTitle>
                      <Badge variant="secondary">{t.item_count} ítems</Badge>
                    </div>
                    {t.description ? (
                      <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="mt-auto flex items-center gap-2">
                    <Button size="sm" className="gap-2" onClick={() => openFill(t)}>
                      <ClipboardCheck className="h-4 w-4" />
                      Completar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={isPending}
                      onClick={() => handleDeleteTemplate(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Completados ---- */}
        <TabsContent value="completed" className="mt-4">
          {initialCompleted.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">Todavía no has completado checklists</p>
                <p className="text-sm text-muted-foreground">
                  Ve a la pestaña <strong>Plantillas</strong> y presiona “Completar”.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {initialCompleted.map((c) => (
                <Card key={c.id}>
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{c.template_name || "Checklist"}</p>
                        {c.issue_items > 0 ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {c.issue_items} con problema
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Sin problemas
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDate(c.completed_at)}
                        </span>
                        {c.inspector_name ? (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {c.inspector_name}
                          </span>
                        ) : null}
                        {c.location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {c.location}
                          </span>
                        ) : null}
                        {c.project_name ? <span>Proyecto: {c.project_name}</span> : null}
                        <span>
                          {c.checked_items}/{c.total_items} revisados
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => setDetail(c)}>
                        <Eye className="h-4 w-4" />
                        Ver
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={isPending}
                        onClick={() => handleDeleteCompleted(c.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ---- Dialog: completar checklist ---- */}
      <Dialog open={!!fillTemplate} onOpenChange={(o) => !o && setFillTemplate(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{fillTemplate?.name}</DialogTitle>
            <DialogDescription>
              Marca cada ítem como revisado y señala los que tengan problemas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inspector">Inspector</Label>
              <Input
                id="inspector"
                value={inspector}
                onChange={(e) => setInspector(e.target.value)}
                placeholder="Nombre del inspector"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">Ubicación</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ej: Piso 3, Sector A"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Proyecto (opcional)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin proyecto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin proyecto</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Ítems</Label>
              <span className="text-xs text-muted-foreground">
                {checkedCount}/{fillItems.length} revisados · {issueCount} con problema
              </span>
            </div>
            <div className="space-y-2">
              {fillItems.map((it) => (
                <div
                  key={it.id}
                  className={`rounded-md border p-3 ${it.hasIssue ? "border-destructive/50 bg-destructive/5" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={it.checked}
                      onCheckedChange={(v) => updateItem(it.id, { checked: v === true })}
                      className="mt-0.5"
                    />
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium leading-snug">{it.text}</p>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={it.hasIssue}
                          onCheckedChange={(v) => updateItem(it.id, { hasIssue: v })}
                          id={`issue-${it.id}`}
                        />
                        <Label htmlFor={`issue-${it.id}`} className="text-xs text-muted-foreground">
                          Marca un problema
                        </Label>
                      </div>
                      {it.hasIssue ? (
                        <Textarea
                          value={it.note}
                          onChange={(e) => updateItem(it.id, { note: e.target.value })}
                          placeholder="Describe el problema (se usará en el hallazgo)…"
                          rows={2}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas generales</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones de la inspección…"
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2 rounded-md border p-3">
            <Switch checked={createFindings} onCheckedChange={setCreateFindings} id="create-findings" />
            <Label htmlFor="create-findings" className="text-sm">
              Crear hallazgos de los ítems con problema
              {issueCount > 0 ? <span className="text-muted-foreground"> ({issueCount})</span> : null}
            </Label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFillTemplate(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando…" : "Guardar checklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Dialog: detalle de un completado ---- */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.template_name || "Checklist"}</DialogTitle>
            <DialogDescription>
              {detail ? formatDate(detail.completed_at) : ""}
              {detail?.inspector_name ? ` · ${detail.inspector_name}` : ""}
              {detail?.location ? ` · ${detail.location}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {detail?.items.map((it) => (
              <div
                key={it.id}
                className={`rounded-md border p-3 ${it.hasIssue ? "border-destructive/50 bg-destructive/5" : ""}`}
              >
                <div className="flex items-start gap-2">
                  {it.checked ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <div className="mt-0.5 h-4 w-4 rounded-sm border" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{it.text}</p>
                    {it.hasIssue ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        Problema{it.note ? `: ${it.note}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {detail?.notes ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <span className="font-medium">Notas: </span>
                {detail.notes}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
