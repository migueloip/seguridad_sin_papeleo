import { ProjectsContent } from "@/components/projects-content"
import { getSession } from "@/lib/auth"
import { getProjects } from "@/app/actions/projects"
import { logout } from "@/app/actions/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AnimatedPage } from "@/components/animated-page"

export default async function Home() {
  const [projects, session] = await Promise.all([getProjects(), getSession()])
  if (!session) redirect("/auth/login")

  return (
    <AnimatedPage duration={400}>
      <div className="min-h-screen bg-background">
        <header className="flex items-center justify-between border-b border-border bg-card p-4 md:p-6">
          <div>
            <h1 className="text-xl font-semibold">Bienvenido</h1>
            <p className="text-sm text-muted-foreground">Selecciona un proyecto para administrar</p>
          </div>
          <form action={logout}>
            <Button variant="outline">Cerrar sesión</Button>
          </form>
        </header>
        <main className="p-4 md:p-6 lg:p-8">
          <ProjectsContent initialProjects={projects} />
        </main>
      </div>
    </AnimatedPage>
  )
}
