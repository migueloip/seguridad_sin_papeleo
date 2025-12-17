import { DashboardLayout } from "@/components/dashboard-layout"
import { ChecklistsContent } from "@/components/checklists-content"
import { getChecklistTemplates, getCompletedChecklists } from "@/app/actions/checklists"
import { getProjectById } from "@/app/actions/projects"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export default async function ProjectChecklistsPage({ params }: { params: { id: string } }) {
  const id = parseIntId(String(params.id || "")) ?? NaN
  if (!Number.isFinite(id)) notFound()
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const [templates, completed] = await Promise.all([getChecklistTemplates(), getCompletedChecklists(id)])

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <ChecklistsContent templates={templates as any} completed={completed as any} />
    </DashboardLayout>
  )
}
