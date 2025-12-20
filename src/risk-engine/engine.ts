// Motor de cálculo de riesgo por zona a partir de hallazgos.

import type {
  Finding,
  Plano,
  RiskSummary,
  UUID,
  Zone,
  SeverityLevel,
  FrequencyLevel,
} from "@/src/core"
import type { RiskRulesConfig } from "./rules"
import { defaultRiskRules } from "./rules"

export interface RiskEngineInput {
  plano: Plano
  findings: Finding[]
  rules?: RiskRulesConfig
}

export interface RiskEngineOutput {
  byZone: Map<UUID, RiskSummary>
}

export function calculateRiskIndex(input: RiskEngineInput): RiskEngineOutput {
  const rules = input.rules ?? defaultRiskRules
  const zoneById = new Map<UUID, Zone>()
  for (const el of input.plano.elements) {
    if (el.kind === "zone") zoneById.set(el.id, el)
  }

  const findingsByZoneId = new Map<UUID, Finding[]>()
  for (const f of input.findings) {
    if (!f.zoneId) continue
    const arr = findingsByZoneId.get(f.zoneId) ?? []
    arr.push(f)
    findingsByZoneId.set(f.zoneId, arr)
  }

  const baseIndexByZoneId = new Map<UUID, number>()
  const contributingFindingsByZoneId = new Map<UUID, UUID[]>()

  for (const [zoneId, zone] of zoneById) {
    const findings = findingsByZoneId.get(zoneId) ?? []
    let index = 0
    const contributing: UUID[] = []

    for (const f of findings) {
      const rule = rules.rules.find((r) => r.type === f.type) ?? rules.rules.find((r) => r.type === "any")
      if (!rule) continue
      const sevM = rule.severityMultiplier[f.severity] ?? 1
      const freqM = rule.frequencyMultiplier[f.frequency] ?? 1
      const contribution = rule.base * sevM * freqM
      index += contribution
      contributing.push(f.id)
    }

    baseIndexByZoneId.set(zoneId, index)
    contributingFindingsByZoneId.set(zoneId, contributing)
  }

  const propagatedIndexByZoneId = new Map<UUID, number>()
  for (const [zoneId, zone] of zoneById) {
    const base = baseIndexByZoneId.get(zoneId) ?? 0
    const relatedIds = zone.relatedZoneIds ?? []
    let propagated = base
    for (const relatedId of relatedIds) {
      const neighborBase = baseIndexByZoneId.get(relatedId) ?? 0
      propagated += neighborBase * rules.propagation.factor
    }
    propagatedIndexByZoneId.set(zoneId, propagated)
  }

  const byZone = new Map<UUID, RiskSummary>()
  const now = new Date().toISOString()
  for (const [zoneId] of zoneById) {
    const idx = propagatedIndexByZoneId.get(zoneId) ?? 0
    const summary: RiskSummary = {
      zoneId,
      index: idx,
      level: toRiskLevel(idx),
      contributingFindings: contributingFindingsByZoneId.get(zoneId) ?? [],
      lastUpdatedAt: now,
    }
    byZone.set(zoneId, summary)
  }
  return { byZone }
}

function toRiskLevel(index: number): RiskSummary["level"] {
  if (index <= 10) return "low"
  if (index <= 25) return "medium"
  if (index <= 50) return "high"
  return "critical"
}

export const EXAMPLE_RISK_RULES_JSON: RiskRulesConfig = defaultRiskRules

