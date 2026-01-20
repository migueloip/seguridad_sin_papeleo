// ... (existing imports)

export interface Vector2 {
    x: number
    y: number
}

export interface Wall {
    id: string
    start: Vector2
    end: Vector2
    height: number
    thickness: number
    layerId?: string
}

export interface Door {
    id: string
    position: Vector2
    rotation: number
    width: number
    height?: number
    layerId?: string
}

export interface Window {
    id: string
    position: Vector2
    rotation: number
    width: number
    height?: number
    layerId?: string
}

export interface GenericSymbol {
    id: string
    type: "electricity" | "sewage" | "fire" | "other"
    position: Vector2
    rotation: number
    layerId: string // Must belong to a layer
}

export interface PlanElement {
    id: string
    type: "point" | "line" | "polygon"
    coordinates: Vector2[]
    properties?: Record<string, any>
}

export interface Layer {
    id: string
    name: string
    visible: boolean
    color: string
    type?: string // Added for compatibility
    elements: GenericSymbol[] // Elements specific to this layer
}

export interface RiskZone {
    id: string
    name: string
    riskLevel: "low" | "medium" | "high" | "critical"
    polygon: Vector2[]
    score: number
}

export interface PlanData {
    width: number
    height: number
    scale: number // pixels per meter
    walls: Wall[]
    doors: Door[]
    windows: Window[]
    layers: Layer[] // Custom layers (elec, sewage, etc)
    zones: RiskZone[]
}
