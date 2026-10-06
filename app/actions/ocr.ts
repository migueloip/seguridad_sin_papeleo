"use server"

import { getCurrentUserId } from "@/lib/auth"
import { getSetting } from "./settings"

/** Máximo de la data URL de un PDF (8 MB, igual que bodySizeLimit). */
const MAX_PDF_DATA_URL_CHARS = 8 * 1024 * 1024
/** Máximo de texto devuelto al cliente (un PDF enorme no debe saturar la respuesta). */
const MAX_TEXT_CHARS = 1_000_000

async function requireUserId(): Promise<number> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("No autenticado")
  return Number(userId)
}

export async function getOcrMethod(): Promise<string> {
  await requireUserId()
  const method = await getSetting("ocr_method")
  return method || "tesseract"
}

export async function extractPdfText(dataUrl: string): Promise<string> {
  await requireUserId()
  if (typeof dataUrl !== "string") return ""
  if (dataUrl.length > MAX_PDF_DATA_URL_CHARS) throw new Error("El PDF supera el tamaño máximo (8 MB).")
  const m = dataUrl.match(/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!m) return ""
  const b64 = m[1]
  const buf = Buffer.from(b64, "base64")
  const pdfParseMod = (await import("pdf-parse")) as unknown as { default: (data: Buffer) => Promise<{ text?: string }> }
  const out = await pdfParseMod.default(buf)
  return typeof out?.text === "string" ? out.text.slice(0, MAX_TEXT_CHARS) : ""
}
