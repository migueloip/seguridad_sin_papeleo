import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardContent } from "@/components/dashboard-content"
import { getProjectDashboardStats, getProjectWeeklyFindingsOpenClosed } from "@/app/actions/dashboard"
import { getProjectById } from "@/app/actions/projects"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

type ProjectRow = {
  id: number
  name: string
  location?: string | null
  client?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string
}

export default async function ProyectoDashboardPage({ params }: { params: { id: string } }) {
  const id = parseIntId(String(params.id || "")) ?? NaN
  if (!Number.isFinite(id)) notFound()
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const [stats, weekly] = await Promise.all([getProjectDashboardStats(id), getProjectWeeklyFindingsOpenClosed(id)])

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{(project as ProjectRow).name}</h1>
        <p className="text-muted-foreground">Dashboard del proyecto</p>
      </div>
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
