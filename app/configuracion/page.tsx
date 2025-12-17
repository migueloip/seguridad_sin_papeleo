import { DashboardLayout } from "@/components/dashboard-layout"
import SettingsContentClient from "@/components/settings-content-client"
import { getSettings } from "@/app/actions/settings"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function ConfiguracionPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const settings = await getSettings()

  return (
    <DashboardLayout
      user={
        session
          ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null }
          : undefined
      }
    >
      <SettingsContentClient initialSettings={settings} />
    </DashboardLayout>
  )
}
