import { toOptionalDate } from "./utils"

describe("toOptionalDate", () => {
  it("returns null for undefined or null", () => {
    expect(toOptionalDate(undefined)).toBeNull()
    expect(toOptionalDate(null)).toBeNull()
  })

  it("returns null for empty or invalid strings", () => {
    expect(toOptionalDate("")).toBeNull()
    expect(toOptionalDate("invalid")).toBeNull()
  })

  it("parses ISO and DMY strings", () => {
    const iso = toOptionalDate("2025-01-02")!
    expect(iso.getFullYear()).toBe(2025)
    expect(iso.getMonth()).toBe(0)
    expect(iso.getDate()).toBe(2)

    const dmy = toOptionalDate("2/1/2025")!
    expect(dmy.getFullYear()).toBe(2025)
    expect(dmy.getMonth()).toBe(0)
    expect(dmy.getDate()).toBe(2)
  })

  it("handles Date instances", () => {
    const d = new Date("2025-01-02")
    expect(toOptionalDate(d)).toEqual(d)
    const bad = new Date("not-a-date")
    expect(toOptionalDate(bad)).toBeNull()
  })
})
