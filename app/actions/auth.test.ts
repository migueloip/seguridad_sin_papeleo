// @vitest-environment node
import bcrypt from "bcryptjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { safeNextPath } from "@/lib/safe-redirect"

// ---------------------------------------------------------------------------
// Dobles de prueba: BD, sesión y redirect de Next
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  user: null as null | { id: number; email: string; password_hash: string; role: string | null },
  inserted: [] as unknown[][],
}))

vi.mock("@/lib/db", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?")
    if (text.includes("SELECT * FROM users")) return Promise.resolve(state.user ? [state.user] : [])
    if (text.includes("SELECT id FROM users")) return Promise.resolve([])
    if (text.includes("INSERT INTO users")) {
      state.inserted.push(values)
      return Promise.resolve([{ id: 77, role: "user" }])
    }
    if (text.includes("COUNT(*)")) return Promise.resolve([{ count: "3" }])
    return Promise.resolve([])
  }
  return { sql }
})
vi.mock("@/lib/auth", () => ({ createSession: vi.fn(async () => undefined), destroySession: vi.fn(async () => undefined) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

function form(values: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(values)) fd.set(k, v)
  return fd
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const m = /^REDIRECT:([^]*)$/.exec((e as Error).message)
    if (m) return m[1]
    throw e
  }
  throw new Error("Se esperaba un redirect")
}

// ---------------------------------------------------------------------------
// Validador puro
// ---------------------------------------------------------------------------

describe("safeNextPath (retorno seguro tras iniciar sesión)", () => {
  it("acepta rutas relativas del mismo sitio", () => {
    expect(safeNextPath("/obra/12")).toBe("/obra/12")
    expect(safeNextPath("/invitacion/AbC-_123")).toBe("/invitacion/AbC-_123")
    expect(safeNextPath("/obra?tab=tareas#x")).toBe("/obra?tab=tareas#x")
    expect(safeNextPath("/")).toBe("/")
    // Codificado sigue siendo una ruta del mismo sitio.
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com")
  })

  it("rechaza otros orígenes y trucos de navegador", () => {
    for (const bad of [
      "//evil.com",
      "///evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "/\\/evil.com",
      "https://evil.com",
      "http:/evil.com",
      "javascript:alert(1)",
      "obra/12",
      "",
      " /obra",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/ /evil.com",
      "/ /evil.com",
      "/ /evil.com",
      "/.//evil.com",
      "/./\\evil.com",
      "/" + "a".repeat(3000),
    ]) {
      expect(safeNextPath(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it("rechaza valores que no son texto", () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath(42)).toBeNull()
    expect(safeNextPath(["/obra"])).toBeNull()
    expect(safeNextPath(new File(["x"], "x.txt"))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// loginAction / registerAction respetan ?next= solo si es seguro
// ---------------------------------------------------------------------------

describe("loginAction y registerAction con ?next=", () => {
  beforeEach(() => {
    state.user = { id: 5, email: "ana@test.cl", password_hash: bcrypt.hashSync("clave-segura", 4), role: "user" }
    state.inserted = []
    delete process.env.ADMIN_EMAILS
  })

  it("login vuelve a la ruta pedida (p.ej. la invitación) si es relativa", async () => {
    const { loginAction } = await import("./auth")
    const to = await redirectOf(
      loginAction(null, form({ email: "ana@test.cl", password: "clave-segura", next: "/invitacion/abc" })),
    )
    expect(to).toBe("/invitacion/abc")
  })

  it("login ignora un next peligroso y usa el destino por rol", async () => {
    const { loginAction } = await import("./auth")
    expect(await redirectOf(loginAction(null, form({ email: "ana@test.cl", password: "clave-segura", next: "//evil.com" })))).toBe("/")
    expect(
      await redirectOf(loginAction(null, form({ email: "ana@test.cl", password: "clave-segura", next: "https://evil.com/x" }))),
    ).toBe("/")
    state.user = { ...(state.user as NonNullable<typeof state.user>), role: "admin" }
    expect(await redirectOf(loginAction(null, form({ email: "ana@test.cl", password: "clave-segura" })))).toBe("/admin")
  })

  it("login con credenciales inválidas no redirige", async () => {
    const { loginAction } = await import("./auth")
    const r = await loginAction(null, form({ email: "ana@test.cl", password: "otra", next: "/obra" }))
    expect(r).toEqual({ error: "Credenciales inválidas", values: { email: "ana@test.cl" } })
  })

  it("registro vuelve a la ruta pedida o al inicio", async () => {
    const { registerAction } = await import("./auth")
    const base = { email: "nuevo@test.cl", name: "Nuevo", password: "clave-segura", confirm: "clave-segura" }
    expect(await redirectOf(registerAction(null, form({ ...base, next: "/obra/3" })))).toBe("/obra/3")
    expect(await redirectOf(registerAction(null, form({ ...base, next: "/\\evil.com" })))).toBe("/")
    expect(state.inserted).toHaveLength(2)
  })
})
