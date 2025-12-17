import { DashboardLayout } from "@/components/dashboard-layout"
import { ReportsContent } from "@/components/reports-content"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function ReportsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const reports = await getGeneratedReports()

  return (
    <DashboardLayout user={session as any}>
      <ReportsContent initialReports={reports} />
    </DashboardLayout>
  )
}
