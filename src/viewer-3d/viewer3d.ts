// Visualizador 3D basado en Three.js a partir del modelo 2D.
// Extruye muros y zonas, y permite sincronizar la selección con el editor 2D.

import * as THREE from "three"
import type { Element2D, Plano, UUID, Wall, Zone } from "@/src/core"

export interface Viewer3DOptions {
  wallHeight?: number
  zoneHeight?: number
}

export interface Viewer3DHandle {
  dispose: () => void
  highlightElement: (elementId: UUID | null) => void
}

export function createViewer3D(
  container: HTMLElement,
  plano: Plano,
  options: Viewer3DOptions = {},
): Viewer3DHandle {
  const wallHeight = options.wallHeight ?? 2.5
  const zoneHeight = options.zoneHeight ?? 0.1

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf3f4f6)

  const width = container.clientWidth || 800
  const height = container.clientHeight || 600

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
  camera.position.set(10, 10, 10)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  container.appendChild(renderer.domElement)

  const ambient = new THREE.AmbientLight(0xffffff, 0.8)
  scene.add(ambient)

  const directional = new THREE.DirectionalLight(0xffffff, 0.6)
  directional.position.set(10, 20, 10)
  scene.add(directional)

  const grid = new THREE.GridHelper(50, 50)
  scene.add(grid)

  const elementMeshes = new Map<UUID, THREE.Mesh>()

  const extrudeWall = (wall: Wall) => {
    const dx = wall.end.x - wall.start.x
    const dy = wall.end.y - wall.start.y
    const length = Math.sqrt(dx * dx + dy * dy) || 0.001
    const thickness = wall.thickness || 0.2

    const geometry = new THREE.BoxGeometry(length, wallHeight, thickness)
    const material = new THREE.MeshStandardMaterial({ color: 0x111827 })
    const mesh = new THREE.Mesh(geometry, material)

    const angle = Math.atan2(dy, dx)
    mesh.rotation.y = -angle

    const midX = (wall.start.x + wall.end.x) / 2
    const midY = (wall.start.y + wall.end.y) / 2
    mesh.position.set(midX, wallHeight / 2, midY)

    scene.add(mesh)
    elementMeshes.set(wall.id, mesh)
  }

  const extrudeZone = (zone: Zone) => {
    if (zone.polygon.length < 3) return
    const shape = new THREE.Shape()
    const [first, ...rest] = zone.polygon
    shape.moveTo(first.x, first.y)
    for (const p of rest) {
      shape.lineTo(p.x, p.y)
    }
    shape.lineTo(first.x, first.y)

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: zoneHeight,
      bevelEnabled: false,
    })
    const color = zone.riskSummary ? riskLevelToColor(zone.riskSummary.level) : 0x3b82f6
    const material = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.6,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    scene.add(mesh)
    elementMeshes.set(zone.id, mesh)
  }

  for (const element of plano.elements) {
    if (element.kind === "wall") {
      extrudeWall(element)
    } else if (element.kind === "zone") {
      extrudeZone(element)
    }
  }

  let animationFrame: number | null = null
  const animate = () => {
    animationFrame = requestAnimationFrame(animate)
    renderer.render(scene, camera)
  }
  animate()

  const highlightElement = (elementId: UUID | null) => {
    elementMeshes.forEach((mesh, id) => {
      const isHighlighted = elementId && id === elementId
      if (!(mesh instanceof THREE.Mesh)) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (Array.isArray(material)) return
      if (isHighlighted) {
        material.emissive = new THREE.Color(0xf97316)
        material.emissiveIntensity = 0.6
      } else {
        material.emissive = new THREE.Color(0x000000)
        material.emissiveIntensity = 0
      }
    })
  }

  const handleResize = () => {
    const w = container.clientWidth || 800
    const h = container.clientHeight || 600
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }

  window.addEventListener("resize", handleResize)

  const dispose = () => {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
    }
    window.removeEventListener("resize", handleResize)
    elementMeshes.forEach((mesh) => {
      scene.remove(mesh)
      if (mesh instanceof THREE.Mesh) {
        mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose())
        } else {
          mesh.material.dispose()
        }
      }
    })
    renderer.dispose()
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement)
    }
  }

  return { dispose, highlightElement }
}

function riskLevelToColor(level: NonNullable<Zone["riskSummary"]>["level"]): number {
  switch (level) {
    case "low":
      return 0x16a34a
    case "medium":
      return 0xeab308
    case "high":
      return 0xf97316
    case "critical":
      return 0xef4444
    default:
      return 0x3b82f6
  }
}
