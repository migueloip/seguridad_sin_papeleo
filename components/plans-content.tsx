"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, ImageIcon, Download, Copy, MapPin } from "lucide-react"
import { extractZonesFromPlan, createPlan, savePlanFloorsAndZones } from "@/app/actions/plans"
import type { Plan } from "@/lib/db"

interface ZoneItem {
  name: string
  code?: string
  x?: number
  y?: number
  width?: number
  height?: number
}
interface FloorItem {
  name: string
  zones: ZoneItem[]
}

export function PlansContent({
  projects,
  plans,
}: {
  projects?: Array<{ id: number; name: string }>
  plans?: Plan[]
}) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [mimeType, setMimeType] = useState<string>("")
  const [floors, setFloors] = useState<FloorItem[]>([])
  const [isPending, startTransition] = useTransition()
  const [planName, setPlanName] = useState<string>("")
  const [planType, setPlanType] = useState<string>("")
  const [projectId, setProjectId] = useState<number | null>(null)
  const [message, setMessage] = useState<string>("")
  const [selectedZoneKey, setSelectedZoneKey] = useState<string | null>(null)

  async function renderPdfFirstPageToDataURL(pdfFile: File): Promise<string> {
    const arrayBuffer = await pdfFile.arrayBuffer()
    const pdfjsLib = await import("pdfjs-dist")
    const getDocument = (pdfjsLib as unknown as {
      getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<unknown> }
    }).getDocument
    const loadingTask = getDocument({ data: arrayBuffer })
    const pdfAny = await loadingTask.promise
    const pdf = pdfAny as {
      getPage: (n: number) => Promise<{
        getViewport: (opts: { scale: number }) => { width: number; height: number }
        render: (args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
          promise: Promise<unknown>
        }
      }>
    }
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("No se pudo crear el contexto de canvas para PDF")
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas.toDataURL("image/png")
  }

  type UnknownRecord = Record<string, unknown>
  const getStr = (obj: unknown, key: string, def: string) => {
    const v = (obj as UnknownRecord)?.[key]
    return typeof v === "string" ? v : def
  }
  const getNum = (obj: unknown, key: string) => {
    const v = (obj as UnknownRecord)?.[key]
    const n = typeof v === "number" ? v : Number(v)
    if (!Number.isFinite(n)) return undefined
    if (n < 0 || n > 1) return undefined
    return n
  }
  const getZones = (obj: unknown) => {
    const raw = (obj as UnknownRecord)?.["zones"]
    const arr = Array.isArray(raw) ? raw : []
    return arr.map((z: unknown): ZoneItem => ({
      name: getStr(z, "name", "Zona"),
      code: typeof (z as UnknownRecord)?.["code"] === "string" ? String((z as UnknownRecord)["code"]) : undefined,
      x: getNum(z, "x"),
      y: getNum(z, "y"),
      width: getNum(z, "width"),
      height: getNum(z, "height"),
    }))
  }

  const handleFileChange = (f: File | null) => {
    setFloors([])
    setFile(f)
    setPreviewUrl("")
    setMimeType("")
    if (!f) return
    const type = f.type || ""
    setMimeType(type)
    if (type.startsWith("image/")) {
      const reader = new FileReader()
      reader.onload = () => setPreviewUrl(String(reader.result || ""))
      reader.readAsDataURL(f)
    } else if (type === "application/pdf") {
      ;(async () => {
        try {
          const url = await renderPdfFirstPageToDataURL(f)
          setPreviewUrl(url)
          setMimeType("image/png")
        } catch {
          alert("No se pudo procesar el PDF. Intenta con una imagen del plano.")
        }
      })()
    }
  }

  const processWithAI = async () => {
    if (!file) {
      alert("Selecciona un archivo de plano")
      return
    }
    startTransition(async () => {
      let base64 = ""
      let mime = mimeType
      if (previewUrl && previewUrl.startsWith("data:")) {
        base64 = previewUrl.split(",")[1] || ""
      } else {
        const reader = new FileReader()
        base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String((reader.result as string).split(",")[1] || ""))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        mime = file.type || "image/png"
      }
      try {
        const result = await extractZonesFromPlan(base64, mime)
        const rawFloors = Array.isArray(result?.floors) ? result.floors : []
        setFloors(
          rawFloors.map((fl: unknown) => ({
            name: getStr(fl, "name", "General"),
            zones: getZones(fl),
          })),
        )
        setMessage("")
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error procesando plano con IA"
        setMessage(msg)
        alert(msg)
      }
    })
  }

  const downloadJson = () => {
    const payload = { floors }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "zonas-por-piso.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = async () => {
    const payload = JSON.stringify({ floors }, null, 2)
    await navigator.clipboard.writeText(payload)
    alert("Listado copiado")
  }

  const saveToDatabase = () => {
    if (floors.length === 0) {
      alert("Primero genera las zonas con IA")
      return
    }
    if (!planName.trim()) {
      alert("Ingresa un nombre de plano")
      return
    }
    if (!planType.trim()) {
      alert("Selecciona el tipo de plano")
      return
    }
    startTransition(async () => {
      try {
        setMessage("")
        const created: Plan = await createPlan({
          project_id: projectId || undefined,
          name: planName.trim(),
          plan_type: planType.trim(),
          file_name: file?.name || "plano.png",
          file_url: undefined,
          mime_type: mimeType || "image/png",
          extracted: { floors },
        })
        await savePlanFloorsAndZones(Number(created.id), floors)
        setMessage("Plano guardado")
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error guardando plano"
        setMessage(msg)
        alert(msg)
      }
    })
  }

  const projectNameById = new Map((projects || []).map((p) => [p.id, p.name]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Planos</h1>
        <p className="text-muted-foreground">Analiza planos con IA y gestiona tus planos guardados</p>
      </div>

      <Tabs defaultValue="analysis">
        <TabsList>
          <TabsTrigger value="analysis">Análisis de planos</TabsTrigger>
          <TabsTrigger value="saved">Planos guardados</TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="mt-4">
          <div
            className={`grid gap-6 ${
              floors.length > 0 ? "items-start lg:grid-cols-[minmax(0,2.2fr)_minmax(320px,1fr)]" : ""
            }`}
          >
            <div className={floors.length > 0 ? "order-1" : "order-2"}>
              <Card>
                <CardHeader>
                  <CardTitle>Listado de Zonas por Piso</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {floors.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" />
                      <span>No hay zonas generadas. Sube un plano y procesa con IA.</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={downloadJson}>
                          <Download className="mr-2 h-4 w-4" />
                          Descargar JSON
                        </Button>
                        <Button variant="outline" onClick={copyToClipboard}>
                          <Copy className="mr-2 h-4 w-4" />
                          Copiar
                        </Button>
                        <Button onClick={saveToDatabase} disabled={isPending || !planName || !planType}>
                          {isPending ? "Guardando..." : "Guardar en BD"}
                        </Button>
                      </div>
                      <div className="grid gap-4">
                        {floors.map((floor, floorIndex) => {
                          const hasGeometry = floor.zones.some(
                            (z) =>
                              typeof z.x === "number" &&
                              typeof z.y === "number" &&
                              typeof z.width === "number" &&
                              typeof z.height === "number",
                          )
                          const columns = Math.min(4, Math.max(1, floor.zones.length))
                          return (
                            <Card key={floor.name}>
                              <CardHeader>
                                <CardTitle className="text-base">{floor.name}</CardTitle>
                              </CardHeader>
                              <CardContent>
                                {floor.zones.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">Sin zonas</p>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium text-muted-foreground">
                                        Mapa tipo bloques (click para seleccionar zona)
                                      </p>
                                      {hasGeometry ? (
                                        <div className="relative mx-auto mt-1 h-64 w-full max-w-3xl overflow-hidden rounded-md border bg-muted/40">
                                          {floor.zones.map((z, idx) => {
                                            if (
                                              typeof z.x !== "number" ||
                                              typeof z.y !== "number" ||
                                              typeof z.width !== "number" ||
                                              typeof z.height !== "number"
                                            ) {
                                              return null
                                            }
                                            const key = `${floor.name}-${z.name}-${z.code || ""}-${idx}`
                                            const isSelected = selectedZoneKey === key
                                            const left = `${z.x * 100}%`
                                            const top = `${z.y * 100}%`
                                            const width = `${z.width * 100}%`
                                            const height = `${z.height * 100}%`
                                            return (
                                              <button
                                                key={key}
                                                type="button"
                                                className={`absolute flex items-center justify-center rounded-md border text-[10px] font-medium leading-tight transition-colors ${
                                                  isSelected
                                                    ? "border-destructive bg-destructive/20 text-destructive"
                                                    : "border-border bg-background/70 text-foreground hover:bg-muted"
                                                }`}
                                                style={{
                                                  left,
                                                  top,
                                                  width,
                                                  height,
                                                  minWidth: "8%",
                                                  minHeight: "8%",
                                                }}
                                                onClick={() => setSelectedZoneKey(key)}
                                              >
                                                <MapPin className="absolute left-1 top-1 h-3 w-3 text-destructive" />
                                                <span className="mx-2 text-center">
                                                  {z.name}
                                                  {z.code ? ` (${z.code})` : ""}
                                                </span>
                                              </button>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <div
                                          className="grid gap-2"
                                          style={{
                                            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                          }}
                                        >
                                          {floor.zones.map((z, idx) => {
                                            const key = `${floor.name}-${z.name}-${z.code || ""}-${idx}`
                                            const isSelected = selectedZoneKey === key
                                            return (
                                              <button
                                                key={key}
                                                type="button"
                                                className={`relative flex items-center justify-center rounded-md border p-3 text-xs font-medium transition-colors ${
                                                  isSelected
                                                    ? "border-destructive bg-destructive/10 text-destructive"
                                                    : "border-border bg-muted/40 text-foreground hover:bg-muted"
                                                }`}
                                                onClick={() => setSelectedZoneKey(key)}
                                              >
                                                <MapPin className="absolute left-1 top-1 h-3 w-3 text-destructive" />
                                                <span className="text-center">
                                                  {z.name}
                                                  {z.code ? ` (${z.code})` : ""}
                                                </span>
                                              </button>
                                            )
                                          })}
                                        </div>
                                      )}
                                    </div>
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium text-muted-foreground">
                                        Edita los nombres y códigos de las zonas
                                      </p>
                                      <div className="grid gap-2">
                                        {floor.zones.map((z, zoneIndex) => (
                                          <div
                                            key={`${floor.name}-${z.name}-${z.code || ""}-${zoneIndex}`}
                                            className="grid gap-2 rounded-md border p-2 text-xs sm:grid-cols-[2fr_1fr]"
                                          >
                                            <div className="space-y-1">
                                              <Label className="text-[11px]">Nombre</Label>
                                              <Input
                                                value={z.name}
                                                onChange={(e) => {
                                                  const value = e.target.value
                                                  setFloors((prev) =>
                                                    prev.map((f, fi) => {
                                                      if (fi !== floorIndex) return f
                                                      return {
                                                        ...f,
                                                        zones: f.zones.map((zone, zi) =>
                                                          zi === zoneIndex ? { ...zone, name: value } : zone,
                                                        ),
                                                      }
                                                    }),
                                                  )
                                                }}
                                                className="h-7 text-xs"
                                              />
                                            </div>
                                            <div className="space-y-1">
                                              <Label className="text-[11px]">Código</Label>
                                              <Input
                                                value={z.code ?? ""}
                                                onChange={(e) => {
                                                  const value = e.target.value || undefined
                                                  setFloors((prev) =>
                                                    prev.map((f, fi) => {
                                                      if (fi !== floorIndex) return f
                                                      return {
                                                        ...f,
                                                        zones: f.zones.map((zone, zi) =>
                                                          zi === zoneIndex ? { ...zone, code: value } : zone,
                                                        ),
                                                      }
                                                    }),
                                                  )
                                                }}
                                                className="h-7 text-xs"
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                      {message && <p className="text-sm text-muted-foreground">{message}</p>}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
            <div className={floors.length > 0 ? "order-2" : "order-1"}>
              <Card>
                <CardHeader>
                  <CardTitle>Subir Plano</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="plan_file">Archivo de plano (imagen)</Label>
                    <Input
                      id="plan_file"
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                    />
                    {previewUrl ? (
                      <img src={previewUrl} alt="Plano" className="mt-2 max-h-64 w-full rounded object-contain" />
                    ) : (
                      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                        <span>Selecciona una imagen de plano</span>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="plan_name">Nombre del plano</Label>
                      <Input
                        id="plan_name"
                        value={planName}
                        onChange={(e) => setPlanName(e.target.value)}
                        placeholder="Ej: Edificio A - PB"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="plan_type">Tipo</Label>
                      <select
                        id="plan_type"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={planType}
                        onChange={(e) => setPlanType(e.target.value)}
                      >
                        <option value="">Selecciona</option>
                        <option value="arquitectonico">Arquitectónico</option>
                        <option value="electrico">Eléctrico</option>
                        <option value="evacuacion">Evacuación</option>
                        <option value="seguridad">Seguridad</option>
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="project">Proyecto</Label>
                      <select
                        id="project"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={projectId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value
                          setProjectId(v ? Number(v) : null)
                        }}
                      >
                        <option value="">Sin proyecto</option>
                        {(projects || []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => handleFileChange(null)}>
                      Limpiar
                    </Button>
                    <Button onClick={processWithAI} disabled={isPending || !file}>
                      {isPending ? "Procesando..." : "Generar zonas con IA"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="saved" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Planos guardados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!plans || plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay planos guardados. Genera un plano en la pestaña de análisis.
                </p>
              ) : (
                <div className="grid gap-3">
                  {plans.map((plan) => (
                    <div
                      key={plan.id}
                      className="flex flex-col justify-between gap-2 rounded-md border p-3 text-sm sm:flex-row sm:items-center"
                    >
                      <div className="space-y-1">
                        <div className="font-medium">{plan.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Tipo: {plan.plan_type}{" "}
                          {plan.project_id ? `· Proyecto: ${projectNameById.get(plan.project_id) || plan.project_id}` : ""}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            alert("Edición de planos guardados se puede agregar en un siguiente paso.")
                          }}
                        >
                          Ver/editar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
