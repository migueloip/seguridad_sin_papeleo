"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, ImageIcon, Download, Copy } from "lucide-react"
import { extractZonesFromPlan, createPlan, savePlanFloorsAndZones } from "@/app/actions/plans"
import type { Plan } from "@/lib/db"

interface ZoneItem {
  name: string
  code?: string
}
interface FloorItem {
  name: string
  zones: ZoneItem[]
}

export function PlansContent({ projects }: { projects?: Array<{ id: number; name: string }> }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [mimeType, setMimeType] = useState<string>("")
  const [floors, setFloors] = useState<FloorItem[]>([])
  const [isPending, startTransition] = useTransition()
  const [planName, setPlanName] = useState<string>("")
  const [planType, setPlanType] = useState<string>("")
  const [projectId, setProjectId] = useState<number | null>(null)
  const [message, setMessage] = useState<string>("")

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
  const getZones = (obj: unknown) => {
    const raw = (obj as UnknownRecord)?.["zones"]
    const arr = Array.isArray(raw) ? raw : []
    return arr.map((z: unknown): ZoneItem => ({
      name: getStr(z, "name", "Zona"),
      code: typeof (z as UnknownRecord)?.["code"] === "string" ? String((z as UnknownRecord)["code"]) : undefined,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Planos</h1>
        <p className="text-muted-foreground">Genera zonas por piso usando IA</p>
      </div>

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
              <Input id="plan_name" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Ej: Edificio A - PB" />
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
              <div className="flex gap-2">
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
                {floors.map((floor) => (
                  <Card key={floor.name}>
                    <CardHeader>
                      <CardTitle className="text-base">{floor.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {floor.zones.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sin zonas</p>
                      ) : (
                        <ul className="list-inside list-disc text-sm">
                          {floor.zones.map((z) => (
                            <li key={`${floor.name}-${z.name}-${z.code || ""}`}>
                              {z.name}
                              {z.code ? ` (${z.code})` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
