"use client"

import { useState, useCallback, useEffect } from "react"
import { PlanData } from "./types"
import { PlanScene } from "./scene"
import { LayerControls } from "./layer-controls"
import { Button } from "@/components/ui/button"
import { Upload, Loader2, Wand2, MousePointer2, BrickWall, SquareDashedMousePointer, Trash2, Undo2, Redo2, Plus, DoorOpen, AppWindow, Zap, Droplets, Maximize, Minimize, Ruler } from "lucide-react"
import { processPlanWithAI } from "@/app/actions/plans"
import { toast } from "sonner"

interface PlanEditorProps {
    initialData?: PlanData | null
    onSave?: (data: PlanData) => void
}

function ToolButton({ icon: Icon, active, onClick, title }: { icon: any, active: boolean, onClick: () => void, title: string }) {
    return (
        <button
            onClick={onClick}
            className={`aspect-square flex flex-col items-center justify-center rounded-md border transition-colors hover:bg-muted ${active ? "bg-primary/10 border-primary text-primary" : "bg-background border-border"}`}
            title={title}
        >
            <Icon className="h-5 w-5" />
        </button>
    )
}

export function PlanEditor({ initialData, onSave }: PlanEditorProps) {
    const [data, setData] = useState<PlanData | null>(initialData || null)
    const [loading, setLoading] = useState(false)
    const [mode, setMode] = useState<"2d" | "3d">("3d")

    // History
    const [history, setHistory] = useState<PlanData[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)

    // Tools & Layers
    const [activeTool, setActiveTool] = useState<string>("select")
    const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const containerRef = useCallback((node: HTMLDivElement | null) => {
        if (node !== null) {
            // Check if already fullscreen
            setIsFullscreen(!!document.fullscreenElement)

            const handleFullscreenChange = () => {
                setIsFullscreen(!!document.fullscreenElement)
            }

            document.addEventListener("fullscreenchange", handleFullscreenChange)
            // Cleanup attached to node? React refs logic is tricky with cleanup. 
            // Better to use useEffect for event listener, but ref for element access.
        }
    }, [])

    // Better way to handle ref and event listener
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
    const onRefChange = useCallback((node: HTMLDivElement | null) => {
        setContainerElement(node)
    }, [])

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }
        document.addEventListener("fullscreenchange", handleFullscreenChange)
        return () => document.removeEventListener("fullscreenchange", handleFullscreenChange)
    }, [])

    const toggleFullscreen = () => {
        if (!containerElement) return

        if (!document.fullscreenElement) {
            containerElement.requestFullscreen().catch((err) => {
                toast.error(`Error al entrar en pantalla completa: ${err.message}`)
            })
        } else {
            document.exitFullscreen()
        }
    }

    // Ensure data includes arrays if missing (for compatibility)
    useEffect(() => {
        if (data && (!data.doors || !data.windows || !data.layers)) {
            setData({
                ...data,
                doors: data.doors || [],
                windows: data.windows || [],
                layers: data.layers || []
            })
        }
    }, [data])

    // Initialize history
    useEffect(() => {
        if (data && history.length === 0) {
            setHistory([data])
            setHistoryIndex(0)
        }
    }, [data, history.length])

    const handleUndo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1
            const previousData = history[newIndex]
            setData(previousData)
            setHistoryIndex(newIndex)
            if (onSave) onSave(previousData)
        }
    }

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1
            const nextData = history[newIndex]
            setData(nextData)
            setHistoryIndex(newIndex)
            if (onSave) onSave(nextData)
        }
    }

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault()
                    if (e.shiftKey) {
                        handleRedo()
                    } else {
                        handleUndo()
                    }
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [history, historyIndex])

    const handleUpdateData = (newData: PlanData) => {
        setData(newData)
        const newHistory = history.slice(0, historyIndex + 1)
        newHistory.push(newData)
        setHistory(newHistory)
        setHistoryIndex(newHistory.length - 1)
        if (onSave) onSave(newData)
    }

    const handleUpload = async () => {
        setLoading(true)
        try {
            // Simulate file upload and AI processing
            const result = await processPlanWithAI("dummy-url")
            setData(result)
            if (onSave) onSave(result)
            toast.success("Plano procesado por IA correctamente")
        } catch (error) {
            toast.error("Error al procesar el plano")
        } finally {
            setLoading(false)
        }
    }

    const handleAddLayer = () => {
        if (!data) return
        const newLayer: any = {
            id: `l-${Date.now()}`,
            name: `Capa ${data.layers.length + 1}`,
            visible: true,
            color: "#" + Math.floor(Math.random() * 16777215).toString(16),
            elements: []
        }
        handleUpdateData({
            ...data,
            layers: [...data.layers, newLayer]
        })
    }

    const toggleLayerVisibility = (id: string) => {
        if (!data) return
        const newLayers = data.layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l)
        handleUpdateData({ ...data, layers: newLayers })
    }

    // Sidebar Content
    const renderSidebar = () => (
        <div className="w-64 border-r bg-muted/10 flex flex-col">
            <div className="p-3 border-b">
                <input className="w-full h-9 pl-3 pr-8 rounded-md border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Buscar formas..." />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-6">

                {/* Structure Tools */}
                <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Estructura</h4>
                    <div className="grid grid-cols-4 gap-2">
                        <ToolButton icon={MousePointer2} active={activeTool === "select"} onClick={() => setActiveTool("select")} title="Seleccionar" />
                        <ToolButton icon={BrickWall} active={activeTool === "wall"} onClick={() => setActiveTool("wall")} title="Muro" />
                        <ToolButton icon={DoorOpen} active={activeTool === "door"} onClick={() => setActiveTool("door")} title="Puerta" />
                        <ToolButton icon={AppWindow} active={activeTool === "window"} onClick={() => setActiveTool("window")} title="Ventana" />
                        <ToolButton icon={SquareDashedMousePointer} active={activeTool === "zone"} onClick={() => setActiveTool("zone")} title="Zona" />
                    </div>
                </div>

                {/* Layers Section */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Capas</h4>
                        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={handleAddLayer} title="Nueva Capa">
                            <Plus className="h-3 w-3" />
                        </Button>
                    </div>

                    <div className="space-y-1">
                        {data?.layers.map(layer => (
                            <div key={layer.id} className={`flex items-center gap-2 p-1.5 rounded-md text-xs hover:bg-muted/50 ${activeLayerId === layer.id ? "bg-primary/10" : ""}`}>
                                <div
                                    className="w-3 h-3 rounded-full cursor-pointer"
                                    style={{ backgroundColor: layer.color }}
                                    onClick={() => toggleLayerVisibility(layer.id)}
                                />
                                <span className="flex-1 cursor-pointer truncate" onClick={() => setActiveLayerId(layer.id)}>{layer.name}</span>
                                <div className="flex gap-1">
                                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setActiveTool(`symbol:${layer.id}:electricity`)} title="Electricidad">
                                        <Zap className="h-3 w-3" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setActiveTool(`symbol:${layer.id}:water`)} title="Agua">
                                        <Droplets className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                        {(!data?.layers || data.layers.length === 0) && (
                            <div className="text-xs text-muted-foreground p-2 text-center border border-dashed rounded">Sin capas</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )

    if (!data && !loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[600px] border-2 border-dashed rounded-lg bg-muted/50">
                <div className="text-center space-y-4">
                    <div className="bg-primary/10 p-4 rounded-full inline-block">
                        <Wand2 className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold">Editor de Planos IA 3D</h3>
                    <p className="text-muted-foreground max-w-sm">
                        Sube un plano en PDF o Imagen y nuestra IA generará un modelo 3D con capas inteligentes.
                    </p>
                    <Button onClick={handleUpload} size="lg">
                        <Upload className="mr-2 h-4 w-4" />
                        Subir Plano
                    </Button>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[600px] border rounded-lg bg-card">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <h3 className="font-semibold">Procesando plano con IA...</h3>
                <p className="text-sm text-muted-foreground">Detectando muros, zonas de riesgo y capas</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[85vh] w-full border rounded-xl overflow-hidden bg-background shadow-sm" ref={containerRef}>
            {/* Top Toolbar */}
            <div className="h-14 border-b bg-muted/20 flex items-center px-4 gap-4 justify-between">
                <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border bg-background p-1 shadow-sm">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleUndo}
                            disabled={historyIndex <= 0}
                            title="Deshacer (Ctrl+Z)"
                        >
                            <Undo2 className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleRedo}
                            disabled={historyIndex >= history.length - 1}
                            title="Rehacer (Ctrl+Shift+Z)"
                        >
                            <Redo2 className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="w-px h-6 bg-border mx-1" />

                    <div className="flex items-center rounded-lg border bg-background p-1 shadow-sm">
                        <Button
                            variant={mode === "2d" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-8 px-3 text-xs font-medium"
                            onClick={() => setMode("2d")}
                        >
                            2D
                        </Button>
                        <Button
                            variant={mode === "3d" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-8 px-3 text-xs font-medium"
                            onClick={() => setMode("3d")}
                        >
                            3D
                        </Button>
                    </div>

                    <div className="w-px h-6 bg-border mx-1" />

                    <Button
                        variant={activeTool === "measure" ? "secondary" : "ghost"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setActiveTool(activeTool === "measure" ? "select" : "measure")}
                        title="Medir distancia"
                    >
                        <Ruler className="h-4 w-4" />
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={toggleFullscreen}
                        title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                    >
                        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </Button>

                    <div className="flex items-center gap-1 text-xs text-muted-foreground mr-auto ml-2">
                        <span className="px-2">Zoom: 100%</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant={activeTool === "delete" ? "destructive" : "outline"}
                        size="sm"
                        className="h-8 gap-2"
                        onClick={() => setActiveTool("delete")}
                    >
                        <Trash2 className="h-4 w-4" />
                        <span className="hidden sm:inline">Borrar</span>
                    </Button>
                    <Button
                        variant="default"
                        size="sm"
                        className="h-8 gap-2"
                        onClick={() => onSave?.(data!)}
                    >
                        <Upload className="h-4 w-4" />
                        <span className="hidden sm:inline">Guardar</span>
                    </Button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {renderSidebar()}

                <div className="flex-1 relative bg-slate-50 overflow-hidden">
                    {data && (
                        <PlanScene
                            data={data}
                            mode={mode}
                            activeTool={activeTool}
                            onUpdate={handleUpdateData}
                        />
                    )}

                    <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur border rounded-md px-3 py-1 text-xs shadow-sm flex gap-2">
                        <span>{data?.walls.length || 0} muros</span>
                        <span>•</span>
                        <span>{data?.zones.length || 0} zonas</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

