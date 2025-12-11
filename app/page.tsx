import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardContent } from "@/components/dashboard-content"
import { getDashboardStats } from "@/app/actions/dashboard"

export default async function Home() {
  const stats = await getDashboardStats()

  return (
    <DashboardLayout>
      <DashboardContent stats={stats} />
    </DashboardLayout>
  )
}
