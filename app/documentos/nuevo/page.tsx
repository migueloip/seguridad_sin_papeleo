import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { DashboardLayout } from "@/components/dashboard-layout"
import { DocumentEditor } from "@/components/document-editor"
import { AnimatedPage } from "@/components/animated-page"

export const metadata = { title: "Nuevo documento" }

export default async function NuevoDocumentoPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={{ name: session.name, email: session.email, role: session.role }}>
        <DocumentEditor />
      </DashboardLayout>
    </AnimatedPage>
  )
}
