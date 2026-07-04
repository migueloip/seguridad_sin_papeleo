import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { AnimatedPage } from "@/components/animated-page"
import { BrandMark } from "@/components/easysecure/brand-mark"

export default function NotFound() {
  return (
    <AnimatedPage duration={400}>
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <BrandMark size={44} />
        <div className="mt-8 font-mono text-xs uppercase tracking-[0.18em] text-brand">
          Error 404
        </div>
        <h1 className="mt-3 font-display text-[34px] font-bold tracking-[-0.02em]">
          Página no encontrada
        </h1>
        <p className="mt-2 max-w-[380px] text-[15px] text-muted-foreground">
          El enlace puede estar mal escrito o la página ya no existe.
        </p>
        <Link
          href="/"
          className="mt-8 flex h-12 items-center gap-2.5 rounded-[11px] bg-primary px-6 text-[15px] font-semibold text-white transition-transform hover:-translate-y-px"
        >
          <ArrowLeft className="h-[18px] w-[18px] text-brand" />
          Volver al panel
        </Link>
      </div>
    </AnimatedPage>
  )
}
