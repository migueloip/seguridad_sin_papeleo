"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Save, Lock, Loader2, Eye, EyeOff } from "lucide-react"
import { updateProfile, changePassword } from "@/app/actions/profile"

type User = { name?: string | null; email: string; role?: string | null }

const inputCls =
  "h-11 w-full rounded-[10px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"

export function ProfileContent({ user }: { user: User }) {
  const router = useRouter()
  const [profile, setProfile] = useState({ name: user.name || "", email: user.email })
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" })
  const [showPwd, setShowPwd] = useState(false)
  const [savingProfile, startProfile] = useTransition()
  const [savingPwd, startPwd] = useTransition()

  const initials = (profile.name || profile.email || "U").slice(0, 2).toUpperCase()

  const saveProfile = () => {
    if (!profile.email.trim()) {
      toast.error("El email es obligatorio")
      return
    }
    startProfile(async () => {
      try {
        await updateProfile({ name: profile.name, email: profile.email })
        toast.success("Perfil actualizado")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo actualizar el perfil")
      }
    })
  }

  const savePassword = () => {
    if (!pwd.current) {
      toast.error("Ingresa tu contraseña actual")
      return
    }
    if (pwd.next.length < 6) {
      toast.error("La nueva contraseña debe tener al menos 6 caracteres")
      return
    }
    if (pwd.next !== pwd.confirm) {
      toast.error("Las contraseñas nuevas no coinciden")
      return
    }
    startPwd(async () => {
      try {
        await changePassword({ currentPassword: pwd.current, newPassword: pwd.next })
        setPwd({ current: "", next: "", confirm: "" })
        toast.success("Contraseña actualizada")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo cambiar la contraseña")
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-[18px]">
      <div>
        <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">Edita tus datos de cuenta y tu contraseña</p>
      </div>

      {/* Identidad */}
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-xl font-semibold text-brand">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="font-display text-lg font-semibold">{profile.name || "Sin nombre"}</div>
          <div className="truncate text-sm text-muted-foreground">{profile.email}</div>
          <div className="mt-0.5 text-xs capitalize text-muted-foreground">{user.role || "usuario"}</div>
        </div>
      </div>

      {/* Datos de cuenta */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 font-display text-base font-semibold">Datos de cuenta</div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold">Nombre</label>
            <input
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Tu nombre y apellido"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold">Correo</label>
            <input
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              placeholder="tucorreo@empresa.cl"
              className={inputCls}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={saveProfile}
            disabled={savingProfile}
            className="flex h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 text-brand" />}
            Guardar cambios
          </button>
        </div>
      </div>

      {/* Cambiar contraseña */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2 font-display text-base font-semibold">
          <Lock className="h-4 w-4" />
          Cambiar contraseña
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold">Contraseña actual</label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={pwd.current}
                onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
                autoComplete="current-password"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label={showPwd ? "Ocultar" : "Mostrar"}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold">Nueva contraseña</label>
              <input
                type={showPwd ? "text" : "password"}
                value={pwd.next}
                onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                autoComplete="new-password"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold">Confirmar nueva</label>
              <input
                type={showPwd ? "text" : "password"}
                value={pwd.confirm}
                onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                autoComplete="new-password"
                className={inputCls}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Mínimo 6 caracteres.</p>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={savePassword}
            disabled={savingPwd}
            className="flex h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {savingPwd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4 text-brand" />}
            Cambiar contraseña
          </button>
        </div>
      </div>
    </div>
  )
}
