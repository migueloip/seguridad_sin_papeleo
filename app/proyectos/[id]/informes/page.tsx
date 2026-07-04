import { DashboardLayout } from "@/components/dashboard-layout"
import { ReportsLanding } from "@/components/reports-landing"
import { getProjectById } from "@/app/actions/projects"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Informes" }

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
      user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}
    >
      <ReportsLanding reports={reports} editorHref={`/proyectos/${id}/informes/editor`} />
    </DashboardLayout>
  )
}
