import { describe, expect, it, vi, beforeEach } from "vitest"

const sqlMock = vi.fn()

vi.mock("@/lib/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => sqlMock(strings, ...values),
}))

import { getMobileSessionFromRequest } from "./mobile-auth"

describe("getMobileSessionFromRequest", () => {
  beforeEach(() => {
    sqlMock.mockReset()
  })

  it("returns null when Authorization header is missing", async () => {
    const req = new Request("http://localhost/api/mobile/sync", { method: "POST" })
    const session = await getMobileSessionFromRequest(req)
    expect(session).toBeNull()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it("returns session when token is valid", async () => {
    sqlMock.mockResolvedValueOnce([{ user_id: 1, email: "a@a.com", name: null, role: "user" }])
    const req = new Request("http://localhost/api/mobile/sync", {
      method: "POST",
      headers: { Authorization: "Bearer t1" },
    })
    const session = await getMobileSessionFromRequest(req)
    expect(session?.user_id).toBe(1)
  })
})

