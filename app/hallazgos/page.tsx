import { DashboardLayout } from "@/components/dashboard-layout"
import { FindingsContent } from "@/components/findings-content"
import { getFindings } from "@/app/actions/findings"

export default async function FindingsPage() {
  const findings = await getFindings()

  return (
    <DashboardLayout>
      <FindingsContent initialFindings={findings} />
    </DashboardLayout>
  )
}
