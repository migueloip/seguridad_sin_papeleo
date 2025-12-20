"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, MapPin } from "lucide-react"
import type { FindingRow } from "@/app/actions/findings"

type RiskMapContentProps = {
  findings: FindingRow[]
}

type PinItem = {
  id: number
  title: string
  severity: string
  status: string
  location: string | null
  project_name: string | null
  x: number
  y: number
}

export function RiskMapContent({ findings }: RiskMapContentProps) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const pins = useMemo<PinItem[]>(() => {
    const active = findings.filter((f) => f.status === "open" || f.status === "in_progress")
    const total = active.length || 1
    const rowCount = Math.max(1, Math.ceil(Math.sqrt(total)))

    return active.map((f, index) => {
      const row = Math.floor(index / rowCount)
      const col = index % rowCount
      const x = (col + 0.5) / rowCount
      const y = (row + 0.5) / rowCount

      return {
        id: f.id,
        title: f.title,
        severity: f.severity,
        status: f.status,
        location: f.location,
        project_name: f.project_name,
        x,
        y,
      }
    })
  }, [findings])

  const selected = useMemo(() => {
    if (!pins.length) return null
    if (selectedId == null) return pins[0]
    return pins.find((p) => p.id === selectedId) || pins[0]
  }, [pins, selectedId])

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return <Badge variant="destructive">Critico</Badge>
      case "high":
        return <Badge className="bg-destructive/80 text-destructive-foreground">Alto</Badge>
      case "medium":
        return <Badge className="bg-warning text-warning-foreground">Medio</Badge>
      default:
        return <Badge variant="secondary">Bajo</Badge>
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge variant="outline" className="border-destructive text-destructive">
            Abierto
          </Badge>
        )
      case "in_progress":
        return (
          <Badge variant="outline" className="border-warning text-warning">
            En Proceso
          </Badge>
        )
      case "resolved":
      case "closed":
        return <Badge className="bg-success text-success-foreground">Completado</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const handleVerMas = () => {
    if (!selected) return
    router.push(`/hallazgos?findingId=${selected.id}`)
  }

  const totalOpen = pins.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mapa de riesgos</h1>
          <p className="text-muted-foreground">
            Visualiza los hallazgos abiertos como pins sobre el plano
          </p>
        </div>
        {totalOpen > 0 && (
          <div className="flex flex-col items-end">
            <span className="text-sm text-muted-foreground">Hallazgos abiertos</span>
            <span className="text-2xl font-semibold text-destructive">{totalOpen}</span>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Distribucion de hallazgos
          </CardTitle>
          <Badge variant="outline">
            {totalOpen === 0 ? "Sin hallazgos abiertos" : `Pins activos: ${totalOpen}`}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="relative h-[420px] w-full rounded-xl border border-border bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {pins.length === 0 && (
              <div className="flex h-full w-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  No hay hallazgos abiertos para mostrar en el mapa
                </p>
              </div>
            )}

            {pins.map((pin) => (
              <button
                key={pin.id}
                type="button"
                className={`group absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-destructive p-1.5 text-destructive-foreground shadow-lg transition-transform hover:scale-110 ${
                  selected && selected.id === pin.id ? "ring-2 ring-offset-2 ring-offset-slate-900 ring-yellow-400" : ""
                }`}
                style={{
                  left: `${pin.x * 100}%`,
                  top: `${pin.y * 100}%`,
                }}
                onClick={() => setSelectedId(pin.id)}
              >
                <MapPin className="h-4 w-4" />
              </button>
            ))}

            {selected && (
              <div className="absolute right-4 top-4 w-80 max-w-full rounded-lg border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">#{selected.id}</span>
                      {getSeverityBadge(selected.severity)}
                      {getStatusBadge(selected.status)}
                    </div>
                    <h2 className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
                      {selected.title}
                    </h2>
                  </div>
                </div>
                <div className="mb-3 space-y-1 text-xs text-muted-foreground">
                  {selected.location && (
                    <p>
                      <span className="font-medium text-foreground">Ubicacion: </span>
                      {selected.location}
                    </p>
                  )}
                  {selected.project_name && (
                    <p>
                      <span className="font-medium text-foreground">Proyecto: </span>
                      {selected.project_name}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={handleVerMas}
                  >
                    Ver mas
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

