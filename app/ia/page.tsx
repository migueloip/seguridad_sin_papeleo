import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { DashboardLayout } from "@/components/dashboard-layout"
import { IaContent } from "@/components/ia-content"
import { AnimatedPage } from "@/components/animated-page"

export const metadata = { title: "Asistente IA" }

export default async function IaPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={{ name: session.name, email: session.email, role: session.role }}>
        <IaContent />
      </DashboardLayout>
    </AnimatedPage>
  )
}
