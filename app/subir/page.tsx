import { DashboardLayout } from "@/components/dashboard-layout"
import { UploadContent } from "@/components/upload-content"
import { getSession } from "@/lib/auth"

export default async function UploadPage() {
  const session = await getSession()
  return (
    <DashboardLayout
      user={
        session
          ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null }
          : undefined
      }
    >
      <UploadContent />
    </DashboardLayout>
  )
}
