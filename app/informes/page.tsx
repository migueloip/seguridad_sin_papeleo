import { DashboardLayout } from "@/components/dashboard-layout"
import { ReportsContent } from "@/components/reports-content"
import { getGeneratedReports } from "@/app/actions/reports"

export default async function ReportsPage() {
  const reports = await getGeneratedReports()

  return (
    <DashboardLayout>
      <ReportsContent initialReports={reports} />
    </DashboardLayout>
  )
}
