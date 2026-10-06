"use server"

/**
 * Acciones de invitaciones al equipo de obra. Cada export es un endpoint
 * público; la lógica y la autorización viven en lib/obra/server/invitations.ts.
 *
 * - Gestión (members.manage): crear, regenerar enlace, revocar y listar.
 * - Aceptación: con la sesión actual (acceptObraInvitation) o creando la
 *   cuenta (acceptObraInvitationWithNewAccount, sin sesión; abre la sesión al
 *   terminar). La página /invitacion/[token] es pública (middleware.ts).
 *
 * Sin límite de intentos propio en la aceptación: adivinar un token (256 bits)
 * no es viable, un token inválido se descarta antes de tocar bcrypt, y cada
 * invitación crea como máximo una cuenta (queda aceptada en la misma
 * transacción), así que el número de cuentas lo acotan las invitaciones que
 * crea quien gestiona el equipo.
 */
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { createSession } from "@/lib/auth"
import { requireSessionUserId, toActionError } from "@/lib/obra/access"
import {
  acceptInvitationAsUser,
  acceptInvitationWithNewAccount,
  createInvitation,
  httpOrigin,
  listInvitations,
  regenerateInvitationLink,
  revokeInvitation,
  type InvitationInput,
} from "@/lib/obra/server/invitations"
import type { ActionResult, InvitationLink, ObraInvitation } from "@/lib/obra/types"

const HOST_RE = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i
const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i

/**
 * Origen público de la app para armar el enlace: APP_URL, luego URL (Netlify)
 * y, si no hay, el host de la petición (x-forwarded-host/host y
 * x-forwarded-proto). Siempre http(s).
 */
async function appBaseUrl(): Promise<string> {
  for (const [key, raw] of [
    ["APP_URL", process.env.APP_URL],
    ["URL", process.env.URL],
  ] as const) {
    if (!raw || !raw.trim()) continue
    const origin = httpOrigin(raw)
    if (origin) return origin
    console.warn(`[obra] ${key} no es una URL http(s) válida; se ignora para los enlaces de invitación.`)
  }
  const h = await headers()
  const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim()
  if (!host || !HOST_RE.test(host)) {
    throw new Error("No se pudo determinar la URL pública de la app: define APP_URL.")
  }
  const fwdProto = (h.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase()
  const proto = fwdProto === "http" || fwdProto === "https" ? fwdProto : LOCAL_HOST_RE.test(host) ? "http" : "https"
  const origin = httpOrigin(`${proto}://${host}`)
  if (!origin) throw new Error("No se pudo determinar la URL pública de la app: define APP_URL.")
  return origin
}

export async function createObraInvitation(
  projectId: number,
  input: InvitationInput,
): Promise<ActionResult<InvitationLink>> {
  try {
    const userId = await requireSessionUserId()
    const data = await createInvitation(userId, projectId, input, await appBaseUrl())
    revalidatePath(`/obra/${data.invitation.project_id}/equipo`)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function regenerateObraInvitationLink(invitationId: number): Promise<ActionResult<InvitationLink>> {
  try {
    const userId = await requireSessionUserId()
    const data = await regenerateInvitationLink(userId, invitationId, await appBaseUrl())
    revalidatePath(`/obra/${data.invitation.project_id}/equipo`)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function revokeObraInvitation(invitationId: number): Promise<ActionResult<ObraInvitation>> {
  try {
    const userId = await requireSessionUserId()
    const data = await revokeInvitation(userId, invitationId)
    revalidatePath(`/obra/${data.project_id}/equipo`)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

export async function listObraInvitations(projectId: number): Promise<ActionResult<ObraInvitation[]>> {
  try {
    const userId = await requireSessionUserId()
    const data = await listInvitations(userId, projectId)
    return { ok: true, data }
  } catch (e) {
    return toActionError(e)
  }
}

/** Acepta con la sesión actual (el correo de la cuenta debe ser el invitado). */
export async function acceptObraInvitation(token: string): Promise<ActionResult<{ project_id: number }>> {
  try {
    const userId = await requireSessionUserId()
    const data = await acceptInvitationAsUser(userId, token)
    revalidatePath("/obra", "layout")
    return { ok: true, data: { project_id: data.project_id } }
  } catch (e) {
    return toActionError(e)
  }
}

/** Crea la cuenta del invitado, acepta y abre su sesión. Pública (sin sesión). */
export async function acceptObraInvitationWithNewAccount(
  token: string,
  input: { name: string; password: string },
): Promise<ActionResult<{ project_id: number }>> {
  try {
    const data = await acceptInvitationWithNewAccount(token, input)
    await createSession(data.user_id)
    revalidatePath("/obra", "layout")
    return { ok: true, data: { project_id: data.project_id } }
  } catch (e) {
    return toActionError(e)
  }
}
