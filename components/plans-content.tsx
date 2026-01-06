"use client"

import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, ImageIcon, Download, Copy, MapPin } from "lucide-react"
import {
  extractZonesFromPlan,
  createPlan,
  savePlanFloorsAndZones,
  getPlanDetail,
  deletePlan,
  getPlanTypes,
  createPlanType,
  updatePlanType,
  deletePlanType,
} from "@/app/actions/plans"
import type { Plan } from "@/lib/db"

type AutodeskDocumentRoot = {
  getDefaultGeometry?: () => unknown
}

type AutodeskDocument = {
  getRoot?: () => AutodeskDocumentRoot | undefined
}

type AutodeskViewing = {
  Initializer: (options: { env: string; api: string; getAccessToken: (onToken: (token: string, expiresIn: number) => void) => void }, callback: () => void) => void
  GuiViewer3D: new (container: HTMLElement) => {
    start: () => number
    setTheme?: (theme: string) => void
    loadDocumentNode: (doc: AutodeskDocument, geometry: unknown) => void
    destroy?: () => void
  }
  Document: {
    load: (documentId: string, onSuccess: (doc: AutodeskDocument) => void, onError: () => void) => void
  }
}

type AutodeskNamespace = {
  Viewing?: AutodeskViewing
}

declare global {
  interface Window {
    Autodesk?: AutodeskNamespace
  }
}

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
  frame?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export function PlansContent({
  plans,
}: {
  plans?: Plan[]
}) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [mimeType, setMimeType] = useState<string>("")
  const [floors, setFloors] = useState<FloorItem[]>([])
  const [isPending, startTransition] = useTransition()
  const [planName, setPlanName] = useState<string>("")
  const [planType, setPlanType] = useState<string>("")
  const [planTypeId, setPlanTypeId] = useState<number | null>(null)
  const [message, setMessage] = useState<string>("")
  const [selectedZoneKey, setSelectedZoneKey] = useState<string | null>(null)
  const [tab, setTab] = useState<"ai" | "manual" | "saved" | "plan-types">("ai")
  const [editingPlanId, setEditingPlanId] = useState<number | null>(null)
  const [autodeskUrn, setAutodeskUrn] = useState<string>("")
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null)
  const [manualDraw, setManualDraw] = useState<{ floorIndex: number; points: { x: number; y: number }[] } | null>(
    null,
  )
  const [planItems, setPlanItems] = useState<Plan[]>(plans || [])
  const [planTypes, setPlanTypes] = useState<Array<{ id: number; name: string; description: string | null }>>([])
  const [newPlanTypeName, setNewPlanTypeName] = useState("")
  const [newPlanTypeDescription, setNewPlanTypeDescription] = useState("")

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
  const getFrame = (obj: unknown) => {
    const raw = (obj as UnknownRecord)?.["frame"]
    if (!raw || typeof raw !== "object") return undefined
    const x = getNum(raw, "x")
    const y = getNum(raw, "y")
    const width = getNum(raw, "width")
    const height = getNum(raw, "height")
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      return undefined
    }
    return { x, y, width, height }
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

  const handleManualCanvasClick = (floorIndex: number, e: MouseEvent<HTMLDivElement>) => {
    if (!previewUrl) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const rawX = (e.clientX - rect.left) / rect.width
    const rawY = (e.clientY - rect.top) / rect.height
    const x = Math.min(Math.max(rawX, 0), 1)
    const y = Math.min(Math.max(rawY, 0), 1)
    if (!manualDraw || manualDraw.floorIndex !== floorIndex || manualDraw.points.length >= 4) {
      setManualDraw({ floorIndex, points: [{ x, y }] })
      return
    }
    const nextPoints = [...manualDraw.points, { x, y }]
    if (nextPoints.length < 4) {
      setManualDraw({ floorIndex, points: nextPoints })
      return
    }
    const xs = nextPoints.map((p) => p.x)
    const ys = nextPoints.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const width = maxX - minX
    const height = maxY - minY
    if (width <= 0.001 || height <= 0.001) {
      setManualDraw(null)
      return
    }
    setFloors((prev) =>
      prev.map((f, idx) => {
        if (idx !== floorIndex) return f
        const newZone: ZoneItem = {
          name: `Zona ${f.zones.length + 1}`,
          x: minX,
          y: minY,
          width,
          height,
        }
        return { ...f, zones: [...f.zones, newZone] }
      }),
    )
    setManualDraw(null)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const rows = await getPlanTypes()
        if (!active) return
        const mapped = (rows || []).map((r) => ({
          id: Number((r as { id: number }).id),
          name: String((r as { name: string }).name),
          description:
            (r as { description: string | null }).description === null ||
            (r as { description: string | null }).description === undefined
              ? null
              : String((r as { description: string | null }).description),
        }))
        setPlanTypes(mapped)
      } catch {}
    })()
    return () => {
      active = false
    }
  }, [])

  const handleFileChange = (f: File | null) => {
    setFloors([])
    setFile(f)
    setPreviewUrl("")
    setMimeType("")
    if (!f) return
    const type = f.type || ""
    const name = f.name || ""
    const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() || "" : ""
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
          try {
            const img = new Image()
            img.onload = () => setImageDims({ w: img.naturalWidth, h: img.naturalHeight })
            img.src = url
          } catch {}
        } catch {
          alert("No se pudo procesar el PDF. Intenta con una imagen del plano.")
        }
      })()
    } else if (ext === "dxf" || ext === "dwg") {
      ;(async () => {
        try {
          const reader = new FileReader()
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(String((reader.result as string).split(",")[1] || ""))
            reader.onerror = reject
            reader.readAsDataURL(f)
          })
          const res = await fetch("/api/planos/cad-to-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64, ext }),
          })
          if (!res.ok) {
            let msg = "No se pudo convertir el plano CAD. Exporta el plano como imagen o PDF."
            try {
              const data = (await res.json()) as { error?: string }
              if (data && typeof data.error === "string" && data.error.trim()) {
                msg = data.error
              }
            } catch {}
            alert(msg)
            return
          }
          const data = (await res.json()) as { dataUrl?: string; mimeType?: string }
          if (!data.dataUrl) {
            alert("No se pudo convertir el plano CAD. Exporta el plano como imagen o PDF.")
            return
          }
          setPreviewUrl(data.dataUrl)
          setMimeType(data.mimeType || "image/png")
          try {
            const img = new Image()
            img.onload = () => setImageDims({ w: img.naturalWidth, h: img.naturalHeight })
            img.src = data.dataUrl
          } catch {}
        } catch {
          alert("No se pudo convertir el plano CAD. Exporta el plano como imagen o PDF.")
        }
      })()
    }
  }

  useEffect(() => {
    if (!previewUrl) {
      setImageDims(null)
      return
    }
    try {
      const img = new Image()
      img.onload = () => setImageDims({ w: img.naturalWidth, h: img.naturalHeight })
      img.src = previewUrl
    } catch {
      setImageDims(null)
    }
  }, [previewUrl])

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
            frame: getFrame(fl),
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
      alert("Primero define al menos una zona con IA o con el editor manual")
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
        if (editingPlanId) {
          await savePlanFloorsAndZones(editingPlanId, floors)
          setMessage("Plano actualizado")
        } else {
          const chosenType = planTypes.find((t) => t.id === planTypeId) || null
          const typeName = chosenType?.name || planType.trim()
          const created: Plan = await createPlan({
            name: planName.trim(),
            plan_type: typeName,
            file_name: file?.name || "plano.png",
            file_url: undefined,
            mime_type: mimeType || "image/png",
            extracted: { floors },
          })
          await savePlanFloorsAndZones(Number(created.id), floors)
          setMessage("Plano guardado")
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error guardando plano"
        setMessage(msg)
        alert(msg)
      }
    })
  }

  const addFloor = () => {
    setFloors((prev) => [...prev, { name: `Piso ${prev.length + 1}`, zones: [] }])
  }

  const removeFloor = (floorIndex: number) => {
    setFloors((prev) => prev.filter((_, idx) => idx !== floorIndex))
  }

  const addZoneToFloor = (floorIndex: number) => {
    setFloors((prev) =>
      prev.map((f, idx) =>
        idx === floorIndex ? { ...f, zones: [...f.zones, { name: `Zona ${f.zones.length + 1}` }] } : f,
      ),
    )
  }

  const removeZoneFromFloor = (floorIndex: number, zoneIndex: number) => {
    setFloors((prev) =>
      prev.map((f, idx) => {
        if (idx !== floorIndex) return f
        return { ...f, zones: f.zones.filter((_, zIdx) => zIdx !== zoneIndex) }
      }),
    )
  }

  const autoNameAndCodeZones = () => {
    setFloors((prev) =>
      prev.map((floor, floorIndex) => ({
        ...floor,
        zones: floor.zones.map((z, zoneIndex) => {
          const name = z.name && z.name.trim().length > 0 ? z.name : `Zona ${floorIndex + 1}.${zoneIndex + 1}`
          const code =
            z.code && z.code.trim().length > 0 ? z.code : `P${floorIndex + 1}-Z${zoneIndex + 1}`
          return { ...z, name, code }
        }),
      })),
    )
  }

  const loadPlanForEditing = (planId: number) => {
    startTransition(async () => {
      try {
        const detail = await getPlanDetail(planId)
        if (!detail.plan) {
          alert("No se encontró el plano seleccionado")
          return
        }
        const rawFloors = Array.isArray(detail.floors) ? detail.floors : []
        const mappedFloors: FloorItem[] = rawFloors.map((f: unknown) => {
          const obj = f as UnknownRecord
          const zonesRaw = Array.isArray(obj["zones"]) ? (obj["zones"] as unknown[]) : []
          return {
            name: getStr(obj, "name", "General"),
            zones: zonesRaw.map((z: unknown): ZoneItem => ({
              name: getStr(z, "name", "Zona"),
              code: typeof (z as UnknownRecord)["code"] === "string" ? String((z as UnknownRecord)["code"]) : undefined,
            })),
          }
        })
        setFloors(mappedFloors)
        setSelectedZoneKey(null)
        setFile(null)
        setPreviewUrl("")
        setMimeType("")
        setEditingPlanId(Number(detail.plan.id))
        setPlanName(detail.plan.name || "")
        setPlanType(detail.plan.plan_type || "")
        setPlanTypeId(null)
        setMessage("")
        setAutodeskUrn("")
        setTab("ai")
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error cargando plano"
        setMessage(msg)
        alert(msg)
      }
    })
  }

  function AutodeskViewer({ urn }: { urn: string }) {
    const containerRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      type ViewerInstance = {
        start: () => number
        setTheme?: (theme: string) => void
        loadDocumentNode: (doc: AutodeskDocument, geometry: unknown) => void
        destroy?: () => void
      }

      let viewer: ViewerInstance | null = null

      const loadViewerLib = () =>
        new Promise<void>((resolve, reject) => {
          if (typeof window === "undefined") {
            resolve()
            return
          }
          const existingScript = document.getElementById("autodesk-viewer-script")
          if (existingScript && (window as Window & { Autodesk?: AutodeskNamespace }).Autodesk) {
            resolve()
            return
          }
          const styleId = "autodesk-viewer-style"
          if (!document.getElementById(styleId)) {
            const link = document.createElement("link")
            link.id = styleId
            link.rel = "stylesheet"
            link.href =
              "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.latest/style.min.css"
            document.head.appendChild(link)
          }
          if (existingScript) {
            existingScript.addEventListener("load", () => resolve(), { once: true })
            existingScript.addEventListener(
              "error",
              () => reject(new Error("No se pudo cargar Autodesk Viewer")),
              { once: true },
            )
            return
          }
          const script = document.createElement("script")
          script.id = "autodesk-viewer-script"
          script.src =
            "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.latest/viewer3D.min.js"
          script.onload = () => resolve()
          script.onerror = () => reject(new Error("No se pudo cargar Autodesk Viewer"))
          document.head.appendChild(script)
        })

      const initViewer = async () => {
        if (!urn.trim()) return
        const container = containerRef.current
        if (!container) return
        try {
          await loadViewerLib()
        } catch {
          return
        }
        const w = window as Window & { Autodesk?: AutodeskNamespace }
        const viewing = w.Autodesk?.Viewing
        if (!viewing) return
        const options = {
          env: "AutodeskProduction2",
          api: "streamingV2",
          getAccessToken: (onToken: (token: string, expiresIn: number) => void) => {
            fetch("/api/autodesk/token")
              .then((res) => res.json() as Promise<{ access_token?: string; expires_in?: number }>)
              .then((data) => {
                if (!data || !data.access_token) return
                const expiresIn =
                  typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
                    ? data.expires_in
                    : 1800
                onToken(data.access_token, expiresIn)
              })
              .catch(() => {})
          },
        }
        viewing.Initializer(options, () => {
          viewer = new viewing.GuiViewer3D(container)
          const started = viewer.start()
          if (started !== 0) return
          const cleanUrn = urn.replace(/^urn:/i, "")
          const documentId = `urn:${cleanUrn}`
          viewing.Document.load(
            documentId,
            (doc: AutodeskDocument) => {
              const root = doc.getRoot ? doc.getRoot() : undefined
              const defaultGeometry = root && root.getDefaultGeometry ? root.getDefaultGeometry() : undefined
              if (!defaultGeometry || !viewer) return
              viewer.loadDocumentNode(doc, defaultGeometry)
              if (viewer.setTheme) viewer.setTheme("dark")
            },
            () => {},
          )
        })
      }

      initViewer()

      return () => {
        if (viewer && typeof viewer.destroy === "function") {
          try {
            viewer.destroy()
          } catch {}
        }
      }
    }, [urn])

    return (
      <div
        ref={containerRef}
        className="mt-2 h-96 w-full overflow-hidden rounded-md border bg-muted/40"
      />
    )
  }

  const projectNameById = new Map((plans || []).map((p) => [p.id, (p as any).project_name]))

  const handleDeletePlan = (planId: number, name: string) => {
    const ok = window.confirm(
      `¿Eliminar el plano "${name}" y todas sus zonas asociadas? Esta acción no se puede deshacer.`,
    )
    if (!ok) return
    startTransition(async () => {
      try {
        await deletePlan(planId)
        setPlanItems((prev) => prev.filter((p) => p.id !== planId))
      } catch {
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Planos</h1>
        <p className="text-muted-foreground">
          Genera zonas de planos con IA o edítalas manualmente y gestiona los planos guardados
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "ai" | "manual" | "saved" | "plan-types")}>
        <TabsList>
          <TabsTrigger value="ai">Generador por IA</TabsTrigger>
          <TabsTrigger value="manual">Editor manual de zonas</TabsTrigger>
          <TabsTrigger value="saved">Planos guardados</TabsTrigger>
          <TabsTrigger value="plan-types">Tipos de plano</TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="mt-4">
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
                                        <div
                                          className="relative mx-auto mt-1 w-full max-w-3xl overflow-hidden rounded-md border"
                                          style={{
                                            aspectRatio:
                                              imageDims && imageDims.w > 0 && imageDims.h > 0
                                                ? `${imageDims.w}/${imageDims.h}`
                                                : undefined,
                                            backgroundImage: previewUrl ? `url(${previewUrl})` : undefined,
                                            backgroundSize: "contain",
                                            backgroundRepeat: "no-repeat",
                                            backgroundPosition: "center",
                                          }}
                                        >
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
                                            const frame = floor.frame
                                            const frameX =
                                              typeof frame?.x === "number" && frame.x >= 0 && frame.x <= 1
                                                ? frame.x
                                                : 0
                                            const frameY =
                                              typeof frame?.y === "number" && frame.y >= 0 && frame.y <= 1
                                                ? frame.y
                                                : 0
                                            const frameW =
                                              typeof frame?.width === "number" &&
                                              frame.width > 0 &&
                                              frame.width <= 1
                                                ? frame.width
                                                : 1
                                            const frameH =
                                              typeof frame?.height === "number" &&
                                              frame.height > 0 &&
                                              frame.height <= 1
                                                ? frame.height
                                                : 1
                                            const left = `${(frameX + z.x * frameW) * 100}%`
                                            const top = `${(frameY + z.y * frameH) * 100}%`
                                            const width = `${z.width * frameW * 100}%`
                                            const height = `${z.height * frameH * 100}%`
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
                    <Label htmlFor="plan_file">Archivo de plano (imagen, PDF o CAD DXF/DWG)</Label>
                    <Input
                      id="plan_file"
                      type="file"
                      accept="image/*,application/pdf,.dxf,.dwg"
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
                      <Label htmlFor="plan_type">Tipo de plano</Label>
                      <select
                        id="plan_type"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={planTypeId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value
                          const id = v ? Number(v) : NaN
                          if (!Number.isFinite(id)) {
                            setPlanTypeId(null)
                            setPlanType("")
                            return
                          }
                          setPlanTypeId(id)
                          const chosen = planTypes.find((t) => t.id === id) || null
                          setPlanType(chosen?.name || "")
                        }}
                      >
                        <option value="">Selecciona un tipo</option>
                        {planTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="autodesk_urn">URN Autodesk para visor 3D (opcional)</Label>
                    <Input
                      id="autodesk_urn"
                      value={autodeskUrn}
                      onChange={(e) => setAutodeskUrn(e.target.value)}
                      placeholder="Ej: dXJuOmFkc2sub2JqZWN0cy5kZXJpdmF0aXZlLi4u"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Requiere que el archivo CAD esté procesado en Autodesk Platform Services.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingPlanId(null)
                        setPlanName("")
                        setPlanType("")
                        setPlanTypeId(null)
                        setSelectedZoneKey(null)
                        setMessage("")
                        handleFileChange(null)
                      }}
                    >
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
          {autodeskUrn.trim() && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Visor 3D Autodesk</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Visualiza el plano CAD en 2D/3D usando Autodesk Viewer. Usa un URN generado en tu cuenta de Autodesk
                  Platform Services.
                </p>
                <AutodeskViewer urn={autodeskUrn.trim()} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Editor manual de zonas (sin IA)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Crea o ajusta pisos y zonas manualmente. También puedes pegar JSON exportado.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={addFloor}>
                  {floors.length === 0 ? "Crear piso 1" : `Agregar piso ${floors.length + 1}`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFloors([])
                    setSelectedZoneKey(null)
                    setEditingPlanId(null)
                    setMessage("")
                  }}
                >
                  Limpiar pisos y zonas
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={autoNameAndCodeZones}>
                  Asignar nombres y códigos auto
                </Button>
              </div>
              <div className="grid gap-4">
                {floors.map((floor, floorIndex) => (
                  <div key={`${floor.name}-${floorIndex}`} className="space-y-3 rounded-md border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Nombre del piso</Label>
                        <Input
                          value={floor.name}
                          onChange={(e) => {
                            const value = e.target.value
                            setFloors((prev) =>
                              prev.map((f, idx) => (idx === floorIndex ? { ...f, name: value } : f)),
                            )
                          }}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="mt-2 flex justify-end sm:mt-0 sm:ml-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => removeFloor(floorIndex)}
                        >
                          Eliminar piso
                        </Button>
                      </div>
                    </div>
                    {previewUrl && (
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">
                          {manualDraw && manualDraw.floorIndex === floorIndex
                            ? `Selecciona el punto ${manualDraw.points.length + 1} de 4 sobre la imagen para definir la zona.`
                            : "Haz clic cuatro veces sobre la imagen para marcar las esquinas de una nueva zona."}
                        </p>
                        <div
                          className="relative mx-auto mt-1 w-full max-w-3xl overflow-hidden rounded-md border bg-muted"
                          style={{
                            aspectRatio:
                              imageDims && imageDims.w > 0 && imageDims.h > 0
                                ? `${imageDims.w}/${imageDims.h}`
                                : undefined,
                            backgroundImage: previewUrl ? `url(${previewUrl})` : undefined,
                            backgroundSize: "contain",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "center",
                          }}
                          onClick={(e) => handleManualCanvasClick(floorIndex, e)}
                        >
                          {floor.zones.map((z, idx) => {
                            if (
                              typeof z.x !== "number" ||
                              typeof z.y !== "number" ||
                              typeof z.width !== "number" ||
                              typeof z.height !== "number"
                            ) {
                              return null
                            }
                            const left = `${z.x * 100}%`
                            const top = `${z.y * 100}%`
                            const width = `${z.width * 100}%`
                            const height = `${z.height * 100}%`
                            return (
                              <div
                                key={`${floor.name}-manual-${idx}`}
                                className="absolute flex items-center justify-center rounded-md border border-border bg-background/70 text-[10px] font-medium leading-tight text-foreground"
                                style={{
                                  left,
                                  top,
                                  width,
                                  height,
                                  minWidth: "6%",
                                  minHeight: "6%",
                                }}
                              >
                                <MapPin className="absolute left-1 top-1 h-3 w-3 text-destructive" />
                                <span className="mx-2 text-center">
                                  {z.name}
                                  {z.code ? ` (${z.code})` : ""}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => addZoneToFloor(floorIndex)}>
                        Agregar zona
                      </Button>
                    </div>
                    {floor.zones.length > 0 && (
                      <div className="grid gap-2">
                        {floor.zones.map((z, zoneIndex) => (
                          <div
                            key={`${floor.name}-${zoneIndex}`}
                            className="grid gap-2 rounded-md border p-2 text-xs md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
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
                            <div className="flex items-end">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => removeZoneFromFloor(floorIndex, zoneIndex)}
                              >
                                Eliminar
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="saved" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Planos guardados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {planItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay planos guardados. Genera un plano en la pestaña de análisis.
                </p>
              ) : (
                <div className="grid gap-3">
                  {planItems.map((plan) => (
                    <div
                      key={plan.id}
                      className="flex flex-col justify-between gap-2 rounded-md border p-3 text-sm sm:flex-row sm:items-center"
                    >
                      <div className="space-y-1">
                        <div className="font-medium">{plan.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Tipo: {plan.plan_type}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => loadPlanForEditing(plan.id)}>
                          Ver/editar
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeletePlan(plan.id, plan.name)}
                          disabled={isPending}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plan-types" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Tipos de plano</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)]">
                <div className="space-y-3">
                  <div className="grid gap-2">
                    <Label htmlFor="new_plan_type_name">Nombre del tipo</Label>
                    <Input
                      id="new_plan_type_name"
                      value={newPlanTypeName}
                      onChange={(e) => setNewPlanTypeName(e.target.value)}
                      placeholder="Ej: Plano de evacuación"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="new_plan_type_desc">Descripción</Label>
                    <Input
                      id="new_plan_type_desc"
                      value={newPlanTypeDescription}
                      onChange={(e) => setNewPlanTypeDescription(e.target.value)}
                      placeholder="Uso principal, normativa, observaciones, etc."
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => {
                        if (!newPlanTypeName.trim()) {
                          alert("Ingresa un nombre para el tipo de plano")
                          return
                        }
                        startTransition(async () => {
                          try {
                            const created = await createPlanType({
                              name: newPlanTypeName.trim(),
                              description: newPlanTypeDescription.trim() || undefined,
                            })
                            const mapped = {
                              id: Number((created as { id: number }).id),
                              name: String((created as { name: string }).name),
                              description:
                                (created as { description: string | null }).description === null ||
                                (created as { description: string | null }).description === undefined
                                  ? null
                                  : String((created as { description: string | null }).description),
                            }
                            setPlanTypes((prev) => [...prev, mapped].sort((a, b) => a.name.localeCompare(b.name)))
                            setNewPlanTypeName("")
                            setNewPlanTypeDescription("")
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : "Error creando tipo de plano"
                            alert(msg)
                          }
                        })
                      }}
                    >
                      Guardar tipo
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {planTypes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Aún no hay tipos de plano. Crea al menos uno para poder asignarlo a los planos.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {planTypes.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
                        >
                          <div className="space-y-1">
                            <div className="font-medium">{t.name}</div>
                            {t.description && (
                              <div className="text-xs text-muted-foreground">{t.description}</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setNewPlanTypeName(t.name)
                                setNewPlanTypeDescription(t.description || "")
                                setPlanTypeId(t.id)
                              }}
                            >
                              Usar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const name = window.prompt("Nuevo nombre del tipo", t.name) || ""
                                if (!name.trim()) return
                                const description =
                                  window.prompt(
                                    "Descripción",
                                    t.description || "",
                                  ) || ""
                                startTransition(async () => {
                                  try {
                                    const updated = await updatePlanType({
                                      id: t.id,
                                      name: name.trim(),
                                      description: description.trim() || undefined,
                                    })
                                    const mapped = {
                                      id: Number((updated as { id: number }).id),
                                      name: String((updated as { name: string }).name),
                                      description:
                                        (updated as { description: string | null }).description === null ||
                                        (updated as { description: string | null }).description === undefined
                                          ? null
                                          : String((updated as { description: string | null }).description),
                                    }
                                    setPlanTypes((prev) =>
                                      prev
                                        .map((pt) => (pt.id === mapped.id ? mapped : pt))
                                        .sort((a, b) => a.name.localeCompare(b.name)),
                                    )
                                  } catch (e) {
                                    const msg = e instanceof Error ? e.message : "Error actualizando tipo de plano"
                                    alert(msg)
                                  }
                                })
                              }}
                            >
                              Editar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                const ok = window.confirm(
                                  `¿Eliminar el tipo de plano "${t.name}"? No se eliminarán los planos existentes, solo el tipo.`,
                                )
                                if (!ok) return
                                startTransition(async () => {
                                  try {
                                    await deletePlanType(t.id)
                                    setPlanTypes((prev) => prev.filter((pt) => pt.id !== t.id))
                                    if (planTypeId === t.id) {
                                      setPlanTypeId(null)
                                      setPlanType("")
                                    }
                                  } catch (e) {
                                    const msg =
                                      e instanceof Error ? e.message : "Error eliminando tipo de plano"
                                    alert(msg)
                                  }
                                })
                              }}
                            >
                              Eliminar
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
