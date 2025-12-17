import { DashboardLayout } from "@/components/dashboard-layout"
import ReportsContentClient from "@/components/reports-content-client"
import { getProjectById } from "@/app/actions/projects"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export default async function ProjectReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await params
  const parsed = parseIntId(p.id)
  if (parsed === null) notFound()
  const id = parsed
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const reports = await getGeneratedReports(id)

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <ReportsContentClient initialReports={reports} projectId={id} />
    </DashboardLayout>
  )
}
