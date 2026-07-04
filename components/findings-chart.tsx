"use client"

import { BarChart, Bar, XAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

type WeeklyItem = { semana: string; abiertos: number; cerrados: number }

/**
 * Gráfico "Evolución de hallazgos" del dashboard Easysecure.
 * Barras: Creados (oscuro #16130e) vs Resueltos (ámbar #f3a40a).
 * Render sin Card propio — el contenedor lo aporta el dashboard.
 */
export function FindingsChart({ data }: { data: WeeklyItem[] }) {
  return (
    <div className="h-[176px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="22%" barGap={4}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="semana"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--color-secondary)" }}
            contentStyle={{
              backgroundColor: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              fontSize: "12px",
            }}
          />
          <Bar dataKey="abiertos" name="Creados" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="cerrados" name="Resueltos" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
