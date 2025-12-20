"use client"

import { useEffect, useRef } from "react"
import Konva from "konva"
import type { Element2D, Vec2, Zone, Wall, PointElement } from "@/src/core"
import type { Editor2DState } from "./types"

export interface KonvaEditorProps {
  state: Editor2DState
  onSelectElement?: (id: string | null) => void
}

// Convierte coordenadas del modelo a coordenadas de canvas aplicando zoom.
function toCanvasPoint(p: Vec2, viewport: Editor2DState["viewport"]): Vec2 {
  return {
    x: (p.x - viewport.center.x) * viewport.zoom,
    y: (p.y - viewport.center.y) * viewport.zoom,
  }
}

export function KonvaEditor2D({ state, onSelectElement }: KonvaEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const width = container.clientWidth || 800
    const height = container.clientHeight || 600

    const stage = new Konva.Stage({
      container,
      width,
      height,
    })
    const layer = new Konva.Layer()
    stage.add(layer)

    stageRef.current = stage

    return () => {
      stage.destroy()
      stageRef.current = null
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    const container = containerRef.current
    if (!stage || !container) return
    const width = container.clientWidth || 800
    const height = container.clientHeight || 600
    stage.size({ width, height })

    const layer = stage.getLayers()[0]
    layer.destroyChildren()

    const visibleLayerIds = new Set(state.layers.filter((l) => l.isVisible).map((l) => l.id))

    const drawWall = (wall: Wall) => {
      const p1 = toCanvasPoint(wall.start, state.viewport)
      const p2 = toCanvasPoint(wall.end, state.viewport)
      const line = new Konva.Line({
        points: [p1.x, p1.y, p2.x, p2.y],
        stroke: "#111827",
        strokeWidth: Math.max(1, wall.thickness * state.viewport.zoom),
        listening: true,
      })
      line.on("click tap", () => {
        onSelectElement?.(wall.id)
      })
      layer.add(line)
    }

    const drawZone = (zone: Zone) => {
      const points = zone.polygon
        .map((p) => toCanvasPoint(p, state.viewport))
        .flatMap((p) => [p.x, p.y])
      const polygon = new Konva.Line({
        points,
        closed: true,
        fill: zone.riskSummary
          ? getRiskColor(zone.riskSummary.level)
          : "rgba(37,99,235,0.08)",
        stroke: "#1d4ed8",
        strokeWidth: 1,
        listening: true,
      })
      polygon.on("click tap", () => {
        onSelectElement?.(zone.id)
      })
      layer.add(polygon)
    }

    const drawPoint = (point: PointElement) => {
      const p = toCanvasPoint(point.position, state.viewport)
      const circle = new Konva.Circle({
        x: p.x,
        y: p.y,
        radius: 3,
        fill: "#ef4444",
        stroke: "#b91c1c",
        strokeWidth: 1,
        listening: true,
      })
      circle.on("click tap", () => {
        onSelectElement?.(point.id)
      })
      layer.add(circle)
    }

    for (const element of state.elements) {
      if (!visibleLayerIds.has(element.layerId)) continue
      if (element.kind === "wall") drawWall(element)
      if (element.kind === "zone") drawZone(element)
      if (element.kind === "point") drawPoint(element)
    }

    layer.draw()
  }, [state, onSelectElement])

  return <div ref={containerRef} className="h-full w-full" />
}

function getRiskColor(level: NonNullable<Zone["riskSummary"]>["level"]): string {
  switch (level) {
    case "low":
      return "rgba(22,163,74,0.25)"
    case "medium":
      return "rgba(234,179,8,0.25)"
    case "high":
      return "rgba(249,115,22,0.25)"
    case "critical":
      return "rgba(239,68,68,0.3)"
    default:
      return "rgba(37,99,235,0.1)"
  }
}

