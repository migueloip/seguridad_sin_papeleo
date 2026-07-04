import { AnimatedPage } from "@/components/animated-page"
import { BrandMark } from "@/components/easysecure/brand-mark"
import { AuthBrandPanel } from "@/components/easysecure/auth-brand-panel"
import { LoginForm } from "@/components/easysecure/auth-forms"

export const metadata = { title: "Iniciar sesión" }

export default function LoginPage() {
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
              Iniciar sesión
            </h2>
            <p className="mb-8 text-sm text-muted-foreground">Ingresa a tu panel de prevención.</p>

            <LoginForm />
          </div>
        </div>
      </div>
    </AnimatedPage>
  )
}
