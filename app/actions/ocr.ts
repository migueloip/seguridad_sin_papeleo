"use server"

import { getSetting } from "./settings"

export async function getOcrMethod(): Promise<string> {
  const method = await getSetting("ocr_method")
  return method || "tesseract"
}
