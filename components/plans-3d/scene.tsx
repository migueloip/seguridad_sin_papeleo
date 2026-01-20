import { Canvas, useThree, ThreeEvent } from "@react-three/fiber"
import { OrbitControls, Grid, Environment } from "@react-three/drei"
import { PlanData, Wall, Door, Window, GenericSymbol, Layer } from "./types"
import { useState } from "react"
import * as THREE from "three"
import { generateUUID } from "@/lib/utils"

function Doors({ doors, height, mode }: { doors: Door[], height: number, mode: "2d" | "3d" }) {
    return (
        <group>
            {doors.map(door => (
                <mesh
                    key={door.id}
                    position={[door.position.x, height / 2, door.position.y]}
                    rotation={[0, -door.rotation, 0]}
                >
                    <boxGeometry args={[door.width, height, 0.2]} />
                    <meshStandardMaterial color="#a16207" />
                </mesh>
            ))}
        </group>
    )
}

function Windows({ windows, height, mode }: { windows: Window[], height: number, mode: "2d" | "3d" }) {
    return (
        <group>
            {windows.map(window => (
                <mesh
                    key={window.id}
                    position={[window.position.x, height / 2, window.position.y]}
                    rotation={[0, -window.rotation, 0]}
                >
                    <boxGeometry args={[window.width, height * 0.6, 0.1]} />
                    <meshStandardMaterial color="#60a5fa" transparent opacity={0.6} />
                </mesh>
            ))}
        </group>
    )
}

function LayerElements({ layers, height, mode }: { layers: Layer[], height: number, mode: "2d" | "3d" }) {
    return (
        <group>
            {layers.filter(l => l.visible).map(layer => (
                <group key={layer.id}>
                    {layer.elements.map(el => (
                        <mesh
                            key={el.id}
                            position={[el.position.x, 0.5, el.position.y]}
                        >
                            <sphereGeometry args={[0.3]} />
                            <meshStandardMaterial color={layer.color} />
                        </mesh>
                    ))}
                </group>
            ))}
        </group>
    )
}

interface SceneProps {
    data: PlanData
    mode: "2d" | "3d"
    activeTool?: string
    onUpdate?: (data: PlanData) => void
}

export function PlanScene({ data, mode, activeTool, onUpdate }: SceneProps) {
    const handleDelete = (id: string, type: "wall" | "zone") => {
        if (!onUpdate) return

        if (type === "wall") {
            const newWalls = data.walls.filter(w => w.id !== id)
            onUpdate({ ...data, walls: newWalls })
        } else if (type === "zone") {
            const newZones = data.zones.filter(z => z.id !== id)
            onUpdate({ ...data, zones: newZones })
        }
    }

    return (
        <div className="h-full w-full bg-slate-50 dark:bg-slate-900 rounded-lg overflow-hidden border border-border">
            <Canvas
                camera={{ position: [data.width / 2, 50, data.height / 2], fov: 45 }}
                shadows
            >
                <ambientLight intensity={0.5} />
                <directionalLight position={[10, 10, 10]} intensity={1} castShadow />
                <Environment preset="city" />

                <group position={[-data.width / 2, 0, -data.height / 2]}>
                    <Walls
                        walls={data.walls}
                        height={mode === "3d" ? 3 : 0.1}
                        activeTool={activeTool}
                        onDelete={handleDelete}
                        mode={mode}
                    />
                    <Doors doors={data.doors || []} height={mode === "3d" ? 2.2 : 0.1} mode={mode} />
                    <Windows windows={data.windows || []} height={mode === "3d" ? 1.5 : 0.1} mode={mode} />
                    <ZoneOverlay
                        zones={data.zones}
                        height={0.1}
                        activeTool={activeTool}
                        onDelete={handleDelete}
                        mode={mode}
                    />
                    <LayerElements layers={data.layers || []} height={0.5} mode={mode} />

                    <Grid
                        position={[data.width / 2, 0, data.height / 2]}
                        args={[100, 100]}
                        cellSize={1}
                        cellThickness={0.5}
                        cellColor="#94a3b8"
                        sectionSize={5}
                        sectionThickness={1}
                        sectionColor="#64748b"
                        fadeDistance={100}
                        infiniteGrid
                    />

                    <EditorControls mode={mode} activeTool={activeTool} onUpdate={onUpdate} data={data} />
                </group>

                <OrbitControls
                    makeDefault
                    target={[0, 0, 0]}
                    minPolarAngle={0}
                    maxPolarAngle={mode === "2d" ? 0 : Math.PI / 2.1}
                    enableRotate={mode === "3d"}
                    enabled={!activeTool || activeTool === "select" || activeTool === "delete"}
                />
            </Canvas>
        </div>
    )
}

