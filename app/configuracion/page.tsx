import { DashboardLayout } from "@/components/dashboard-layout"
import { SettingsContent } from "@/components/settings-content"
import { getSettings } from "@/app/actions/settings"

export default async function ConfiguracionPage() {
  const settings = await getSettings()

  return (
    <DashboardLayout>
      <SettingsContent initialSettings={settings} />
    </DashboardLayout>
  )
}
