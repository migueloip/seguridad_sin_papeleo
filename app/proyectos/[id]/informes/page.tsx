import { DashboardLayout } from "@/components/dashboard-layout"
import { ReportsContent } from "@/components/reports-content"
import { getProjectById } from "@/app/actions/projects"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export default async function ProjectReportsPage({ params }: { params: { id: string } }) {
  const id = parseIntId(String(params.id || "")) ?? NaN
  if (!Number.isFinite(id)) notFound()
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const reports = await getGeneratedReports()

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <ReportsContent initialReports={reports} />
    </DashboardLayout>
  )
}
