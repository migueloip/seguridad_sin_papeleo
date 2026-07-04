import { DashboardLayout } from "@/components/dashboard-layout"
import ReportsContentClient from "@/components/reports-content-client"
import { getProjectById } from "@/app/actions/projects"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Editor de informe" }

export default async function ProjectReportsEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ id?: string }>
}) {
  const p = await params
  const parsed = parseIntId(p.id)
  if (parsed === null) notFound()
  const id = parsed
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const sp = await searchParams
  const reportId = sp.id && /^\d+$/.test(sp.id) ? Number(sp.id) : undefined
  const reports = await getGeneratedReports(id)

  return (
    <DashboardLayout
      user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}
    >
      <ReportsContentClient initialReports={reports} projectId={id} reportId={reportId} />
    </DashboardLayout>
  )
}
