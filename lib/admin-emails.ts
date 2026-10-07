/**
 * Correos con rol de administración global (variable ADMIN_EMAILS, separados
 * por coma). Solo servidor.
 *
 * La app NO verifica la propiedad de los correos (no envía confirmaciones):
 * por eso un correo de esta lista solo da el rol admin a la cuenta que se
 * registra con él o que ya lo tiene (registerAction/loginAction), y nadie
 * puede ponérselo después desde su perfil (updateProfile lo rechaza salvo a
 * quien ya es admin). Así, cambiar el correo propio no sirve para obtener el
 * rol.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** ¿Está este correo (sin distinguir mayúsculas) en ADMIN_EMAILS? */
export function isAdminEmail(email: unknown): boolean {
  if (typeof email !== "string") return false
  const e = email.trim().toLowerCase()
  return e !== "" && adminEmails().includes(e)
}
