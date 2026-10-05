import { describe, expect, it } from "vitest"
import { addDaysISO, isOverdue, projectRiskIndex, todayISO } from "./metrics"

describe("índice de riesgo", () => {
  it("obra sin hallazgos es de riesgo bajo", () => {
    expect(projectRiskIndex({ open_findings_by_severity: {}, overdue_tasks: 0, pending_critical_suggestions: 0 })).toEqual({ score: 0, level: "bajo" })
  })

  it("un hallazgo crítico eleva al menos a alto", () => {
    const r = projectRiskIndex({ open_findings_by_severity: { critical: 1 }, overdue_tasks: 0, pending_critical_suggestions: 0 })
    expect(r.level).toBe("alto")
  })

  it("muchos críticos saturan cerca de 100 sin pasarse", () => {
    const r = projectRiskIndex({ open_findings_by_severity: { critical: 50 }, overdue_tasks: 20, pending_critical_suggestions: 5 })
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.level).toBe("critico")
  })
})

describe("fechas", () => {
  it("suma días cruzando meses y años", () => {
    expect(addDaysISO("2026-12-28", 7)).toBe("2027-01-04")
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("rechaza fechas mal formadas", () => {
    expect(() => addDaysISO("05/10/2026", 1)).toThrow()
  })

  it("isOverdue compara contra hoy", () => {
    expect(isOverdue("2026-01-01", "2026-01-02")).toBe(true)
    expect(isOverdue("2026-01-02", "2026-01-02")).toBe(false)
    expect(isOverdue(null, "2026-01-02")).toBe(false)
  })

  it("todayISO usa formato YYYY-MM-DD", () => {
    expect(todayISO(new Date(2026, 9, 5))).toBe("2026-10-05")
  })
})
