import type { Element2D, PointElement, Vec2, Wall, Zone, UUID } from "@/src/core"
import type { Editor2DState, EditorTool, Selection, ViewportState } from "./types"

// Crea un estado inicial de editor para un plano.
export function createEmptyEditorState(params: {
  planoId: UUID
  layers: Editor2DState["layers"]
  elements?: Element2D[]
  viewport?: Partial<ViewportState>
}): Editor2DState {
  return {
    planoId: params.planoId,
    layers: params.layers,
    elements: params.elements ?? [],
    selection: { kind: "none" },
    viewport: {
      center: params.viewport?.center ?? { x: 0, y: 0 },
      zoom: params.viewport?.zoom ?? 1,
    },
  }
}

// Agrega un nuevo elemento en función de la herramienta activa.
export function addElement(
  state: Editor2DState,
  tool: EditorTool,
  layerId: UUID,
  points: Vec2[],
  idGenerator: () => UUID,
): Editor2DState {
  const nextElements = state.elements.slice()
  if (tool === "wall" && points.length >= 2) {
    const [start, end] = points
    const wall: Wall = {
      id: idGenerator(),
      kind: "wall",
      layerId,
      start,
      end,
      thickness: 0.2,
      height: 2.5,
    }
    nextElements.push(wall)
  } else if (tool === "zone" && points.length >= 3) {
    const zone: Zone = {
      id: idGenerator(),
      kind: "zone",
      layerId,
      name: "Zona",
      polygon: points,
      usage: "work",
    }
    nextElements.push(zone)
  } else if (tool === "point" && points.length >= 1) {
    const point: PointElement = {
      id: idGenerator(),
      kind: "point",
      layerId,
      name: "Punto",
      pointType: "equipment",
      position: points[0],
    }
    nextElements.push(point)
  }
  return {
    ...state,
    elements: nextElements,
  }
}

// Elimina un elemento por id.
export function removeElement(state: Editor2DState, elementId: UUID): Editor2DState {
  return {
    ...state,
    elements: state.elements.filter((e) => e.id !== elementId),
    selection:
      state.selection.kind === "element" && state.selection.elementId === elementId
        ? { kind: "none" }
        : state.selection,
  }
}

// Selecciona un elemento.
export function selectElement(state: Editor2DState, elementId: UUID | null): Editor2DState {
  const selection: Selection = elementId ? { kind: "element", elementId } : { kind: "none" }
  return {
    ...state,
    selection,
  }
}

// Mueve un elemento en 2D aplicando un delta.
export function translateElement(state: Editor2DState, elementId: UUID, delta: Vec2): Editor2DState {
  const elements = state.elements.map((el) => {
    if (el.id !== elementId) return el
    if (el.kind === "wall") {
      const wall = el
      return {
        ...wall,
        start: { x: wall.start.x + delta.x, y: wall.start.y + delta.y },
        end: { x: wall.end.x + delta.x, y: wall.end.y + delta.y },
      } as Wall
    }
    if (el.kind === "zone") {
      const zone = el
      return {
        ...zone,
        polygon: zone.polygon.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
      } as Zone
    }
    if (el.kind === "point") {
      const point = el
      return {
        ...point,
        position: { x: point.position.x + delta.x, y: point.position.y + delta.y },
      } as PointElement
    }
    return el
  })
  return {
    ...state,
    elements,
  }
}

// Actualiza el viewport (zoom + pan).
export function updateViewport(state: Editor2DState, viewport: Partial<ViewportState>): Editor2DState {
  return {
    ...state,
    viewport: {
      ...state.viewport,
      ...viewport,
    },
  }
}

