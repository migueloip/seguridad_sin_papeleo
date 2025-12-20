"use server"

import { getSetting } from "./settings"

export async function getOcrMethod(): Promise<string> {
  const method = await getSetting("ocr_method")
  return method || "tesseract"
}

export async function extractPdfText(dataUrl: string): Promise<string> {
  const m = String(dataUrl || "").match(/^data:application\/pdf;base64,(.+)$/)
  if (!m) return ""
  const b64 = m[1]
  const buf = Buffer.from(b64, "base64")
  const pdfParseMod = (await import("pdf-parse")) as unknown as { default: (data: Buffer) => Promise<{ text?: string }> }
  const out = await pdfParseMod.default(buf)
  return typeof out?.text === "string" ? out.text : ""
}
