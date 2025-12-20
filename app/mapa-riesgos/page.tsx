import { DashboardLayout } from "@/components/dashboard-layout"
import { RiskMapContent } from "@/components/risk-map-content"
import { getFindings } from "@/app/actions/findings"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function RiskMapPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  const findings = await getFindings()

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <RiskMapContent findings={findings} />
    </DashboardLayout>
  )
}

