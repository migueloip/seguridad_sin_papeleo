// Definición de reglas de riesgo configurables en JSON.

import type { FindingType, SeverityLevel, FrequencyLevel } from "@/src/core"

export interface RiskRule {
  type: FindingType | "any"
  base: number
  severityMultiplier: number[]
  frequencyMultiplier: number[]
}

export interface PropagationRule {
  factor: number
}

export interface RiskRulesConfig {
  rules: RiskRule[]
  propagation: PropagationRule
}

export const defaultRiskRules: RiskRulesConfig = {
  rules: [
    {
      type: "fall_risk",
      base: 8,
      severityMultiplier: [0, 1, 1.4, 1.8, 2.3, 2.8],
      frequencyMultiplier: [0, 1, 1.2, 1.5, 1.9, 2.5],
    },
    {
      type: "fire_risk",
      base: 7,
      severityMultiplier: [0, 1, 1.3, 1.7, 2.2, 2.7],
      frequencyMultiplier: [0, 1, 1.1, 1.4, 1.8, 2.3],
    },
    {
      type: "electrical_risk",
      base: 6,
      severityMultiplier: [0, 1, 1.2, 1.6, 2.1, 2.6],
      frequencyMultiplier: [0, 1, 1.1, 1.3, 1.7, 2.2],
    },
    {
      type: "any",
      base: 4,
      severityMultiplier: [0, 1, 1.2, 1.4, 1.7, 2.0],
      frequencyMultiplier: [0, 1, 1.1, 1.3, 1.5, 1.8],
    },
  ],
  propagation: {
    factor: 0.35,
  },
}

