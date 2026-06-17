import { DashboardLayout } from "@/components/dashboard-layout"
import { ChecklistsContent } from "@/components/checklists-content"
import { getChecklistTemplates, getCompletedChecklists } from "@/app/actions/checklists"
import { getProjects } from "@/app/actions/projects"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function ChecklistsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  const [templates, completed, projects] = await Promise.all([
    getChecklistTemplates(),
    getCompletedChecklists(),
    getProjects(),
  ])

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ChecklistsContent
        initialTemplates={templates}
        initialCompleted={completed}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        defaultInspector={session.name ?? null}
      />
    </DashboardLayout>
  )
}
