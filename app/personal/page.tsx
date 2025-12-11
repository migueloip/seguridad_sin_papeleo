import { DashboardLayout } from "@/components/dashboard-layout"
import { PersonnelContent } from "@/components/personnel-content"
import { getWorkers } from "@/app/actions/workers"

export default async function PersonnelPage() {
  const workers = await getWorkers()

  return (
    <DashboardLayout>
      <PersonnelContent initialWorkers={workers} />
    </DashboardLayout>
  )
}
