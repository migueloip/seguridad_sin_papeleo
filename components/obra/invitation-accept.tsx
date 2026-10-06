"use client"

/**
 * Aceptación de una invitación al equipo de obra (página pública
 * /invitacion/[token]). Recibe la vista previa ya resuelta en el servidor y
 * muestra, según el estado:
 * - enlace inválido, vencido, revocado o ya aceptado, con un mensaje claro;
 * - pendiente con sesión: aceptar (si el correo coincide) o cerrar sesión;
 * - pendiente sin sesión: crear la cuenta con el correo invitado o ir a
 *   iniciar sesión y volver aquí (?next=).
 *
 * La validación real (estado, vencimiento, correo) siempre la hace el servidor.
 */
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react"
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Link2Off,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react"
import { logout } from "@/app/actions/auth"
import { acceptObraInvitation, acceptObraInvitationWithNewAccount } from "@/app/actions/obra/invitations"
import { BrandMark } from "@/components/easysecure/brand-mark"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OBRA_ROLE_DESCRIPTIONS, OBRA_ROLE_LABELS, type ActionResult, type InvitationPreview } from "@/lib/obra/types"

const inputClass =
  "h-[46px] w-full rounded-[11px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
const labelClass = "mb-1.5 block text-[13px] font-semibold text-[#4a453e]"
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary text-[15px] font-semibold text-white transition-transform hover:-translate-y-px disabled:opacity-70"
const secondaryButtonClass =
  "flex h-[46px] w-full items-center justify-center gap-2 rounded-[11px] border border-border bg-card text-sm font-semibold text-[#4a453e] transition-colors hover:bg-secondary disabled:opacity-70"

const NETWORK_ERROR = "No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo."

async function call<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn()
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
}

/** "dd-mm-aaaa hh:mm" en la hora de Chile (mismo texto en servidor y navegador). */
function formatChile(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const parts: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d)) {
    parts[p.type] = p.value
  }
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-[11px] border border-danger/30 bg-danger-tint px-3.5 py-3 text-[13px] font-medium text-danger"
    >
      <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        <BrandMark size={36} />
        <span className="font-display text-lg font-bold tracking-tight">Easysecure</span>
      </div>
      <h1 className="mb-1.5 font-display text-[26px] font-bold tracking-[-0.02em]">{title}</h1>
      {subtitle ? <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p> : <div className="mb-6" />}
    </>
  )
}

/** Estado terminal (inválida, vencida, revocada, aceptada) con un único camino de salida. */
function StatusCard({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  action: { href: string; label: string }
}) {
  return (
    <>
      <Header title={title} />
      <div className="mb-6 flex items-start gap-3 rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 space-y-2 break-words">{children}</div>
      </div>
      <Link href={action.href} className={primaryButtonClass}>
        {action.label}
        <ArrowRight className="h-[18px] w-[18px] text-brand" aria-hidden />
      </Link>
    </>
  )
}

function Summary({ preview }: { preview: InvitationPreview }) {
  return (
    <dl className="mb-6 divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card text-sm">
      <div className="flex flex-col gap-0.5 p-3.5">
        <dt className="text-xs font-semibold text-muted-foreground">Obra</dt>
        <dd className="break-words font-semibold">{preview.project_name}</dd>
      </div>
      <div className="flex flex-col gap-0.5 p-3.5">
        <dt className="text-xs font-semibold text-muted-foreground">Tu rol</dt>
        <dd>
          <span className="font-semibold">{OBRA_ROLE_LABELS[preview.role]}</span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">{OBRA_ROLE_DESCRIPTIONS[preview.role]}</span>
        </dd>
      </div>
      {preview.inviter_name ? (
        <div className="flex items-start gap-2.5 p-3.5">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-muted-foreground">Te invita</dt>
            <dd className="break-words">{preview.inviter_name}</dd>
          </div>
        </div>
      ) : null}
      <div className="flex items-start gap-2.5 p-3.5">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">Correo invitado</dt>
          <dd className="break-all">{preview.email}</dd>
        </div>
      </div>
      <div className="flex items-start gap-2.5 p-3.5">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">Vence</dt>
          <dd>{formatChile(preview.expires_at)} (hora de Chile)</dd>
        </div>
      </div>
    </dl>
  )
}