function Walls({ walls, height, activeTool, onDelete, mode }: { walls: PlanData["walls"]; height: number; activeTool?: string; onDelete?: (id: string, type: "wall") => void; mode?: "2d" | "3d" }) {
    return (
        <group>
            {walls.map((wall) => {
                const length = Math.sqrt(
                    Math.pow(wall.end.x - wall.start.x, 2) + Math.pow(wall.end.y - wall.start.y, 2)
                )
                const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x)
                const midX = (wall.start.x + wall.end.x) / 2
                const midY = (wall.start.y + wall.end.y) / 2

                // Visual style for 2D vs 3D
                const color = activeTool === "delete"
                    ? "#ef4444"
                    : mode === "2d"
                        ? "#000000"
                        : "#cbd5e1"

                return (
                    <mesh
                        key={wall.id}
                        position={[midX, height / 2, midY]}
                        rotation={[0, -angle, 0]}
                        onClick={(e) => {
                            if (activeTool === "delete" && onDelete) {
                                e.stopPropagation()
                                onDelete(wall.id, "wall")
                            }
                        }}
                    >
                        <boxGeometry args={[length, height, wall.thickness]} />
                        <meshStandardMaterial
                            color={color}
                            transparent
                            opacity={activeTool === "delete" ? 0.8 : 1}
                        />
                        {/* In 2D, maybe add an outline? or just solid black is fine. */}
                    </mesh>
                )
            })}
        </group>
    )
}

function PreviewWall({ start, end }: { start: THREE.Vector3, end: THREE.Vector3 }) {
    const length = Math.sqrt(
        Math.pow(end.x - start.x, 2) + Math.pow(end.z - start.z, 2)
    )
    const angle = Math.atan2(end.z - start.z, end.x - start.x)
    const midX = (start.x + end.x) / 2
    const midZ = (start.z + end.z) / 2

    return (
        <mesh
            position={[midX, 1.5, midZ]}
            rotation={[0, -angle, 0]}
        >
            <boxGeometry args={[length, 3, 0.2]} />
            <meshStandardMaterial color="#94a3b8" transparent opacity={0.5} />
        </mesh>
    )
}

function ZoneOverlay({ zones, height, activeTool, onDelete, mode }: { zones: PlanData["zones"]; height: number; activeTool?: string; onDelete?: (id: string, type: "zone") => void; mode?: "2d" | "3d" }) {
    return (
        <group position={[0, height + 0.01, 0]}>
            {zones.map((zone) => {
                const shape = new THREE.Shape()
                if (zone.polygon.length > 0) {
                    shape.moveTo(zone.polygon[0].x, zone.polygon[0].y)
                    for (let i = 1; i < zone.polygon.length; i++) {
                        shape.lineTo(zone.polygon[i].x, zone.polygon[i].y)
                    }
                    shape.closePath()
                }

                const color =
                    zone.riskLevel === "critical"
                        ? "#ef4444"
                        : zone.riskLevel === "high"
                            ? "#f97316"
                            : zone.riskLevel === "medium"
                                ? "#eab308"
                                : "#22c55e"

                return (
                    <mesh
                        key={zone.id}
                        rotation={[Math.PI / 2, 0, 0]} // Fixed syntax error here
                        position={[0, 0.05, 0]}
                        onClick={(e) => {
                            if (activeTool === "delete" && onDelete) {
                                e.stopPropagation()
                                onDelete(zone.id, "zone")
                            }
                        }}
                    >
                        <shapeGeometry args={[shape]} />
                        <meshBasicMaterial
                            color={activeTool === "delete" ? "#ef4444" : color}
                            transparent
                            opacity={activeTool === "delete" ? 0.6 : 0.3}
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                )
            })}
        </group>
    )
}

