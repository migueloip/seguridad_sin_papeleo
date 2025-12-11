import { DashboardLayout } from "@/components/dashboard-layout"
import { ChecklistsContent } from "@/components/checklists-content"
import { getSession } from "@/lib/auth"
import { getChecklistTemplates, getCompletedChecklists } from "@/app/actions/checklists"

export default async function ChecklistsPage() {
  const [session, templates, completed] = await Promise.all([
    getSession(),
    getChecklistTemplates(),
    getCompletedChecklists(),
  ])
  return (
    <DashboardLayout user={session as any}>
      <ChecklistsContent templates={templates as any} completed={completed as any} />
    </DashboardLayout>
  )
}
