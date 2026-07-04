"use client"

import Link from "next/link"
import { useActionState } from "react"
import { toast } from "sonner"
import { AlertCircle, ArrowRight, Check, Loader2 } from "lucide-react"
import { loginAction, registerAction, type AuthFormState } from "@/app/actions/auth"

const inputClass =
  "h-[46px] w-full rounded-[11px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"

function ErrorBanner({ state }: { state: AuthFormState }) {
  if (!state?.error) return null
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-[11px] border border-danger/30 bg-danger-tint px-3.5 py-3 text-[13px] font-medium text-danger"
    >
      <AlertCircle className="mt-px h-4 w-4 shrink-0" />
      {state.error}
    </div>
  )
}

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, null)

  return (
    <>
      <ErrorBanner state={state} />
      <form action={formAction} className="space-y-0">
        <label className="mb-1.5 block text-[13px] font-semibold text-[#4a453e]" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state?.values?.email}
          placeholder="prevencion@constructora.cl"
          className={`mb-[18px] ${inputClass}`}
        />

        <label className="mb-1.5 block text-[13px] font-semibold text-[#4a453e]" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className={`mb-3.5 ${inputClass}`}
        />

        <div className="mb-6 flex items-center justify-between text-[13px]">
          <label className="flex cursor-pointer items-center gap-2 text-[#6f6a60]">
            <input type="checkbox" name="remember" className="peer sr-only" defaultChecked />
            <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-primary peer-checked:bg-primary">
              <Check className="h-2.5 w-2.5 text-brand" strokeWidth={3} />
            </span>
            Recordarme
          </label>
          <button
            type="button"
            onClick={() =>
              toast.info("Restablecer contraseña", {
                description:
                  "Pide al administrador de tu empresa que restablezca tu clave desde el panel de administración.",
              })
            }
            className="font-semibold text-[#b8841a] hover:underline"
          >
            ¿Olvidaste tu clave?
          </button>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary text-[15px] font-semibold text-white transition-transform hover:-translate-y-px disabled:opacity-70"
        >
          {isPending ? (
            <>
              Entrando…
              <Loader2 className="h-[18px] w-[18px] animate-spin text-brand" />
            </>
          ) : (
            <>
              Entrar al panel
              <ArrowRight className="h-[18px] w-[18px] text-brand" />
            </>
          )}
        </button>
      </form>

      <div className="my-[22px] flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">o</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={() =>
          toast.info("SSO empresa", {
            description: "El acceso con SSO corporativo estará disponible próximamente.",
          })
        }
        className="h-[46px] w-full rounded-[11px] border border-border bg-card text-sm font-semibold text-[#4a453e] transition-colors hover:bg-secondary"
      >
        Acceso con SSO empresa
      </button>

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        ¿Sin cuenta?{" "}
        <Link href="/auth/register" className="font-semibold text-[#b8841a]">
          Solicita acceso
        </Link>
      </p>
    </>
  )
}

export function RegisterForm() {
  const [state, formAction, isPending] = useActionState(registerAction, null)

  return (
    <>
      <ErrorBanner state={state} />
      <form action={formAction} className="space-y-0">
        <label className="mb-1.5 block text-[13px] font-semibold text-[#4a453e]" htmlFor="name">
          Nombre
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={state?.values?.name}
          placeholder="María Pérez"
          className={`mb-[18px] ${inputClass}`}
        />

        <label className="mb-1.5 block text-[13px] font-semibold text-[#4a453e]" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state?.values?.email}
          placeholder="prevencion@constructora.cl"
          className={`mb-[18px] ${inputClass}`}
        />

        <label className="mb-1.5 block text-[13px] font-semibold text-[#4a453e]" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          className={`mb-[18px] ${inputClass}`}
        />

        <label className="mb-1.5 block text-[13px] font-semibold text-[#4a453e]" htmlFor="confirm">
          Confirmar contraseña
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Repite la contraseña"
          className={`mb-6 ${inputClass}`}
        />

        <button
          type="submit"
          disabled={isPending}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary text-[15px] font-semibold text-white transition-transform hover:-translate-y-px disabled:opacity-70"
        >
          {isPending ? (
            <>
              Creando cuenta…
              <Loader2 className="h-[18px] w-[18px] animate-spin text-brand" />
            </>
          ) : (
            <>
              Crear cuenta
              <ArrowRight className="h-[18px] w-[18px] text-brand" />
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link href="/auth/login" className="font-semibold text-[#b8841a]">
          Inicia sesión
        </Link>
      </p>
    </>
  )
}