export function InvitationAccept({
  token,
  preview,
  viewer,
  loadError = false,
}: {
  token: string
  /** null = el enlace no existe o no tiene formato válido. */
  preview: InvitationPreview | null
  /** Usuario con sesión iniciada (null = sin sesión). */
  viewer: { email: string; name: string | null } | null
  /** true si falló la consulta (BD caída), para no decir "enlace inválido" en vano. */
  loadError?: boolean
}) {
  if (loadError) {
    return (
      <StatusCard
        icon={<AlertCircle className="h-5 w-5 text-danger" />}
        title="No se pudo cargar la invitación"
        action={{ href: token ? `/invitacion/${token}` : "/", label: "Intentar de nuevo" }}
      >
        <p>Hubo un problema al conectar con el servidor. Intenta de nuevo en unos minutos.</p>
      </StatusCard>
    )
  }

  if (!preview) {
    return (
      <StatusCard
        icon={<Link2Off className="h-5 w-5 text-danger" />}
        title="Enlace no válido"
        action={{ href: "/", label: "Ir al inicio" }}
      >
        <p>
          Este enlace de invitación no existe o está incompleto. Revisa que lo hayas copiado entero o pide uno nuevo a
          quien te invitó.
        </p>
        <p>Si te enviaron un enlace más nuevo, el anterior deja de servir.</p>
      </StatusCard>
    )
  }

  const inviter = preview.inviter_name || "quien te invitó"

  if (preview.status === "vencida") {
    return (
      <StatusCard
        icon={<Clock className="h-5 w-5 text-warning" />}
        title="La invitación venció"
        action={{ href: "/", label: "Ir al inicio" }}
      >
        <p>
          La invitación a «{preview.project_name}» venció el {formatChile(preview.expires_at)}. Pide a {inviter} que
          genere un enlace nuevo desde el equipo de la obra.
        </p>
      </StatusCard>
    )
  }

  if (preview.status === "revocada") {
    return (
      <StatusCard
        icon={<XCircle className="h-5 w-5 text-danger" />}
        title="La invitación fue anulada"
        action={{ href: "/", label: "Ir al inicio" }}
      >
        <p>
          {preview.inviter_name ? `${preview.inviter_name} anuló` : "Se anuló"} la invitación a «{preview.project_name}». Si
          crees que es un error, pide un enlace nuevo.
        </p>
      </StatusCard>
    )
  }

  if (preview.status === "aceptada") {
    return (
      <StatusCard
        icon={<CheckCircle2 className="h-5 w-5 text-success" />}
        title="Esta invitación ya fue aceptada"
        action={
          viewer
            ? { href: "/obra", label: "Ir a mis obras" }
            : { href: `/auth/login?next=${encodeURIComponent("/obra")}`, label: "Iniciar sesión" }
        }
      >
        <p>
          La invitación a «{preview.project_name}» ya se usó. Si fuiste tú, entra con tu cuenta ({preview.email}) para ver
          la obra.
        </p>
      </StatusCard>
    )
  }

  return <PendingInvitation token={token} preview={preview} viewer={viewer} />
}

function PendingInvitation({
  token,
  preview,
  viewer,
}: {
  token: string
  preview: InvitationPreview
  viewer: { email: string; name: string | null } | null
}) {
  const subtitle = `${preview.inviter_name ? `${preview.inviter_name} te invitó` : "Te invitaron"} a sumarte al equipo de la obra en Easysecure. Revisa los datos y acepta para entrar.`
  return (
    <>
      <Header title="Te invitaron a una obra" subtitle={subtitle} />
      <Summary preview={preview} />
      {viewer ? (
        viewer.email.trim().toLowerCase() === preview.email.toLowerCase() ? (
          <AcceptWithSession token={token} viewer={viewer} />
        ) : (
          <WrongAccount preview={preview} viewer={viewer} />
        )
      ) : (
        <NoSession token={token} preview={preview} />
      )}
    </>
  )
}

function AcceptWithSession({ token, viewer }: { token: string; viewer: { email: string; name: string | null } }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function accept() {
    setError(null)
    startTransition(async () => {
      const res = await call(() => acceptObraInvitation(token))
      if (res.ok === false) {
        setError(res.error)
        return
      }
      setDone(true)
      router.push(`/obra/${res.data.project_id}`)
    })
  }

  return (
    <>
      <ErrorBanner message={error} />
      <p className="mb-4 flex items-center gap-2 text-[13px] text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
        <span className="min-w-0 break-all">Ingresaste como {viewer.email}.</span>
      </p>
      <button type="button" onClick={accept} disabled={isPending || done} className={primaryButtonClass}>
        {isPending || done ? (
          <>
            Entrando a la obra…
            <Loader2 className="h-[18px] w-[18px] animate-spin text-brand" aria-hidden />
          </>
        ) : (
          <>
            Aceptar y entrar a la obra
            <ArrowRight className="h-[18px] w-[18px] text-brand" aria-hidden />
          </>
        )}
      </button>
    </>
  )
}

