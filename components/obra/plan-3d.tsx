"use client"

/**
 * Vista 3D de los planos de la obra: muros y columnas levantados desde los
 * elementos vectoriales (DXF o dibujados), redes como tubos a su altura
 * (alcantarillado enterrado, agua y electricidad por el cielo), hallazgos
 * como pines y el mapa de calor sobre el piso de cada nivel.
 *
 * La escena sale de lib/obra/scene3d.ts (puro); aquí solo se dibuja con
 * three.js / @react-three/fiber. Se carga con next/dynamic sin SSR desde
 * plan-workspace.tsx. Sin WebGL muestra un aviso y se sigue usando el 2D.
 */
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import * as THREE from "three"
import { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js"
import { Box, ChevronDown, Layers, Maximize, Square, TriangleAlert, X } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  computeHeatGrid,
  heatGridToRgba,
  heatPointsFor,
  heatScaleMax,
  type HeatFilter,
  type HeatGrid,
} from "@/lib/obra/heatmap"
import {
  buildScene3D,
  levelElevation,
  SCENE_GROUPS,
  SOLID_GROUPS,
  WALL_GROUPS,
  WALL_HEIGHT_M,
  type Scene3D,
  type SceneGroup,
  type ScenePin,
  type ScenePrimitive,
  type ScenePrism,
} from "@/lib/obra/scene3d"
import {
  ELEMENT_TYPE_LABELS,
  SEVERITY_LABELS,
  type Discipline,
  type FindingPin,
  type PlanElement,
  type PlanLayer,
  type Severity,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { boundsOfLayers, elementDetails, layerFrameOf, levelLabel, levelsOf } from "./plan-canvas"

/** Colores de severidad (mismos tonos que los tokens --sev-* de app/globals.css). */
const SEVERITY_HEX: Record<Severity, string> = {
  critical: "#d8443a",
  high: "#e8960b",
  medium: "#b8841a",
  low: "#6f6a60",
}
const BRAND = "#f3a40a"
const FLOOR_COLOR = "#ece6da"
const GRID_COLOR = "#b9b2a5"
const FOV = 45

export type Plan3DProps = {
  /** Todas las capas de la obra (de todos los niveles). */
  layers: PlanLayer[]
  elementsByLevel: Record<number, PlanElement[]>
  /** Hallazgos ubicados que la persona puede ver. */
  pins: FindingPin[]
  /** Nivel actual (se muestra solo, salvo con «Todos los niveles»). */
  level: number | null
  /** «Todos los niveles» controlado por el padre (si falta, lo maneja el visor). */
  allLevels?: boolean
  onAllLevelsChange?: (v: boolean) => void
  /** Capas y disciplinas ocultas en el panel lateral (se respetan también en 3D). */
  hiddenLayerIds?: number[]
  hiddenDisciplines?: Discipline[]
  showPins?: boolean
  selectedFindingId?: number | null
  /** Mapa de calor sobre el piso (null = apagado). */
  heat?: { filter: HeatFilter; today: string } | null
  onSelectFinding?: (findingId: number) => void
  /** Pide al padre cargar los elementos de otros niveles («Todos los niveles»). */
  onNeedLevels?: (levels: number[]) => void
  /** Espacio (px) reservado abajo: en el celular la hoja inferior fija tapa el borde del lienzo. */
  controlsBottomOffset?: number
  /** Tarjeta para la esquina superior derecha (p.ej. el mapa de calor); en el celular baja a otra fila. */
  overlayEnd?: ReactNode
  ariaLabel?: string
  className?: string
  /** Contenido superpuesto extra (posicionado por quien lo entrega). */
  children?: ReactNode
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function webglAvailable(): boolean {
  if (typeof document === "undefined") return false
  try {
    const canvas = document.createElement("canvas")
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null
    if (!gl) return false
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    return true
  } catch {
    return false
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
}

class WebGLErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error("Vista 3D:", error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// Geometrías unitarias compartidas (se escalan por instancia; nunca se liberan).
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 18, 1)
const UNIT_SPHERE = new THREE.SphereGeometry(1, 14, 10)
const Y_AXIS = new THREE.Vector3(0, 1, 0)

type Shape = "box" | "cylinder" | "sphere"
type Batch = { key: string; group: SceneGroup; color: string; shape: Shape; matrices: THREE.Matrix4[]; elementIds: number[] }

/** Agrupa las primitivas en lotes instanciados por grupo y forma (un draw call por lote). */
function buildBatches(primitives: ScenePrimitive[]): { batches: Batch[]; prisms: ScenePrism[] } {
  const map = new Map<string, Batch>()
  const prisms: ScenePrism[] = []
  const add = (p: ScenePrimitive, shape: Shape, m: THREE.Matrix4, suffix: string = shape) => {
    const key = `${p.group}:${suffix}`
    let b = map.get(key)
    if (!b) {
      b = { key, group: p.group, color: p.color, shape, matrices: [], elementIds: [] }
      map.set(key, b)
    }
    b.matrices.push(m)
    b.elementIds.push(p.element_id)
  }
  const q = new THREE.Quaternion()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const dir = new THREE.Vector3()
  for (const p of primitives) {
    switch (p.kind) {
      case "box":
        add(
          p,
          "box",
          new THREE.Matrix4().compose(
            new THREE.Vector3(p.cx, p.cy, p.cz),
            new THREE.Quaternion().setFromAxisAngle(Y_AXIS, p.rot_y),
            new THREE.Vector3(p.sx, p.sy, p.sz),
          ),
        )
        break
      case "cylinder":
        add(
          p,
          "cylinder",
          new THREE.Matrix4().compose(
            new THREE.Vector3(p.cx, (p.y_bottom + p.y_top) / 2, p.cz),
            new THREE.Quaternion(),
            new THREE.Vector3(p.radius, p.y_top - p.y_bottom, p.radius),
          ),
          "pozo",
        )
        break
      case "tube": {
        const pts = p.points
        for (let i = 1; i < pts.length; i++) {
          a.set(...pts[i - 1])
          b.set(...pts[i])
          dir.subVectors(b, a)
          const len = dir.length()
          if (!(len > 1e-4)) continue
          q.setFromUnitVectors(Y_AXIS, dir.divideScalar(len))
          add(
            p,
            "cylinder",
            new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q.clone(), new THREE.Vector3(p.radius, len, p.radius)),
            "tubo",
          )
          // Unión en cada vértice interior (y en todos si el tubo es cerrado): sin ella los codos quedan abiertos.
          if (i < pts.length - 1 || p.closed) {
            add(p, "sphere", new THREE.Matrix4().compose(b.clone(), new THREE.Quaternion(), new THREE.Vector3(p.radius, p.radius, p.radius)), "union")
          }
        }
        break
      }
      case "prism":
        prisms.push(p)
        break
    }
  }
  const order = (g: SceneGroup) => SCENE_GROUPS.indexOf(g)
  return { batches: [...map.values()].sort((x, y) => order(x.group) - order(y.group) || x.key.localeCompare(y.key)), prisms }
}

type Bounds3 = NonNullable<Scene3D["bounds"]>
type CameraPose = { position: THREE.Vector3; target: THREE.Vector3 }
type ViewKind = "perspectiva" | "planta"

/** Posición de cámara que encuadra la escena: 3/4 desde el «sur» (abajo del plano) o planta cenital. */
function poseFor(kind: ViewKind, b: Bounds3, aspect: number): CameraPose {
  const c = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2)
  const dx = Math.max(b.maxX - b.minX, 1)
  const dy = Math.max(b.maxY - b.minY, 1)
  const dz = Math.max(b.maxZ - b.minZ, 1)
  const vfov = (FOV * Math.PI) / 180
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(aspect, 0.2))
  if (kind === "planta") {
    const dist = Math.max(dz / 2 / Math.tan(vfov / 2), dx / 2 / Math.tan(hfov / 2)) * 1.1 + (b.maxY - c.y)
    // Un pelo hacia +Z: así «arriba» en pantalla es −Z, igual que en el plano 2D.
    return { position: new THREE.Vector3(c.x, c.y + dist, c.z + dist * 1e-3), target: c }
  }
  const r = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz)
  const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 0.85
  const dir = new THREE.Vector3(0.38, 0.78, 0.95).normalize()
  return { position: c.clone().addScaledVector(dir, dist), target: c }
}

