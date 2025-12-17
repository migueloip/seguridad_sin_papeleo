import { DashboardLayout } from "@/components/dashboard-layout"
import { FindingsContent } from "@/components/findings-content"
import { getFindings } from "@/app/actions/findings"
import { getProjectById } from "@/app/actions/projects"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export default async function ProjectFindingsPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await params
  const parsed = parseIntId(p.id)
  if (parsed === null) notFound()
  const id = parsed
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const findings = await getFindings(id)

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <FindingsContent initialFindings={findings as any} projectId={id} />
    </DashboardLayout>
  )
}
