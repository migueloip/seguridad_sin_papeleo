"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface RiskItem {
  location: string
  score: number
  openCount: number
  critical: number
  high: number
  medium: number
  low: number
}

export function RiskHeatmap({ data }: { data: RiskItem[] }) {
  const maxScore = Math.max(...data.map((d) => d.score), 1)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Riesgo por Ubicación</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay hallazgos abiertos</p>
        ) : (
          data.map((item) => {
            const pct = Math.round((item.score / maxScore) * 100)
            return (
              <div key={item.location} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.location}</span>
                  <span className="text-xs text-muted-foreground">Riesgo: {item.score}</span>
                </div>
                <div className="h-2 w-full rounded bg-muted">
                  <div
                    className="h-2 rounded bg-destructive"
                    style={{ width: `${pct}%`, transition: "width 0.3s ease" }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="destructive">Críticos: {item.critical}</Badge>
                  <Badge className="bg-destructive/80 text-destructive-foreground">Altos: {item.high}</Badge>
                  <Badge className="bg-warning text-warning-foreground">Medios: {item.medium}</Badge>
                  <Badge variant="secondary">Bajos: {item.low}</Badge>
                  <Badge variant="outline">Abiertos: {item.openCount}</Badge>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

