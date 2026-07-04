import { DashboardLayout } from "@/components/dashboard-layout"
import { ReportsLanding } from "@/components/reports-landing"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import { AnimatedPage } from "@/components/animated-page"

export const metadata = { title: "Informes" }

export default async function ReportsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const reports = await getGeneratedReports()

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
        <ReportsLanding reports={reports} editorHref="/informes/editor" />
      </DashboardLayout>
    </AnimatedPage>
  )
}
