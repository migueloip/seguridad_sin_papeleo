import { DashboardLayout } from "@/components/dashboard-layout"
import { PersonnelContent } from "@/components/personnel-content"
import { getWorkers } from "@/app/actions/workers"
import { getSession } from "@/lib/auth"

export default async function PersonnelPage() {
  const [workers, session] = await Promise.all([getWorkers(), getSession()])

  return (
    <DashboardLayout user={session as any}>
      <PersonnelContent initialWorkers={workers as any} />
    </DashboardLayout>
  )
}
