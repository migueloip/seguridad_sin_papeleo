import { DashboardLayout } from "@/components/dashboard-layout"
import { PlansContent } from "@/components/plans-content"
import { getSession } from "@/lib/auth"
import { getPlans } from "@/app/actions/plans"
import { redirect } from "next/navigation"

export default async function PlanosPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const plans = await getPlans()
  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <PlansContent plans={plans} />
    </DashboardLayout>
  )
}
