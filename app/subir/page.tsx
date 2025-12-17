import { DashboardLayout } from "@/components/dashboard-layout"
import { UploadContent } from "@/components/upload-content"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function UploadPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
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
