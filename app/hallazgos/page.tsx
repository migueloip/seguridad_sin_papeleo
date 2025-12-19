import { DashboardLayout } from "@/components/dashboard-layout"
import { FindingsContent } from "@/components/findings-content"
import { getFindings } from "@/app/actions/findings"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function FindingsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const findings = await getFindings()

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <FindingsContent initialFindings={findings} />
    </DashboardLayout>
  )
}
