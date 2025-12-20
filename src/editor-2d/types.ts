import type { Element2D, Layer, Vec2, UUID } from "@/src/core"

// Elemento seleccionado actualmente en el editor 2D.
export type Selection =
  | { kind: "none" }
  | { kind: "element"; elementId: UUID }
  | { kind: "layer"; layerId: UUID }

// Estado interno del editor 2D desacoplado del renderizado.
export interface Editor2DState {
  planoId: UUID
  layers: Layer[]
  elements: Element2D[]
  selection: Selection
  // Matriz de vista simple para pan/zoom.
  viewport: ViewportState
}

export interface ViewportState {
  center: Vec2
  zoom: number
}

export type EditorTool = "select" | "wall" | "zone" | "point" | "erase"

export interface EditorInteractionState {
  activeTool: EditorTool
  isDrawing: boolean
  currentPoints: Vec2[]
}

