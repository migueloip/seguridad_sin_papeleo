// @vitest-environment node
import { describe, expect, it } from "vitest"
import { isAllowedUserAiBaseUrl, isPrivateHost, resolveAiSettings } from "./ai-settings"

const PROD = { NODE_ENV: "production" }
const DEV = { NODE_ENV: "development" }

describe("resolveAiSettings: la key del servidor nunca viaja a una URL del usuario", () => {
  const global = { provider: "google", apiKey: "CLAVE-GLOBAL" }

  it("sin URL propia usa la key global con el endpoint oficial", () => {
    const r = resolveAiSettings({}, global, PROD)
    expect(r).toMatchObject({ provider: "google", apiKey: "CLAVE-GLOBAL", baseUrl: null, ready: true })
  })

  it("con URL propia y sin key propia no usa la key global (no queda lista)", () => {
    const r = resolveAiSettings({ baseUrl: "https://atacante.example.com/v1beta" }, global, PROD)
    expect(r.apiKey).toBe("")
    expect(r.ready).toBe(false)
  })

  it("con URL propia tampoco usa la key del entorno", () => {
    const r = resolveAiSettings({ baseUrl: "https://atacante.example.com" }, {}, { ...PROD, AI_API_KEY: "CLAVE-ENTORNO" })
    expect(r.apiKey).toBe("")
    expect(r.ready).toBe(false)
  })

  it("con URL y key propias funciona", () => {
    const r = resolveAiSettings({ baseUrl: "https://gateway.example.com", apiKey: "MIA" }, global, PROD)
    expect(r).toMatchObject({ apiKey: "MIA", baseUrl: "https://gateway.example.com", ready: true })
  })

  it("la URL base global (del administrador) sí se combina con la key global", () => {
    const r = resolveAiSettings({}, { ...global, baseUrl: "https://proxy.interno.cl" }, PROD)
    expect(r).toMatchObject({ apiKey: "CLAVE-GLOBAL", baseUrl: "https://proxy.interno.cl", ready: true })
  })

  it("no manda la key global de un proveedor a otro", () => {
    const r = resolveAiSettings({ provider: "openai" }, global, PROD)
    expect(r.apiKey).toBe("")
    expect(r.ready).toBe(false)
  })

  it("custom con URL propia puede ir sin key (servidor local en desarrollo)", () => {
    const r = resolveAiSettings({ provider: "custom", baseUrl: "http://localhost:11434/v1" }, global, DEV)
    expect(r).toMatchObject({ provider: "custom", apiKey: "", baseUrl: "http://localhost:11434/v1", ready: true })
  })

  it("en producción rechaza URLs propias hacia la red interna (SSRF)", () => {
    for (const url of [
      "http://gateway.example.com",
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://10.0.0.5/v1",
      "https://169.254.169.254/latest",
      "https://[::1]/v1",
      "https://metadata.google.internal/",
      "ftp://example.com",
    ]) {
      const r = resolveAiSettings({ provider: "custom", baseUrl: url }, {}, PROD)
      expect(r.ready, url).toBe(false)
      expect(r.baseUrl, url).toBeNull()
    }
  })
})

describe("validación de URL base propia", () => {
  it("detecta hosts privados", () => {
    expect(isPrivateHost("192.168.1.10")).toBe(true)
    expect(isPrivateHost("172.20.0.1")).toBe(true)
    expect(isPrivateHost("fd00::1")).toBe(true)
    expect(isPrivateHost("::ffff:10.0.0.1")).toBe(true)
    expect(isPrivateHost("intranet")).toBe(true)
    expect(isPrivateHost("api.openai.com")).toBe(false)
    expect(isPrivateHost("8.8.8.8")).toBe(false)
  })

  it("AI_ALLOW_PRIVATE_BASE_URL=1 lo permite en instalaciones propias", () => {
    expect(isAllowedUserAiBaseUrl("http://10.0.0.5:11434/v1", { ...PROD, AI_ALLOW_PRIVATE_BASE_URL: "1" })).toBe(true)
    expect(isAllowedUserAiBaseUrl("http://10.0.0.5:11434/v1", PROD)).toBe(false)
  })

  it("rechaza credenciales embebidas en la URL", () => {
    expect(isAllowedUserAiBaseUrl("https://user:pass@example.com", DEV)).toBe(false)
  })
})
