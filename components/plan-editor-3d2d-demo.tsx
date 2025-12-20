"use client"

// Componente de ejemplo que integra:
// - Editor 2D (Konva) basado en el modelo central
// - Visor 3D (Three.js) sincronizado por id de elemento

import { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { KonvaEditor2D } from "@/src/editor-2d/konva-renderer"
import { createEmptyEditorState } from "@/src/editor-2d/scene-store"
import { createLayer } from "@/src/editor-2d/layer-system"
import type { Editor2DState } from "@/src/editor-2d/types"
import type { Plano, Zone } from "@/src/core"
import { calculateRiskIndex } from "@/src/risk-engine/engine"
import { defaultRiskRules } from "@/src/risk-engine/rules"
import { createViewer3D, type Viewer3DHandle } from "@/src/viewer-3d/viewer3d"

function createDemoPlano(): Plano {
  const now = new Date().toISOString()
  const planoId = "demo-plano"
  const layerId = "demo-layer-architectural"
  const zoneId = "demo-zone-1"

  const zone: Zone = {
    id: zoneId,
    kind: "zone",
    layerId,
    name: "Zona de trabajo",
    polygon: [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ],
    usage: "work",
    relatedZoneIds: [],
  }

  const plano: Plano = {
    id: planoId,
    name: "Plano de demo 2D/3D",
    projectId: undefined,
    scaleMetersPerUnit: 1,
    layers: [
      {
        id: layerId,
        name: "Arquitectónico",
        type: "architectural",
        isLocked: false,
        isVisible: true,
      },
    ],
    elements: [zone],
    commits: [],
    createdAt: now,
    updatedAt: now,
  }

  const risk = calculateRiskIndex({
    plano,
    findings: [],
    rules: defaultRiskRules,
  })
  const summary = risk.byZone.get(zoneId)
  if (summary) {
    ;(plano.elements[0] as Zone).riskSummary = summary
  }

  return plano
}

export function PlanEditor3D2DDemo() {
  const plano = useMemo(createDemoPlano, [])
  const [editorState, setEditorState] = useState<Editor2DState>(() =>
    createEmptyEditorState({
      planoId: plano.id,
      layers: plano.layers,
      elements: plano.elements,
      viewport: {
        center: { x: 3, y: 2 },
        zoom: 50,
      },
    }),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const viewerContainerRef = useRef<HTMLDivElement | null>(null)
  const viewerHandleRef = useRef<Viewer3DHandle | null>(null)

  useEffect(() => {
    const container = viewerContainerRef.current
    if (!container) return
    const handle = createViewer3D(container, plano, { wallHeight: 3 })
    viewerHandleRef.current = handle
    return () => {
      handle.dispose()
      viewerHandleRef.current = null
    }
  }, [plano])

  useEffect(() => {
    viewerHandleRef.current?.highlightElement(selectedId ?? null)
  }, [selectedId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editor 2D / Visor 3D (demo)</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="2d" className="space-y-4">
          <TabsList>
            <TabsTrigger value="2d">2D</TabsTrigger>
            <TabsTrigger value="3d">3D</TabsTrigger>
          </TabsList>
          <TabsContent value="2d">
            <div className="h-72 w-full overflow-hidden rounded-md border bg-muted/40">
              <KonvaEditor2D
                state={editorState}
                onSelectElement={(id) => {
                  setSelectedId(id)
                }}
              />
            </div>
          </TabsContent>
          <TabsContent value="3d">
            <div
              ref={viewerContainerRef}
              className="h-72 w-full overflow-hidden rounded-md border bg-muted/40"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

