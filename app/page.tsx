import { DashboardContent } from "@/components/dashboard-content"
import { DashboardLayout } from "@/components/dashboard-layout"
import { getSession } from "@/lib/auth"
import { getDashboardStats } from "@/app/actions/dashboard"
import { logout } from "@/app/actions/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AnimatedPage } from "@/components/animated-page"

export const dynamic = "force-dynamic"

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

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={layoutUser}>
        <DashboardContent
          stats={stats}
          userName={session.name || session.email.split("@")[0]}
        />
      </DashboardLayout>
    </AnimatedPage>
  )
}
