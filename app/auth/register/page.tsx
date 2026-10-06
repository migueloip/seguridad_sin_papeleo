import type { Metadata } from "next"
import { AnimatedPage } from "@/components/animated-page"
import { BrandMark } from "@/components/easysecure/brand-mark"
import { AuthBrandPanel } from "@/components/easysecure/auth-brand-panel"
import { RegisterForm } from "@/components/easysecure/auth-forms"
import { safeNextPath } from "@/lib/safe-redirect"

// La URL puede traer ?next=/invitacion/<token>: no enviarla como Referer a otros sitios.
export const metadata: Metadata = { title: "Crear cuenta", referrer: "same-origin" }

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const sp = await searchParams
  // Retorno tras crear la cuenta; se ignora si no es una ruta relativa segura.
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null)
  return (
    <AnimatedPage duration={400}>
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        <AuthBrandPanel />

        {/* Panel de formulario */}
        <div className="flex items-center justify-center bg-background p-6 sm:p-10">
          <div className="w-full max-w-[380px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <BrandMark size={36} />
              <span className="font-display text-lg font-bold tracking-tight">Easysecure</span>
            </div>
            <h2 className="mb-1.5 font-display text-[26px] font-bold tracking-[-0.02em]">
              Crear cuenta
            </h2>
            <p className="mb-8 text-sm text-muted-foreground">
              Configura tu panel de prevención en menos de un minuto.
            </p>

            <RegisterForm next={next} />
          </div>
        </div>
      </div>
    </AnimatedPage>
  )
}
