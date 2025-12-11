"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

const data = [
  { semana: "Sem 1", abiertos: 12, cerrados: 10 },
  { semana: "Sem 2", abiertos: 8, cerrados: 14 },
  { semana: "Sem 3", abiertos: 15, cerrados: 11 },
  { semana: "Sem 4", abiertos: 6, cerrados: 9 },
]

export function FindingsChart() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hallazgos por Semana</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="semana" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} />
              <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Bar dataKey="abiertos" name="Abiertos" fill="var(--color-chart-5)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cerrados" name="Cerrados" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
