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
    <DashboardLayout user={session as any}>
      <FindingsContent initialFindings={findings as any} />
    </DashboardLayout>
  )
}
