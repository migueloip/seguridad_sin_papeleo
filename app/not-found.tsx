import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AnimatedPage } from "@/components/animated-page"

export default function NotFound() {
  return (
    <AnimatedPage duration={400}>
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm text-center">
          <h1 className="mb-2 text-2xl font-bold">Página no encontrada</h1>
          <p className="mb-4 text-muted-foreground">No pudimos encontrar lo que buscas.</p>
          <Link href="/">
            <Button className="w-full">Ir a Proyectos</Button>
          </Link>
        </div>
      </div>
    </AnimatedPage>
  )
}