/** Paso de cuadrícula "redondo" (m) para ~20–40 líneas en el lado mayor. */
function gridStep(size: number): number {
  const raw = size / 30
  for (const s of [0.5, 1, 2, 5, 10, 20, 50, 100]) if (s >= raw) return s
  return 200
}

// ---------------------------------------------------------------------------
// Piezas de la escena (dentro del <Canvas>)
// ---------------------------------------------------------------------------

type CameraCommand = { kind: ViewKind; nonce: number }

function CameraRig({ bounds, command, reducedMotion }: { bounds: Bounds3 | null; command: CameraCommand; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const anim = useRef<{ from: CameraPose; to: CameraPose; t0: number } | null>(null)

  useEffect(() => {
    const c = new OrbitControlsImpl(camera, gl.domElement)
    c.enableDamping = !reducedMotion
    c.dampingFactor = 0.12
    c.screenSpacePanning = true
    c.maxPolarAngle = Math.PI * 0.62
    c.minDistance = 0.5
    c.maxDistance = 5000
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    const onChange = () => invalidate()
    const onStart = () => {
      anim.current = null
    }
    c.addEventListener("change", onChange)
    c.addEventListener("start", onStart)
    controlsRef.current = c
    invalidate()
    return () => {
      c.removeEventListener("change", onChange)
      c.removeEventListener("start", onStart)
      c.dispose()
      controlsRef.current = null
    }
  }, [camera, gl, invalidate, reducedMotion])

  // Cada orden de cámara (o un encuadre nuevo) mueve la cámara, animada salvo con movimiento reducido.
  useEffect(() => {
    const c = controlsRef.current
    if (!c || !bounds) return
    const to = poseFor(command.kind, bounds, size.width / Math.max(size.height, 1))
    const cam = camera as THREE.PerspectiveCamera
    cam.near = 0.05
    cam.far = Math.max(5000, to.position.distanceTo(to.target) * 20)
    cam.updateProjectionMatrix()
    if (reducedMotion || command.nonce === 0) {
      anim.current = null
      cam.position.copy(to.position)
      c.target.copy(to.target)
      c.update()
    } else {
      anim.current = { from: { position: cam.position.clone(), target: c.target.clone() }, to, t0: performance.now() }
    }
    invalidate()
    // El tamaño solo cuenta al pedir el encuadre; cambiarlo luego no debe mover la cámara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, bounds, camera, invalidate, reducedMotion])

  useFrame(() => {
    const c = controlsRef.current
    if (!c) return
    const a = anim.current
    if (a) {
      const t = Math.min(1, (performance.now() - a.t0) / 550)
      const k = 1 - Math.pow(1 - t, 3)
      camera.position.lerpVectors(a.from.position, a.to.position, k)
      c.target.lerpVectors(a.from.target, a.to.target, k)
      if (t >= 1) anim.current = null
      invalidate()
    }
    c.update()
  })
  return null
}

function InstancedBatch({
  batch,
  ghost,
  highlighted,
  onPick,
}: {
  batch: Batch
  ghost: boolean
  highlighted: number | null
  onPick: (elementId: number) => void
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = batch.shape === "box" ? UNIT_BOX : batch.shape === "sphere" ? UNIT_SPHERE : UNIT_CYLINDER
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    batch.matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [batch])
  const isBox = batch.shape === "box"
  return (
    <>
      <instancedMesh
        key={batch.matrices.length}
        ref={ref}
        args={[geometry, undefined, batch.matrices.length]}
        renderOrder={ghost ? 2 : 0}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.delta > 6 || e.instanceId == null) return
          e.stopPropagation()
          onPick(batch.elementIds[e.instanceId])
        }}
      >
        {/* three.js no recompila un material al cambiar `transparent`: con key se crea otro al activar rayos X. */}
        <meshStandardMaterial
          key={ghost ? "rayos-x" : "solido"}
          color={batch.color}
          roughness={isBox ? 0.92 : 0.45}
          metalness={isBox ? 0 : 0.08}
          transparent={ghost}
          opacity={ghost ? 0.13 : 1}
          depthWrite={!ghost}
        />
      </instancedMesh>
      {highlighted != null && batch.elementIds.includes(highlighted) ? (
        <HighlightInstances batch={batch} elementId={highlighted} geometry={geometry} />
      ) : null}
    </>
  )
}

