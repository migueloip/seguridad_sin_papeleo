import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ProfileContent } from "@/components/profile-content"
import { AnimatedPage } from "@/components/animated-page"

export const metadata = { title: "Perfil" }

export default async function PerfilPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={{ name: session.name, email: session.email, role: session.role }}>
        <ProfileContent
          user={{ name: session.name, email: session.email, role: session.role }}
        />
      </DashboardLayout>
    </AnimatedPage>
  )
}