function EditorControls({ mode, activeTool, onUpdate, data }: { mode: "2d" | "3d", activeTool?: string, onUpdate?: (d: PlanData) => void, data: PlanData }) {
    const [startPoint, setStartPoint] = useState<THREE.Vector3 | null>(null)
    const [currentPoint, setCurrentPoint] = useState<THREE.Vector3 | null>(null)
    const [zonePoints, setZonePoints] = useState<THREE.Vector3[]>([])
    const { camera } = useThree()

    // Helper for grid snapping
    const snapToGrid = (point: THREE.Vector3) => {
        return new THREE.Vector3(
            Math.round(point.x),
            0,
            Math.round(point.z)
        )
    }

    const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
        if (mode !== "2d" || !onUpdate || !activeTool) return
        e.stopPropagation()
        const rawPoint = e.point.clone()
        const point = snapToGrid(rawPoint)

        if (activeTool === "wall") {
            if (!startPoint) {
                setStartPoint(point)
                setCurrentPoint(point)
            } else {
                // Finish wall
                if (point.distanceTo(startPoint) > 0.1) {
                    const newWall: Wall = {
                        id: generateUUID(),
                        start: { x: startPoint.x, y: startPoint.z },
                        end: { x: point.x, y: point.z },
                        height: 3,
                        thickness: 0.2
                    }
                    const newData = { ...data, walls: [...data.walls, newWall] }
                    onUpdate(newData)
                }
                setStartPoint(null)
                setCurrentPoint(null)
            }
        } else if (activeTool === "zone") {
            // Add point to current zone polygon
            const newPoints = [...zonePoints, point]
            setZonePoints(newPoints)
            // Close zone if close to start
            if (newPoints.length > 2 && point.distanceTo(newPoints[0]) < 0.5) {
                // Close and create
                const newZone: any = { // RiskZone import needed or assume implicit
                    id: generateUUID(),
                    name: `Zona ${data.zones.length + 1}`,
                    riskLevel: "medium",
                    score: 50,
                    polygon: newPoints.slice(0, newPoints.length - 1).map(p => ({ x: p.x, y: p.z }))
                }
                const newData = { ...data, zones: [...data.zones, newZone] }
                onUpdate(newData)
                setZonePoints([])
            }
        } else if (activeTool === "door") {
            const newDoor: Door = {
                id: generateUUID(),
                position: { x: point.x, y: point.z },
                rotation: 0,
                width: 1
            }
            onUpdate({ ...data, doors: [...(data.doors || []), newDoor] })
        } else if (activeTool === "window") {
            const newWindow: Window = {
                id: generateUUID(),
                position: { x: point.x, y: point.z },
                rotation: 0,
                width: 1
            }
            onUpdate({ ...data, windows: [...(data.windows || []), newWindow] })
        } else if (activeTool.startsWith("symbol:")) {
            const parts = activeTool.split(":") // symbol:layerId:type
            if (parts.length >= 3) {
                const layerId = parts[1]
                const type = parts[2] as any
                const newSymbol: GenericSymbol = {
                    id: generateUUID(),
                    type: type,
                    position: { x: point.x, y: point.z },
                    rotation: 0,
                    layerId: layerId
                }

                const newLayers = data.layers.map(l => {
                    if (l.id === layerId) {
                        return { ...l, elements: [...(l.elements || []), newSymbol] }
                    }
                    return l
                })
                onUpdate({ ...data, layers: newLayers })
            }
        }
    }

    const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
        if (mode !== "2d" || !activeTool) return
        e.stopPropagation()
        const rawPoint = e.point.clone()
        const point = snapToGrid(rawPoint)
        setCurrentPoint(point)
    }

    // Determine cursor color based on tool
    const getCursorColor = () => {
        if (activeTool === "wall") return "#3b82f6"
        if (activeTool === "zone") return "#f59e0b"
        if (activeTool === "door") return "#854d0e"
        if (activeTool === "window") return "#60a5fa"
        if (activeTool?.startsWith("symbol")) return "#ec4899"
        return "#ffffff"
    }

    return (
        <group>
            {/* Invisible plane for raycasting over the grid */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}>
                <planeGeometry args={[1000, 1000]} />
                <meshBasicMaterial visible={false} />
            </mesh>

            {/* Cursor Helper */}
            {mode === "2d" && activeTool && activeTool !== "select" && activeTool !== "delete" && currentPoint && (
                <mesh position={[currentPoint.x, 0.1, currentPoint.z]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.3, 0.4, 32]} />
                    <meshBasicMaterial color={getCursorColor()} />
                </mesh>
            )}

            {/* Wall Drawing Preview */}
            {activeTool === "wall" && startPoint && currentPoint && (
                <group>
                    <PreviewWall start={startPoint} end={currentPoint} />
                    {/* Wall Length Label */}
                    {/* Text rendering in 3D is heavy, skipping for now or perform simple distance log */}
                </group>
            )}

            {/* Zone Drawing Preview */}
            {activeTool === "zone" && zonePoints.length > 0 && currentPoint && (
                <line>
                    <bufferGeometry>
                        <bufferAttribute
                            attach="attributes-position"
                            args={[
                                new Float32Array([
                                    ...zonePoints.flatMap(p => [p.x, 0.2, p.z]),
                                    currentPoint.x, 0.2, currentPoint.z
                                ]),
                                3
                            ]}
                        />
                    </bufferGeometry>
                    <lineBasicMaterial color="#f59e0b" linewidth={2} />
                </line>
            )}
        </group>
    )
}


