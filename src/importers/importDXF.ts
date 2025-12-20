// Importador DXF a modelo interno de plano.
// Este módulo se centra en mapear las entidades gráficas relevantes a:
// - LINE      -> Wall
// - POLYLINE  -> Zone (si está cerrada)
// - LWPOLYLINE-> Zone (si está cerrada)
// - BLOCK/INSERT -> PointElement tipo "equipment"

import type { Element2D, Layer, Plano, PointElement, UUID, Vec2, Wall, Zone } from "@/src/core"

// Tipos mínimos de un documento DXF ya parseado.
export interface DxfEntityBase {
  type: string
  layer?: string
}

export interface DxfLine extends DxfEntityBase {
  type: "LINE"
  start: Vec2
  end: Vec2
}

export interface DxfPolyline extends DxfEntityBase {
  type: "POLYLINE" | "LWPOLYLINE"
  vertices: Vec2[]
  isClosed: boolean
}

export interface DxfInsert extends DxfEntityBase {
  type: "INSERT"
  blockName: string
  position: Vec2
}

export type DxfEntity = DxfLine | DxfPolyline | DxfInsert | DxfEntityBase

export interface DxfLayer {
  name: string
  colorNumber?: number
}

export interface DxfParsedDocument {
  layers: DxfLayer[]
  entities: DxfEntity[]
}

// Resultado de la conversión.
export interface PlanoFromDxf {
  plano: Plano
  layers: Layer[]
  elements: Element2D[]
}

export function convertDXFToPlano(dxf: DxfParsedDocument, opts: { planoId: UUID; name: string }): PlanoFromDxf {
  const now = new Date().toISOString()

  const layerByDxfName = new Map<string, Layer>()
  const layers: Layer[] = []

  const toColor = (colorNumber?: number): string | undefined => {
    if (typeof colorNumber !== "number") return undefined
    switch (colorNumber) {
      case 1:
        return "#ef4444"
      case 2:
        return "#22c55e"
      case 3:
        return "#3b82f6"
      case 4:
        return "#f97316"
      default:
        return undefined
    }
  }

  for (const l of dxf.layers) {
    const id = createDeterministicId(`${opts.planoId}:layer:${l.name}`)
    const layer: Layer = {
      id,
      name: l.name,
      type: "architectural",
      isLocked: false,
      isVisible: true,
      color: toColor(l.colorNumber),
      dxfLayerName: l.name,
    }
    layers.push(layer)
    layerByDxfName.set(l.name, layer)
  }

  const ensureLayer = (dxfLayerName?: string): Layer => {
    const name = dxfLayerName || "DEFAULT"
    const existing = layerByDxfName.get(name)
    if (existing) return existing
    const id = createDeterministicId(`${opts.planoId}:layer:${name}`)
    const layer: Layer = {
      id,
      name,
      type: "architectural",
      isLocked: false,
      isVisible: true,
      dxfLayerName: name,
    }
    layers.push(layer)
    layerByDxfName.set(name, layer)
    return layer
  }

  const elements: Element2D[] = []

  for (const entity of dxf.entities) {
    const layer = ensureLayer(entity.layer)

    if (entity.type === "LINE") {
      const line = entity as DxfLine
      const wall: Wall = {
        id: createDeterministicId(`${opts.planoId}:wall:${elements.length}`),
        kind: "wall",
        layerId: layer.id,
        start: line.start,
        end: line.end,
        thickness: 0.2,
        height: 2.5,
      }
      elements.push(wall)
      continue
    }

    if (entity.type === "POLYLINE" || entity.type === "LWPOLYLINE") {
      const poly = entity as DxfPolyline
      if (!poly.isClosed || poly.vertices.length < 3) continue
      const zone: Zone = {
        id: createDeterministicId(`${opts.planoId}:zone:${elements.length}`),
        kind: "zone",
        layerId: layer.id,
        name: layer.name,
        polygon: poly.vertices,
        usage: "work",
      }
      elements.push(zone)
      continue
    }

    if (entity.type === "INSERT") {
      const insert = entity as DxfInsert
      const point: PointElement = {
        id: createDeterministicId(`${opts.planoId}:point:${elements.length}`),
        kind: "point",
        layerId: layer.id,
        name: insert.blockName,
        code: insert.blockName,
        position: insert.position,
        pointType: "equipment",
      }
      elements.push(point)
      continue
    }
  }

  const plano: Plano = {
    id: opts.planoId,
    name: opts.name,
    projectId: undefined,
    scaleMetersPerUnit: 1,
    layers,
    elements,
    commits: [],
    createdAt: now,
    updatedAt: now,
  }

  return { plano, layers, elements }
}

// Implementación sencilla de id determinista basada en hash.
function createDeterministicId(input: string): UUID {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return `dxf-${Math.abs(hash)}`
}

// Ejemplo de salida JSON de una conversión DXF mínima.
export const EXAMPLE_PLANO_FROM_DXF: PlanoFromDxf = convertDXFToPlano(
  {
    layers: [{ name: "MUROS" }, { name: "ZONAS" }, { name: "EQUIPAMIENTO" }],
    entities: [
      {
        type: "LINE",
        layer: "MUROS",
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      } as DxfLine,
      {
        type: "LWPOLYLINE",
        layer: "ZONAS",
        isClosed: true,
        vertices: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 5, y: 4 },
          { x: 1, y: 4 },
        ],
      } as DxfPolyline,
      {
        type: "INSERT",
        layer: "EQUIPAMIENTO",
        blockName: "EXTINTOR",
        position: { x: 2, y: 1.5 },
      } as DxfInsert,
    ],
  },
  { planoId: "example-plano", name: "Plano DXF de ejemplo" },
)

