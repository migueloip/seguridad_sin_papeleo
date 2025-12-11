import { DashboardLayout } from "@/components/dashboard-layout"
import { FindingsContent } from "@/components/findings-content"
import { getFindings } from "@/app/actions/findings"
import { getSession } from "@/lib/auth"

export default async function FindingsPage() {
  const [findings, session] = await Promise.all([getFindings(), getSession()])

  return (
    <DashboardLayout user={session as any}>
      <FindingsContent initialFindings={findings as any} />
    </DashboardLayout>
  )
}
