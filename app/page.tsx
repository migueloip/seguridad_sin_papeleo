import { DashboardContent } from "@/components/dashboard-content"
import { DashboardLayout } from "@/components/dashboard-layout"
import { getSession } from "@/lib/auth"
import { getDashboardStats } from "@/app/actions/dashboard"
import { redirect } from "next/navigation"
import { AnimatedPage } from "@/components/animated-page"

// Next.js detecta automáticamente que la página es dinámica al usar cookies()
// vía getSession(); el `force-dynamic` explícito es redundante.

export const metadata = { title: "Principal · Easysecure" }

export default async function Home() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  const stats = await getDashboardStats()

  // Construct user object matching DashboardLayout expectation
  const layoutUser = {
    name: session.name,
    email: session.email,
    role: session.role
  }

  const openFindings = stats.findings.open + stats.findings.in_progress

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={layoutUser} openFindings={openFindings}>
        <DashboardContent
          stats={stats}
          userName={session.name || session.email.split("@")[0]}
        />
      </DashboardLayout>
    </AnimatedPage>
  )
}
