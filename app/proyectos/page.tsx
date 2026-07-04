import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { getProjects } from "@/app/actions/projects"
import { ProjectsScreen } from "@/components/easysecure/projects-screen"
import { AnimatedPage } from "@/components/animated-page"

export const metadata = { title: "Tus obras" }

export default async function ProyectosPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  const projects = await getProjects()

  return (
    <AnimatedPage duration={400}>
      <ProjectsScreen
        projects={projects}
        user={{ name: session.name, email: session.email, role: session.role }}
      />
    </AnimatedPage>
  )
}
