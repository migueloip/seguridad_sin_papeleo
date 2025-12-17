import { DashboardLayout } from "@/components/dashboard-layout"
import SettingsContentClient from "@/components/settings-content-client"
import { getSettings } from "@/app/actions/settings"

export default async function ConfiguracionPage() {
  const settings = await getSettings()

  return (
    <DashboardLayout>
      <SettingsContentClient initialSettings={settings} />
    </DashboardLayout>
  )
}
