import { DashboardLayout } from "@/components/dashboard-layout"
import { ReportsContent } from "@/components/reports-content"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"

export default async function ReportsPage() {
  const [reports, session] = await Promise.all([getGeneratedReports(), getSession()])

  return (
    <DashboardLayout user={session as any}>
      <ReportsContent initialReports={reports} />
    </DashboardLayout>
  )
}