/** Resalta (contorno ámbar algo mayor) las instancias de un elemento seleccionado. */
function HighlightInstances({ batch, elementId, geometry }: { batch: Batch; elementId: number; geometry: THREE.BufferGeometry }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const matrices = useMemo(() => {
    const grow = new THREE.Matrix4().makeScale(1.12, 1.04, 1.6)
    return batch.matrices.filter((_, i) => batch.elementIds[i] === elementId).map((m) => m.clone().multiply(grow))
  }, [batch, elementId])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices])
  return (
    <instancedMesh key={matrices.length} ref={ref} args={[geometry, undefined, matrices.length]} raycast={() => null} renderOrder={3}>
      <meshBasicMaterial color={BRAND} transparent opacity={0.45} depthWrite={false} />
    </instancedMesh>
  )
}

function PrismMesh({ prism, ghost, onPick }: { prism: ScenePrism; ghost: boolean; onPick: (elementId: number) => void }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(prism.polygon.map(([x, z]) => new THREE.Vector2(x, z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, prism.y_top - prism.y_bottom), bevelEnabled: false })
    // Forma en (x, z) extruida en +profundidad → girar 90° en X la deja hacia −Y; se sube a y_top.
    g.rotateX(Math.PI / 2)
    g.translate(0, prism.y_top, 0)
    return g
  }, [prism])
  useEffect(() => () => geometry.dispose(), [geometry])
  const translucent = ghost || prism.translucent
  return (
    <mesh
      geometry={geometry}
      renderOrder={translucent ? 2 : 0}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 6) return
        e.stopPropagation()
        onPick(prism.element_id)
      }}
    >
      <meshStandardMaterial
        key={translucent ? "translucido" : "solido"}
        color={prism.translucent ? "#8b5e34" : prism.color}
        roughness={0.9}
        transparent={translucent}
        opacity={prism.translucent ? 0.35 : ghost ? 0.13 : 1}
        depthWrite={!translucent}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function Floor({ floor, xray }: { floor: Scene3D["floors"][number]; xray: boolean }) {
  const w = Math.max(floor.maxX - floor.minX, 0.1)
  const d = Math.max(floor.maxZ - floor.minZ, 0.1)
  const grid = useMemo(() => {
    const step = gridStep(Math.max(w, d))
    const pts: number[] = []
    const y = floor.elevation + 0.004
    const x0 = Math.ceil(floor.minX / step) * step
    const z0 = Math.ceil(floor.minZ / step) * step
    for (let x = x0; x <= floor.maxX + 1e-6; x += step) pts.push(x, y, floor.minZ, x, y, floor.maxZ)
    for (let z = z0; z <= floor.maxZ + 1e-6; z += step) pts.push(floor.minX, y, z, floor.maxX, y, z)
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [floor, w, d])
  useEffect(() => () => grid.dispose(), [grid])
  return (
    <group>
      <mesh
        position={[floor.minX + w / 2, floor.elevation - 0.01, floor.minZ + d / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={1}
        raycast={() => null}
      >
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          color={FLOOR_COLOR}
          roughness={1}
          transparent
          opacity={xray ? 0.22 : 0.62}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={grid} renderOrder={1} raycast={() => null}>
        <lineBasicMaterial color={GRID_COLOR} transparent opacity={xray ? 0.25 : 0.45} depthWrite={false} />
      </lineSegments>
    </group>
  )
}

function HeatPlane({ grid, rgba, elevation }: { grid: HeatGrid; rgba: Uint8ClampedArray; elevation: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas")
    canvas.width = grid.cols
    canvas.height = grid.rows
    const ctx = canvas.getContext("2d")
    if (ctx) {
      const img = ctx.createImageData(grid.cols, grid.rows)
      img.data.set(rgba)
      ctx.putImageData(img, 0, 0)
    }
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.generateMipmaps = false
    return t
  }, [grid, rgba])
  useEffect(() => () => texture.dispose(), [texture])
  const w = grid.cols * grid.cell
  const h = grid.rows * grid.cell
  // Plano girado −90° en X: v = 1 (fila 0 de la imagen, flipY) queda en −Z = minY de la grilla, como en 2D.
  return (
    <mesh
      position={[grid.minX + w / 2, elevation + 0.02, grid.minY + h / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={4}
      raycast={() => null}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

function PinMarker({
  pin,
  scale,
  selected,
  onSelect,
  onHover,
}: {
  pin: ScenePin
  scale: number
  selected: boolean
  onSelect?: (id: number) => void
  onHover: (pin: ScenePin | null, e?: ThreeEvent<PointerEvent>) => void
}) {
  const color = SEVERITY_HEX[pin.severity] ?? SEVERITY_HEX.medium
  const height = WALL_HEIGHT_M + 0.6 * scale
  const r = (selected ? 0.3 : 0.22) * scale
  const muted = pin.status === "resolved" || pin.status === "closed"
  return (
    <group
      position={[pin.x, pin.y, pin.z]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 6) return
        e.stopPropagation()
        onSelect?.(pin.finding_id)
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onHover(pin, e)
      }}
      onPointerOut={() => onHover(null)}
    >
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.035 * scale, 0.035 * scale, height, 8]} />
        <meshStandardMaterial color="#3b3329" roughness={0.6} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <sphereGeometry args={[r, 24, 16]} />
        <meshStandardMaterial
          color={color}
          roughness={0.35}
          emissive={color}
          emissiveIntensity={selected ? 0.35 : 0.12}
          transparent={muted}
          opacity={muted ? 0.6 : 1}
        />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[0.16 * scale, (selected ? 0.42 : 0.3) * scale, 32]} />
        <meshBasicMaterial color={selected ? BRAND : color} transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {selected ? (
        <mesh position={[0, height, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r * 1.6, 0.045 * scale, 10, 40]} />
          <meshBasicMaterial color={BRAND} />
        </mesh>
      ) : null}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function Plan3D({
  layers,
  elementsByLevel,
  pins,
  level,
  allLevels: allLevelsProp,
  onAllLevelsChange,
  hiddenLayerIds,
  hiddenDisciplines,
  showPins = true,
  selectedFindingId = null,
  heat = null,
  onSelectFinding,
  onNeedLevels,
  controlsBottomOffset = 0,
  overlayEnd,
  ariaLabel = "Vista 3D del plano",
  className,
  children,
}: Plan3DProps) {
  const [supported] = useState(webglAvailable)
  const [reducedMotion] = useState(prefersReducedMotion)
  const [panelOpen, setPanelOpen] = useState(false)
  const [hiddenGroups, setHiddenGroups] = useState<SceneGroup[]>([])
  const [xray, setXray] = useState(false)
  const [allLevelsState, setAllLevelsState] = useState(false)
  const allLevels = allLevelsProp ?? allLevelsState
  const setAllLevels = (v: boolean) => {
    setAllLevelsState(v)
    onAllLevelsChange?.(v)
  }
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null)
  const [hoverPin, setHoverPin] = useState<{ pin: ScenePin; x: number; y: number } | null>(null)
  const [command, setCommand] = useState<CameraCommand>({ kind: "perspectiva", nonce: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const allLevelList = useMemo(() => levelsOf(layers), [layers])
  const shownLevels = useMemo(
    () => (allLevels ? allLevelList : level != null ? [level] : []),
    [allLevels, allLevelList, level],
  )
  const missingLevels = useMemo(() => shownLevels.filter((l) => !(l in elementsByLevel)), [shownLevels, elementsByLevel])
  useEffect(() => {
    if (missingLevels.length > 0) onNeedLevels?.(missingLevels)
  }, [missingLevels, onNeedLevels])

  const elements = useMemo(() => shownLevels.flatMap((l) => elementsByLevel[l] ?? []), [shownLevels, elementsByLevel])
  const scene = useMemo(
    () =>
      buildScene3D({
        layers,
        elements,
        pins: showPins ? pins : [],
        levels: shownLevels,
        hiddenLayerIds,
        hiddenDisciplines,
        hiddenGroups,
      }),
    [layers, elements, pins, showPins, shownLevels, hiddenLayerIds, hiddenDisciplines, hiddenGroups],
  )
  const { batches, prisms } = useMemo(() => buildBatches(scene.primitives), [scene])
  const elementById = useMemo(() => {
    const m = new Map<number, PlanElement>()
    for (const e of elements) m.set(e.id, e)
    return m
  }, [elements])
  const layerById = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers])

  // Encuadre: sale de los pisos (láminas) de los niveles mostrados, no de los elementos: así ocultar
  // grupos o terminar de cargar no mueve la cámara.
  const frameBounds = useMemo((): Bounds3 | null => {
    const floors = buildScene3D({ layers, elements: [], levels: shownLevels }).floors
    if (floors.length === 0) return null
    return {
      minX: Math.min(...floors.map((f) => f.minX)),
      maxX: Math.max(...floors.map((f) => f.maxX)),
      minZ: Math.min(...floors.map((f) => f.minZ)),
      maxZ: Math.max(...floors.map((f) => f.maxZ)),
      minY: Math.min(...floors.map((f) => f.elevation)) - 0.8,
      maxY: Math.max(...floors.map((f) => f.elevation)) + WALL_HEIGHT_M,
    }
  }, [layers, shownLevels])

  const heatLayers = useMemo(() => {
    if (!heat) return []
    const frameOf = (id: number) => {
      const l = layerById.get(id)
      return l ? layerFrameOf(l) : null
    }
    const grids = shownLevels
      .map((lv) => {
        const b = boundsOfLayers(layers.filter((l) => l.level === lv))
        const pts = b ? heatPointsFor(pins, frameOf, heat.filter, heat.today, lv) : []
        return { level: lv, grid: b && pts.length > 0 ? computeHeatGrid(pts, b) : null }
      })
      .filter((x): x is { level: number; grid: HeatGrid } => x.grid != null)
    // Una sola escala para todos los niveles: el mismo color significa lo mismo en cada piso.
    const scale = heatScaleMax(...grids.map((g) => g.grid))
    return grids.map((g) => ({ ...g, rgba: heatGridToRgba(g.grid, scale) }))
  }, [heat, shownLevels, layers, layerById, pins])

  const pinScale = useMemo(() => {
    const b = frameBounds
    if (!b) return 1
    return Math.min(6, Math.max(1, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 25))
  }, [frameBounds])

  const toggleGroup = useCallback((g: SceneGroup) => {
    setHiddenGroups((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]))
  }, [])
  const presentGroups = scene.groups.map((g) => g.group)
  const onlyWalls = presentGroups.some((g) => WALL_GROUPS.includes(g))
    ? () => setHiddenGroups(presentGroups.filter((g) => !WALL_GROUPS.includes(g)))
    : null

  const onHover = useCallback((pin: ScenePin | null, e?: ThreeEvent<PointerEvent>) => {
    if (!pin || !e) {
      setHoverPin(null)
      return
    }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHoverPin({ pin, x: e.nativeEvent.clientX - rect.left, y: e.nativeEvent.clientY - rect.top })
  }, [])

  const drawnElementIds = useMemo(() => new Set(scene.primitives.map((p) => p.element_id)), [scene])
  // Si el elemento elegido queda oculto (grupo, capa o nivel), su ficha se cierra sola.
  const selectedElement =
    selectedElementId != null && drawnElementIds.has(selectedElementId) ? elementById.get(selectedElementId) ?? null : null
  const selectedLayer = selectedElement ? layerById.get(selectedElement.layer_id) ?? null : null
  const visibleGroupCount = scene.groups.filter((g) => !hiddenGroups.includes(g.group)).length
  const levelLayersCount = layers.filter((l) => shownLevels.includes(l.level)).length
  const loading = missingLevels.length > 0
  const bottom = 12 + Math.max(0, controlsBottomOffset)

  const summary = [
    `${scene.element_count} elemento${scene.element_count === 1 ? "" : "s"} en 3D`,
    ...scene.groups.filter((g) => !hiddenGroups.includes(g.group)).map((g) => `${g.label}: ${g.count}`),
    `${scene.pins.length} hallazgo${scene.pins.length === 1 ? "" : "s"}`,
    xray ? "rayos X activados" : null,
    heat ? "mapa de calor sobre el piso" : null,
  ]
    .filter(Boolean)
    .join(". ")

  const fallback = (
    <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
      <p className="max-w-sm rounded-[12px] border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-sm">
        <TriangleAlert className="mx-auto mb-1.5 h-5 w-5 text-[#b8841a]" aria-hidden />
        Tu navegador o dispositivo no puede mostrar la vista 3D. Usa la vista 2D.
      </p>
    </div>
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden rounded-[14px] border border-border bg-[#fbfaf6] dark:bg-[#1a160f]",
        className,
      )}
      style={{ cursor: hoverPin ? "pointer" : undefined }}
    >
      <section role="region" aria-label={ariaLabel} className="absolute inset-0">
        <p className="sr-only">{summary}.</p>
        {!supported ? (
          fallback
        ) : (
          <WebGLErrorBoundary fallback={fallback}>
            <Canvas
              frameloop="demand"
              dpr={[1, 2]}
              camera={{ fov: FOV, near: 0.05, far: 5000, position: [20, 20, 20] }}
              gl={{ antialias: true, alpha: true }}
              onPointerMissed={() => setSelectedElementId(null)}
              className="touch-none"
              aria-hidden
            >
              <hemisphereLight args={["#ffffff", "#c9c0b0", 1.25]} />
              <directionalLight position={[18, 30, 22]} intensity={1.6} />
              <directionalLight position={[-14, 12, -10]} intensity={0.45} />
              <CameraRig bounds={frameBounds} command={command} reducedMotion={reducedMotion} />
              {scene.floors.map((f) => (
                <Floor key={f.level} floor={f} xray={xray} />
              ))}
              {batches.map((b) => (
                <InstancedBatch
                  key={b.key}
                  batch={b}
                  ghost={xray && SOLID_GROUPS.includes(b.group)}
                  highlighted={selectedElementId}
                  onPick={setSelectedElementId}
                />
              ))}
              {prisms.map((p, i) => (
                <PrismMesh
                  key={`${p.element_id}-${i}`}
                  prism={p}
                  ghost={xray && SOLID_GROUPS.includes(p.group)}
                  onPick={setSelectedElementId}
                />
              ))}
              {heatLayers.map((h) => (
                <HeatPlane key={h.level} grid={h.grid} rgba={h.rgba} elevation={levelElevation(h.level)} />
              ))}
              {scene.pins.map((p) => (
                <PinMarker
                  key={p.finding_id}
                  pin={p}
                  scale={pinScale}
                  selected={p.finding_id === selectedFindingId}
                  onSelect={onSelectFinding}
                  onHover={onHover}
                />
              ))}
            </Canvas>
          </WebGLErrorBoundary>
        )}
      </section>

      {/* Fila superior: capas 3D a la izquierda; tarjeta del padre (mapa de calor) a la derecha */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
        <div className="flex w-[min(300px,100%)] flex-col gap-2">
          <section
            aria-label="Capas de la vista 3D"
            className="pointer-events-auto rounded-[12px] border border-border bg-card/95 text-[12px] shadow-sm backdrop-blur"
          >
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              aria-controls="vista-3d-capas"
              className="flex min-h-10 w-full items-center gap-2 rounded-[12px] px-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-semibold">Capas 3D</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {visibleGroupCount} de {scene.groups.length}
                  {xray ? " · rayos X" : ""}
                </span>
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", panelOpen && "rotate-180")} aria-hidden />
            </button>
            <div id="vista-3d-capas" hidden={!panelOpen} className="space-y-2.5 border-t border-border px-3 pb-3 pt-2.5">
              {scene.groups.length > 0 ? (
                <>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Qué mostrar">
                    {scene.groups.map((g) => {
                      const on = !hiddenGroups.includes(g.group)
                      return (
                        <li key={g.group}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleGroup(g.group)}
                            className={cn(
                              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                              on ? "border-border bg-card text-foreground" : "border-dashed border-border bg-transparent text-muted-foreground line-through",
                            )}
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                              style={{ background: on ? g.color : "transparent" }}
                              aria-hidden
                            />
                            {g.label}
                            <span className="text-muted-foreground">{g.count}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="flex gap-1.5">
                    {onlyWalls ? (
                      <button
                        type="button"
                        onClick={onlyWalls}
                        className="min-h-9 flex-1 rounded-[9px] border border-border bg-secondary px-2 font-medium outline-none hover:bg-secondary/70 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        Solo muros
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setHiddenGroups([])}
                      disabled={hiddenGroups.length === 0}
                      className="min-h-9 flex-1 rounded-[9px] border border-border bg-secondary px-2 font-medium outline-none hover:bg-secondary/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      Mostrar todo
                    </button>
                  </div>
                </>
              ) : null}
              <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3">
                <span>
                  <span className="font-medium">Rayos X</span>
                  <span className="block text-[11px] text-muted-foreground">Muros y piso transparentes: se ven las redes enterradas.</span>
                </span>
                <Switch checked={xray} onCheckedChange={setXray} aria-label="Rayos X" />
              </label>
              {allLevelList.length > 1 ? (
                <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">Todos los niveles</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {allLevels
                        ? `${allLevelList.length} niveles apilados`
                        : `Solo ${level != null ? levelLabel(layers, level) : "el nivel actual"}`}
                    </span>
                  </span>
                  <Switch checked={allLevels} onCheckedChange={setAllLevels} aria-label="Todos los niveles" />
                </label>
              ) : null}
            </div>
          </section>
          {selectedElement ? (
            <div
              className="pointer-events-auto rounded-[12px] border border-border bg-card px-3 py-2.5 text-[12px] shadow-md"
              role="dialog"
              aria-label="Elemento seleccionado"
            >
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 font-semibold">
                  {ELEMENT_TYPE_LABELS[selectedElement.element_type] ?? selectedElement.element_type}
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedElementId(null)}
                  aria-label="Cerrar"
                  className="-mr-1 -mt-1 flex size-8 items-center justify-center rounded-md outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              {selectedElement.label ? <p className="break-words">«{selectedElement.label}»</p> : null}
              {elementDetails(selectedElement, selectedLayer).map((line) => (
                <p key={line} className="break-words text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        {overlayEnd ? <div className="pointer-events-auto ml-auto w-[min(280px,100%)]">{overlayEnd}</div> : null}
      </div>

      {/* Avisos */}
      {supported ? (
        <div className="pointer-events-none absolute inset-x-3 z-10 flex justify-center" style={{ bottom: bottom + 2 }}>
          {levelLayersCount === 0 ? (
            <p className="rounded-[10px] bg-card/95 px-3 py-2 text-center text-[13px] text-muted-foreground shadow-sm">
              Este nivel no tiene capas.
            </p>
          ) : loading ? (
            <p className="rounded-full bg-card/95 px-3 py-1.5 text-[12px] text-muted-foreground shadow-sm" role="status">
              Cargando elementos…
            </p>
          ) : scene.groups.length === 0 ? (
            <p className="mr-14 max-w-md rounded-[10px] bg-card/95 px-3 py-2 text-[12px] text-muted-foreground shadow-sm">
              Las capas de este nivel no tienen elementos dibujados (son imágenes): la vista 3D levanta solo elementos vectoriales
              importados de DXF o dibujados en el plano. Los hallazgos y el mapa de calor sí se muestran.
            </p>
          ) : visibleGroupCount === 0 ? (
            <p className="mr-14 rounded-[10px] bg-card/95 px-3 py-2 text-[12px] text-muted-foreground shadow-sm">
              Todo está oculto. Usa «Mostrar todo» en Capas 3D.
            </p>
          ) : scene.truncated ? (
            <p className="mr-14 rounded-[10px] bg-card/95 px-3 py-2 text-[12px] text-muted-foreground shadow-sm">
              Plano muy grande: se muestra una parte de los elementos.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Ayuda de navegación */}
      {supported && !selectedElement ? (
        <p
          className="pointer-events-none absolute left-3 z-0 hidden rounded-md bg-card/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm sm:block"
          style={{ bottom }}
          aria-hidden
        >
          Arrastra para girar · clic derecho o Mayús para desplazar · rueda para acercar
        </p>
      ) : null}

      {/* Tooltip del hallazgo bajo el mouse */}
      {hoverPin ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 max-w-[240px] rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] shadow-md"
          style={{ left: hoverPin.x + 14, top: Math.max(8, hoverPin.y - 10) }}
        >
          <p className="font-semibold">{hoverPin.pin.title}</p>
          <p className="text-muted-foreground">Gravedad {SEVERITY_LABELS[hoverPin.pin.severity].toLowerCase()}</p>
        </div>
      ) : null}

      {/* Cámara */}
      {supported ? (
        <div
          className="absolute right-3 z-10 flex flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-sm"
          style={{ bottom }}
        >
          {(
            [
              ["perspectiva", "Vista en perspectiva", Box],
              ["planta", "Vista en planta (desde arriba)", Square],
            ] as const
          ).map(([kind, label, Icon], i) => (
            <button
              key={kind}
              type="button"
              onClick={() => setCommand((c) => ({ kind, nonce: c.nonce + 1 }))}
              aria-label={label}
              title={label}
              aria-pressed={command.kind === kind}
              className={cn(
                "flex size-10 items-center justify-center outline-none hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
                i > 0 && "border-t border-border",
                command.kind === kind && "text-[#b8841a]",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCommand((c) => ({ kind: c.kind, nonce: c.nonce + 1 }))}
            aria-label="Encajar la obra en la pantalla"
            title="Encajar"
            className="flex size-10 items-center justify-center border-t border-border outline-none hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            <Maximize className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {children}
    </div>
  )
}