function WrongAccount({ preview, viewer }: { preview: InvitationPreview; viewer: { email: string } }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function signOut() {
    setError(null)
    startTransition(async () => {
      try {
        await logout()
        router.refresh()
      } catch {
        setError(NETWORK_ERROR)
      }
    })
  }

  return (
    <>
      <ErrorBanner message={error} />
      <div
        role="status"
        className="mb-4 rounded-[11px] border border-warning/30 bg-warning-tint px-3.5 py-3 text-[13px] text-foreground"
      >
        <p className="break-words">
          Ingresaste como <strong className="break-all">{viewer.email}</strong>, pero esta invitación es para{" "}
          <strong className="break-all">{preview.email}</strong>.
        </p>
        <p className="mt-1.5">Cierra sesión e ingresa con el correo invitado, o crea la cuenta de ese correo.</p>
      </div>
      <button type="button" onClick={signOut} disabled={isPending} className={secondaryButtonClass}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}
        Cerrar sesión
      </button>
    </>
  )
}

function NoSession({ token, preview }: { token: string; preview: InvitationPreview }) {
  const [tab, setTab] = useState<"crear" | "ingresar">("crear")
  const loginHref = `/auth/login?next=${encodeURIComponent(`/invitacion/${token}`)}`
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v === "ingresar" ? "ingresar" : "crear")} className="gap-4">
      <TabsList className="h-11 w-full">
        <TabsTrigger value="crear" className="min-h-9">
          Crear mi cuenta
        </TabsTrigger>
        <TabsTrigger value="ingresar" className="min-h-9">
          Ya tengo cuenta
        </TabsTrigger>
      </TabsList>
      <TabsContent value="crear">
        <CreateAccountForm token={token} preview={preview} loginHref={loginHref} />
      </TabsContent>
      <TabsContent value="ingresar">
        <p className="mb-4 text-sm text-muted-foreground">
          Inicia sesión con <strong className="break-all text-foreground">{preview.email}</strong> y volverás a esta página
          para aceptar la invitación.
        </p>
        <Link href={loginHref} className={primaryButtonClass}>
          Iniciar sesión
          <ArrowRight className="h-[18px] w-[18px] text-brand" aria-hidden />
        </Link>
      </TabsContent>
    </Tabs>
  )
}

function CreateAccountForm({
  token,
  preview,
  loginHref,
}: {
  token: string
  preview: InvitationPreview
  loginHref: string
}) {
  const id = useId()
  const router = useRouter()
  const [name, setName] = useState(preview.name ?? "")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [accountExists, setAccountExists] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const nm = name.trim()
    if (nm.length < 2) {
      setError("Ingresa tu nombre (al menos 2 caracteres).")
      return
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.")
      return
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.")
      return
    }
    setError(null)
    setAccountExists(false)
    startTransition(async () => {
      const res = await call(() => acceptObraInvitationWithNewAccount(token, { name: nm, password }))
      if (res.ok === false) {
        setError(res.error)
        setAccountExists(res.error.startsWith("Ya existe una cuenta"))
        return
      }
      setDone(true)
      router.push(`/obra/${res.data.project_id}`)
    })
  }

  const busy = isPending || done

  return (
    <>
      <ErrorBanner message={error} />
      {accountExists ? (
        <Link href={loginHref} className={`mb-4 ${secondaryButtonClass}`}>
          Iniciar sesión con {preview.email}
        </Link>
      ) : null}
      <form onSubmit={submit} noValidate>
        <label className={labelClass} htmlFor={`${id}-email`}>
          Correo
        </label>
        <input
          id={`${id}-email`}
          type="email"
          value={preview.email}
          readOnly
          aria-readonly
          aria-describedby={`${id}-email-hint`}
          className={`${inputClass} bg-secondary text-muted-foreground`}
        />
        <p id={`${id}-email-hint`} className="mb-[18px] mt-1 text-xs text-muted-foreground">
          La cuenta se crea con el correo invitado.
        </p>

        <label className={labelClass} htmlFor={`${id}-name`}>
          Nombre
        </label>
        <input
          id={`${id}-name`}
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          aria-required
          placeholder="María Pérez"
          className={`mb-[18px] ${inputClass}`}
        />

        <label className={labelClass} htmlFor={`${id}-password`}>
          Contraseña
        </label>
        <input
          id={`${id}-password`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          maxLength={256}
          required
          aria-required
          placeholder="Mínimo 8 caracteres"
          className={`mb-[18px] ${inputClass}`}
        />

        <label className={labelClass} htmlFor={`${id}-confirm`}>
          Confirmar contraseña
        </label>
        <input
          id={`${id}-confirm`}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          maxLength={256}
          required
          aria-required
          placeholder="Repite la contraseña"
          className={`mb-6 ${inputClass}`}
        />

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? (
            <>
              Creando cuenta…
              <Loader2 className="h-[18px] w-[18px] animate-spin text-brand" aria-hidden />
            </>
          ) : (
            <>
              Crear cuenta y entrar a la obra
              <ArrowRight className="h-[18px] w-[18px] text-brand" aria-hidden />
            </>
          )}
        </button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Tú eliges tu contraseña: nadie más la conoce.
        </p>
      </form>
    </>
  )
}
