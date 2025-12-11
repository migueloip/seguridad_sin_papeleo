import { KpiCards } from "./kpi-cards"
import { FindingsChart } from "./findings-chart"
import { UpcomingExpirations } from "./upcoming-expirations"
import { RecentFindings } from "./recent-findings"

interface DashboardStats {
  documents: { valid: number; expiring: number; expired: number }
  findings: { open: number; in_progress: number; resolved: number }
  workers: number
  expiringDocs: Array<{
    id: number
    first_name: string
    last_name: string
    document_type: string
    expiry_date: string
  }>
  recentFindings: Array<{
    id: number
    title: string
    severity: string
    status: string
    project_name: string
    created_at: string
  }>
}

export function DashboardContent({ stats }: { stats: DashboardStats }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Vista general de la seguridad en obra</p>
      </div>

      <KpiCards documents={stats.documents} findings={stats.findings} workers={stats.workers} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FindingsChart />
        <UpcomingExpirations expirations={stats.expiringDocs} />
      </div>

      <RecentFindings findings={stats.recentFindings} />
    </div>
  )
}
