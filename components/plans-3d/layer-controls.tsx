"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Layers, Cuboid, Map } from "lucide-react"

interface LayerControlsProps {
    layers: { id: string; name: string; visible: boolean }[]
    onToggleLayer: (id: string, visible: boolean) => void
    mode: "2d" | "3d"
    onToggleMode: (mode: "2d" | "3d") => void
}

export function LayerControls({ layers, onToggleLayer, mode, onToggleMode }: LayerControlsProps) {
    return (
        <Card className="w-64 absolute top-4 right-4 z-10 glass-panel">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Capas y Visualización
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <Label htmlFor="mode-3d" className="flex items-center gap-2">
                        <Cuboid className="h-4 w-4" />
                        Vista 3D
                    </Label>
                    <Switch
                        id="mode-3d"
                        checked={mode === "3d"}
                        onCheckedChange={(c: boolean) => onToggleMode(c ? "3d" : "2d")}
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Capas Activas</Label>
                    {layers.map((layer) => (
                        <div key={layer.id} className="flex items-center justify-between">
                            <Label htmlFor={`layer-${layer.id}`} className="text-sm cursor-pointer">
                                {layer.name}
                            </Label>
                            <Switch
                                id={`layer-${layer.id}`}
                                checked={layer.visible}
                                onCheckedChange={(c: boolean) => onToggleLayer(layer.id, c)}
                            />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}
