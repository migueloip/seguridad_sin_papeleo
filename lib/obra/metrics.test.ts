import { describe, expect, it } from "vitest"
import { addDaysISO, isOverdue, pickNextInspection, projectRiskIndex, todayISO } from "./metrics"

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
    expect(todayISO(new Date("2026-10-05T15:00:00Z"))).toBe("2026-10-05")
  })

  it("todayISO cuenta el día en la hora de Chile aunque el servidor esté en UTC", () => {
    // 01:30 UTC del 7 de octubre = 22:30 del 6 de octubre en Santiago (UTC−3).
    expect(todayISO(new Date("2026-10-07T01:30:00Z"))).toBe("2026-10-06")
    // Invierno (UTC−4): 03:59 UTC del 15 de junio = 23:59 del 14 de junio.
    expect(todayISO(new Date("2026-06-15T03:59:00Z"))).toBe("2026-06-14")
    expect(todayISO(new Date("2026-06-15T04:00:00Z"))).toBe("2026-06-15")
    // Una tarea que vence "hoy" en Chile no aparece vencida de noche.
    expect(isOverdue("2026-10-06", todayISO(new Date("2026-10-07T01:30:00Z")))).toBe(false)
  })
})

describe("próxima revisión (criterio único)", () => {
  const today = "2026-10-06"
  const ins = (id: number, status: string, scheduled_for: string) => ({ id, status, scheduled_for })

  it("prefiere la que está en curso", () => {
    const list = [ins(1, "programada", "2026-10-07"), ins(2, "en_curso", "2026-10-01"), ins(3, "cerrada", "2026-10-06")]
    expect(pickNextInspection(list, today)?.id).toBe(2)
  })

  it("luego la programada más próxima desde hoy", () => {
    const list = [ins(1, "programada", "2026-10-20"), ins(2, "programada", "2026-10-06"), ins(3, "programada", "2026-09-01")]
    expect(pickNextInspection(list, today)?.id).toBe(2)
  })

  it("si solo hay atrasadas, la más antigua; sin abiertas, null", () => {
    expect(pickNextInspection([ins(1, "programada", "2026-09-20"), ins(2, "programada", "2026-09-01")], today)?.id).toBe(2)
    expect(pickNextInspection([ins(1, "cerrada", "2026-10-07")], today)).toBeNull()
  })
})
