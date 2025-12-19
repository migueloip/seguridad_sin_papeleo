import { DashboardLayout } from "@/components/dashboard-layout"
import ReportsContentClient from "@/components/reports-content-client"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function ReportsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const reports = await getGeneratedReports()

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ReportsContentClient initialReports={reports} />
    </DashboardLayout>
  )
}
