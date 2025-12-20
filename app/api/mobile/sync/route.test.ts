import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mobile-auth", () => ({
  getMobileSessionFromRequest: async () => null,
}))

describe("POST /api/mobile/sync", () => {
  it("returns 401 when no bearer token", async () => {
    const { POST } = await import("./route")
    const req = new Request("http://localhost/api/mobile/sync", { method: "POST", body: JSON.stringify({ lastSync: null, outbox: [] }) })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
