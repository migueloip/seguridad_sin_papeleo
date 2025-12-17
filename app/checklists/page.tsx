import { DashboardLayout } from "@/components/dashboard-layout"
import { ChecklistsContent } from "@/components/checklists-content"
import { getSession } from "@/lib/auth"
import { getChecklistTemplates, getCompletedChecklists } from "@/app/actions/checklists"
import { redirect } from "next/navigation"

export default async function ChecklistsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const [templates, completed] = await Promise.all([getChecklistTemplates(), getCompletedChecklists()])
  return (
    <DashboardLayout user={session as any}>
      <ChecklistsContent templates={templates as any} completed={completed as any} />
    </DashboardLayout>
  )
}
