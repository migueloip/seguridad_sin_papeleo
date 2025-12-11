import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardContent } from "@/components/dashboard-content"
import { getDashboardStats, getWeeklyFindingsOpenClosed } from "@/app/actions/dashboard"
import { getSession } from "@/lib/auth"

export default async function Home() {
  const [stats, weekly, session] = await Promise.all([getDashboardStats(), getWeeklyFindingsOpenClosed(), getSession()])

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <DashboardContent
        stats={stats}
        weeklyFindings={(weekly as Array<{ semana: string; abiertos: number; cerrados: number }>).map((w) => ({
          semana: w.semana,
          abiertos: Number(w.abiertos) || 0,
          cerrados: Number(w.cerrados) || 0,
        }))}
      />
    </DashboardLayout>
  )
}
