/**
 * Página pública de invitación al equipo de obra (/invitacion/<token>).
 *
 * - Pública por prefijo en middleware.ts: se puede abrir sin sesión.
 * - El token va en la URL: Referrer-Policy no-referrer (no se filtra a otros
 *   sitios) y noindex.
 * - Un token con formato inválido no consulta la BD.
 * - La vista previa no incluye ids internos ni revela si el correo tiene
 *   cuenta; aceptar lo valida todo de nuevo en el servidor.
 */
import type { Metadata } from "next"
import { AnimatedPage } from "@/components/animated-page"
import { AuthBrandPanel } from "@/components/easysecure/auth-brand-panel"
import { InvitationAccept } from "@/components/obra/invitation-accept"
import { getSession } from "@/lib/auth"
import { getInvitationPreview, isInvitationToken } from "@/lib/obra/server/invitations"
import type { InvitationPreview } from "@/lib/obra/types"

export const metadata: Metadata = {
  title: "Invitación a una obra",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

export const dynamic = "force-dynamic"

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params
  const token = isInvitationToken(raw) ? raw : ""

  let preview: InvitationPreview | null = null
  let loadError = false
  if (token) {
    try {
      preview = await getInvitationPreview(token)
    } catch (e) {
      console.error("[obra] vista previa de invitación", e)
      loadError = true
    }
  }

  // La sesión solo importa si el enlace corresponde a una invitación.
  const session = preview ? await getSession() : null
  const viewer = session ? { email: String(session.email), name: session.name ?? null } : null

  return (
    <AnimatedPage duration={400}>
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        <AuthBrandPanel />
        <main className="flex items-center justify-center bg-background p-6 sm:p-10">
          <div className="w-full max-w-[420px]">
            <InvitationAccept token={token} preview={preview} viewer={viewer} loadError={loadError} />
          </div>
        </main>
      </div>
    </AnimatedPage>
  )
}
