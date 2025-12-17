"use client"

import dynamic from "next/dynamic"
import type { Setting } from "@/app/actions/settings"

const DynamicSettingsContent = dynamic(
  () => import("@/components/settings-content").then((m) => m.SettingsContent),
  { ssr: false },
)

export default function SettingsContentClient({ initialSettings }: { initialSettings: Setting[] }) {
  return <DynamicSettingsContent initialSettings={initialSettings} />
}
