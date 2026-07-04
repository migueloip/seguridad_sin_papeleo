import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { getChecklistTemplates, getCompletedChecklists } from "@/app/actions/checklists"
import { getProjects } from "@/app/actions/projects"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ChecklistsContent } from "@/components/checklists-content"
import { AnimatedPage } from "@/components/animated-page"

export const metadata = { title: "Checklists" }

export default async function ChecklistsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  const [templates, projects, history] = await Promise.all([
    getChecklistTemplates(),
    getProjects(),
    getCompletedChecklists(),
  ])

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={{ name: session.name, email: session.email, role: session.role }}>
        <ChecklistsContent
          initial={templates}
          projects={projects.map((p) => ({ id: Number(p.id), name: String(p.name) }))}
          initialHistory={history}
        />
      </DashboardLayout>
    </AnimatedPage>
  )
}
