// Interfaces para IA local y remota orientadas a generación de informes
// y propuestas de acción en base a hallazgos y planos.

import type { Finding, Plano, PlanoRiskAggregate, UUID } from "@/src/core"

export interface GenerateReportRequest {
  plano: Plano
  findings: Finding[]
  riskAggregates?: PlanoRiskAggregate[]
  locale: string
}

export interface GenerateReportResult {
  id: UUID
  title: string
  summary: string
  recommendations: string[]
}

export interface ActionProtocolRequest {
  findings: Finding[]
  locale: string
}

export interface ActionProtocolResult {
  steps: string[]
  priority: "low" | "medium" | "high" | "critical"
}

export interface ImageAnalysisRequest {
  findingId: UUID
  imageUrl: string
}

export interface ImageAnalysisResult {
  labels: string[]
  riskHints: string[]
}

export interface LocalAIProvider {
  id: "local"
  generateReport: (req: GenerateReportRequest) => Promise<GenerateReportResult>
  proposeActionProtocol: (req: ActionProtocolRequest) => Promise<ActionProtocolResult>
  analyzeImage: (req: ImageAnalysisRequest) => Promise<ImageAnalysisResult>
}

export interface RemoteAIProvider {
  id: "remote"
  generateReport: (req: GenerateReportRequest) => Promise<GenerateReportResult>
  proposeActionProtocol: (req: ActionProtocolRequest) => Promise<ActionProtocolResult>
  analyzeImage: (req: ImageAnalysisRequest) => Promise<ImageAnalysisResult>
}

export interface AIOrchestratorOptions {
  local?: LocalAIProvider
  remote: RemoteAIProvider
}

export class AIOrchestrator {
  private local?: LocalAIProvider
  private remote: RemoteAIProvider

  constructor(opts: AIOrchestratorOptions) {
    this.local = opts.local
    this.remote = opts.remote
  }

  async generateReport(req: GenerateReportRequest): Promise<GenerateReportResult> {
    if (this.local) return this.local.generateReport(req)
    return this.remote.generateReport(req)
  }

  async proposeActionProtocol(req: ActionProtocolRequest): Promise<ActionProtocolResult> {
    if (this.local) return this.local.proposeActionProtocol(req)
    return this.remote.proposeActionProtocol(req)
  }

  async analyzeImage(req: ImageAnalysisRequest): Promise<ImageAnalysisResult> {
    if (this.local) return this.local.analyzeImage(req)
    return this.remote.analyzeImage(req)
  }
}

