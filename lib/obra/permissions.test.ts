import { describe, expect, it } from "vitest"
import { can, canAssignRole, canReviewSuggestion, permissionsFor, PERMISSIONS } from "./permissions"
import { OBRA_ROLES } from "./types"

describe("permisos de obra", () => {
  it("gerente tiene todos los permisos", () => {
    expect(permissionsFor("gerente").sort()).toEqual([...PERMISSIONS].sort())
  })

  it("trabajador solo reporta y cierra sus tareas", () => {
    expect(can("trabajador", "findings.report")).toBe(true)
    expect(can("trabajador", "tasks.complete_own")).toBe(true)
    expect(can("trabajador", "tasks.complete_any")).toBe(false)
    expect(can("trabajador", "ai.review")).toBe(false)
    expect(can("trabajador", "tasks.view_all")).toBe(false)
  })

  it("visita es solo lectura", () => {
    for (const p of ["plans.manage", "findings.report", "tasks.manage", "ai.request", "ai.review", "members.manage"] as const) {
      expect(can("visita", p)).toBe(false)
    }
    expect(can("visita", "audit.view")).toBe(true)
  })

  it("rol nulo no tiene permisos", () => {
    expect(can(null, "project.view")).toBe(false)
    expect(can(undefined, "project.view")).toBe(false)
  })

  it("todo rol con acceso puede ver el proyecto", () => {
    for (const r of OBRA_ROLES) expect(can(r, "project.view")).toBe(true)
  })

  it("solo quien tiene ai.review_critical aprueba sugerencias críticas", () => {
    expect(canReviewSuggestion("prevencionista", "critical")).toBe(true)
    expect(canReviewSuggestion("jefe_obra", "critical")).toBe(true)
    expect(canReviewSuggestion("supervisor", "low")).toBe(false)
    expect(canReviewSuggestion("trabajador", "low")).toBe(false)
  })

  it("solo un gerente nombra gerentes", () => {
    expect(canAssignRole("gerente", "gerente")).toBe(true)
    expect(canAssignRole("jefe_obra", "gerente")).toBe(false)
    expect(canAssignRole("jefe_obra", "supervisor")).toBe(true)
    expect(canAssignRole("prevencionista", "trabajador")).toBe(false)
  })
})
