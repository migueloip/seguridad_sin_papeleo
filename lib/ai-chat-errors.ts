/**
 * Mensaje para mostrar cuando falla un chat de IA (useChat de @ai-sdk/react
 * v5 contra /api/assistant). Con DefaultChatTransport, un HTTP no-ok llega
 * como Error cuyo mensaje es el CUERPO de la respuesta (texto del servidor);
 * un error dentro del stream llega con el texto genérico en inglés del SDK.
 * Puro: se usa en componentes cliente.
 */
const GENERIC =
  "No pude conectar con la IA. Revisa la configuración de IA (proveedor y API key) en Configuración o intenta de nuevo en unos minutos."

export function chatErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const text = raw.trim()
  if (!text) return GENERIC
  if (/^no autenticado$/i.test(text) || /\b401\b|unauthorized/i.test(text)) {
    return "Tu sesión venció. Vuelve a iniciar sesión para usar el asistente."
  }
  // Solo textos cortos en español del propio servidor (no HTML de un proxy ni errores del SDK en inglés).
  const looksSpanish = /[áéíóúñ¿¡]|\b(la|el|de|tu|para|en|configura)\b/i.test(text)
  if (text.length <= 300 && !/[<>{}]/.test(text) && looksSpanish) return text
  return GENERIC
}
