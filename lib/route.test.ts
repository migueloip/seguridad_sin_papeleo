import { describe, it, expect } from "vitest"
import { parseIntId } from "./route"

describe("parseIntId", () => {
  it("returns number for valid positive integers", () => {
    expect(parseIntId("1")).toBe(1)
    expect(parseIntId("42")).toBe(42)
    expect(parseIntId("0012")).toBe(12)
  })

  it("returns null for zero or negative numbers", () => {
    expect(parseIntId("0")).toBeNull()
    expect(parseIntId("-1")).toBeNull()
  })

  it("returns null for non-integer or mixed strings", () => {
    expect(parseIntId("1.5")).toBeNull()
    expect(parseIntId("abc")).toBeNull()
    expect(parseIntId("12a")).toBeNull()
    expect(parseIntId(" ")).toBeNull()
  })
})
