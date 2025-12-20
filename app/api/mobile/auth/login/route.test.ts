import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sqlMock = vi.fn()
const bcryptCompareMock = vi.fn()

vi.mock("@/lib/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => sqlMock(strings, ...values),
}))

vi.mock("bcryptjs", () => ({
  default: { compare: (...args: unknown[]) => bcryptCompareMock(...args) },
}))

describe("POST /api/mobile/auth/login", () => {
  beforeEach(() => {
    sqlMock.mockReset()
    bcryptCompareMock.mockReset()
    if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("uuid-test")
    } else {
      vi.stubGlobal("crypto", { randomUUID: () => "uuid-test" } as unknown as Crypto)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("returns 400 when missing fields", async () => {
    const { POST } = await import("./route")
    const req = new Request("http://localhost/api/mobile/auth/login", { method: "POST", body: JSON.stringify({}) })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 401 when user not found", async () => {
    sqlMock.mockResolvedValueOnce([])
    const { POST } = await import("./route")
    const req = new Request("http://localhost/api/mobile/auth/login", { method: "POST", body: JSON.stringify({ email: "a@a.com", password: "x" }) })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns token when valid", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1, email: "a@a.com", name: null, password_hash: "h", role: "user" }])
    bcryptCompareMock.mockResolvedValueOnce(true)
    sqlMock.mockResolvedValueOnce([])
    const { POST } = await import("./route")
    const req = new Request("http://localhost/api/mobile/auth/login", { method: "POST", body: JSON.stringify({ email: "a@a.com", password: "x" }) })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.token).toBe("uuid-test")
  })
})
