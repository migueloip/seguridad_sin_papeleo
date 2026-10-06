// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import {
  PLAN_IMAGE_MAX_BYTES,
  PLAN_IMAGE_MAX_SIDE,
  detectPlanFileKind,
  estimateDataUrlBytes,
  readImageFileAsDataUrl,
  readTextFile,
  type PlanFileKind,
} from "./client-files"

describe("detectPlanFileKind", () => {
  const cases: Array<[string, string, PlanFileKind]> = [
    ["plano.png", "image/png", "image"],
    ["FOTO.JPG", "image/jpeg", "image"],
    ["lamina.webp", "", "image"],
    ["escaneo", "image/jpeg", "image"],
    ["planta-arq.pdf", "application/pdf", "pdf"],
    ["planta-arq.PDF", "", "pdf"],
    ["sin-extension", "application/pdf", "pdf"],
    ["alcantarillado.dxf", "", "dxf"],
    ["alcantarillado.DXF", "application/octet-stream", "dxf"],
    ["plano", "image/vnd.dxf", "dxf"],
    ["estructura.dwg", "", "dwg"],
    ["estructura", "application/acad", "dwg"],
    ["foto.heic", "image/heic", "unknown"],
    ["notas.txt", "text/plain", "unknown"],
    ["planilla.xlsx", "", "unknown"],
  ]

  it.each(cases)("%s (%s) → %s", (name, type, expected) => {
    expect(detectPlanFileKind(new File(["x"], name, { type }))).toBe(expected)
  })
})

describe("estimateDataUrlBytes", () => {
  it("calcula los bytes decodificados de un data URL base64", () => {
    expect(estimateDataUrlBytes("data:text/plain;base64,SGVsbG8=")).toBe(5) // "Hello"
    expect(estimateDataUrlBytes("data:text/plain;base64,SGk=")).toBe(2) // "Hi"
    expect(estimateDataUrlBytes("data:text/plain;base64,SGV5")).toBe(3) // "Hey"
    expect(estimateDataUrlBytes("data:image/png;base64,")).toBe(0)
    const big = "data:image/png;base64," + "A".repeat(4_000_000)
    expect(estimateDataUrlBytes(big)).toBe(3_000_000)
  })

  it("cuenta los escapes %XX en data URL sin base64", () => {
    expect(estimateDataUrlBytes("data:text/plain,hola%20mundo")).toBe(10)
  })

  it("devuelve 0 si no es un data URL", () => {
    expect(estimateDataUrlBytes("")).toBe(0)
    expect(estimateDataUrlBytes("https://ejemplo.cl/plano.png")).toBe(0)
    expect(estimateDataUrlBytes("data:sin-coma")).toBe(0)
  })
})

describe("readTextFile", () => {
  it("lee UTF-8 y, si no es válido, Windows-1252", async () => {
    const utf8 = new File([new TextEncoder().encode("Cañería Ø160")], "a.dxf")
    expect(await readTextFile(utf8)).toBe("Cañería Ø160")
    // "Cañería" en Windows-1252 (ñ = 0xF1, í = 0xED): no es UTF-8 válido.
    const latin = new File([new Uint8Array([0x43, 0x61, 0xf1, 0x65, 0x72, 0xed, 0x61])], "b.dxf")
    expect(await readTextFile(latin)).toBe("Cañería")
  })
})

describe("readImageFileAsDataUrl", () => {
  it("expone límites por defecto razonables", () => {
    expect(PLAN_IMAGE_MAX_SIDE).toBe(3000)
    // Bajo el límite de 6 MB por request de las funciones de Netlify, con margen para el resto del cuerpo.
    expect(PLAN_IMAGE_MAX_BYTES).toBe(4_500_000)
    expect(PLAN_IMAGE_MAX_BYTES).toBeLessThan(6 * 1024 * 1024 * 0.8)
  })

  it("rechaza archivos que no son imágenes", async () => {
    await expect(readImageFileAsDataUrl(new File(["0\nSECTION"], "plano.dxf"))).rejects.toThrow(/no es una imagen/)
  })
})
