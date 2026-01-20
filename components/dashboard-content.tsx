"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    FileText,
    AlertTriangle,
    Users,
    FolderKanban,
    FileBarChart,
    Settings,
    Clock,
    CheckCircle2,
    XCircle,
    TrendingUp,
    ImageIcon,
    ArrowRight,
} from "lucide-react"
import type { DashboardStats } from "@/app/actions/dashboard"
import { FindingsChart } from "./findings-chart"
import { RiskHeatmap } from "./risk-heatmap"

interface DashboardContentProps {
    stats: DashboardStats
    userName?: string | null
}

const quickAccessItems = [
    {
        title: "Proyectos",
        description: "Gestionar proyectos activos",
        href: "/",
        icon: FolderKanban,
        color: "from-blue-500 to-blue-600",
    },
    {
        title: "Documentos",
        description: "Control de documentación",
        href: "/documentos",
        icon: FileText,
        color: "from-emerald-500 to-emerald-600",
    },
    {
        title: "Hallazgos",
        description: "Seguimiento de incidencias",
        href: "/hallazgos",
        icon: AlertTriangle,
        color: "from-amber-500 to-amber-600",
    },
    {
        title: "Personal",
        description: "Gestión de trabajadores",
        href: "/personal",
        icon: Users,
        color: "from-violet-500 to-violet-600",
    },
    {
        title: "Informes",
        description: "Generar reportes",
        href: "/informes",
        icon: FileBarChart,
        color: "from-pink-500 to-pink-600",
    },
    {
        title: "Planos",
        description: "Visualizar planos",
        href: "/planos",
        icon: ImageIcon,
        color: "from-cyan-500 to-cyan-600",
    },
]

export function DashboardContent({ stats, userName }: DashboardContentProps) {
    const greeting = getGreeting()
    const totalOpenFindings = stats.findings.open + stats.findings.in_progress

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-bold md:text-3xl">
                        {greeting}, {userName || "Usuario"}
                    </h1>
                    <p className="text-muted-foreground">
                        Resumen general de seguridad y gestión documental
                    </p>
                </div>
                <div className="flex gap-2">
                    <Link href="/configuracion">
                        <Button variant="outline" size="sm">
                            <Settings className="mr-2 h-4 w-4" />
                            Configuración
                        </Button>
                    </Link>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title="Proyectos"
                    value={stats.projects.total}
                    subtitle={`${stats.projects.active} activos`}
                    icon={FolderKanban}
                    trend={stats.projects.active > 0 ? "up" : undefined}
                    color="text-blue-500"
                />
                <KpiCard
                    title="Personal Activo"
                    value={stats.workers.active}
                    subtitle={`${stats.workers.total} registrados`}
                    icon={Users}
                    color="text-violet-500"
                />
                <KpiCard
                    title="Documentos Vigentes"
                    value={stats.documents.valid}
                    subtitle={`${stats.documents.expiring} por vencer`}
                    icon={FileText}
                    trend={stats.documents.expired > 0 ? "warning" : "up"}
                    color={stats.documents.expired > 0 ? "text-amber-500" : "text-emerald-500"}
                />
                <KpiCard
                    title="Hallazgos Abiertos"
                    value={totalOpenFindings}
                    subtitle={`${stats.findings.critical} críticos`}
                    icon={AlertTriangle}
                    trend={stats.findings.critical > 0 ? "critical" : totalOpenFindings > 0 ? "warning" : "up"}
                    color={stats.findings.critical > 0 ? "text-red-500" : "text-amber-500"}
                />
            </div>

            {/* Quick Access Grid */}
            <div>
                <h2 className="mb-4 text-lg font-semibold">Acceso Rápido</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {quickAccessItems.map((item) => (
                        <Link key={item.href} href={item.href}>
                            <Card className="group cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-[1.02] hover:border-primary/50">
                                <CardContent className="flex items-center gap-4 p-4">
                                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${item.color} shadow-lg`}>
                                        <item.icon className="h-6 w-6 text-white" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-semibold group-hover:text-primary">{item.title}</h3>
                                        <p className="text-sm text-muted-foreground">{item.description}</p>
                                    </div>
                                    <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid gap-6 lg:grid-cols-2">
                <FindingsChart data={stats.findingsWeekly} />
                <RiskHeatmap data={stats.riskByLocation} />
            </div>

            {/* Bottom Row */}
            <div className="grid gap-6 lg:grid-cols-2">
                {/* Document Status Summary */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Estado de Documentación
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <StatusRow
                                label="Vigentes"
                                value={stats.documents.valid}
                                total={stats.documents.total}
                                color="bg-emerald-500"
                                icon={CheckCircle2}
                            />
                            <StatusRow
                                label="Por vencer (30 días)"
                                value={stats.documents.expiring}
                                total={stats.documents.total}
                                color="bg-amber-500"
                                icon={Clock}
                            />
                            <StatusRow
                                label="Vencidos"
                                value={stats.documents.expired}
                                total={stats.documents.total}
                                color="bg-red-500"
                                icon={XCircle}
                            />
                        </div>
                        <div className="mt-4 pt-4 border-t">
                            <Link href="/documentos">
                                <Button variant="outline" className="w-full">
                                    Ver todos los documentos
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </Link>
                        </div>
                    </CardContent>
                </Card>

                {/* Upcoming Expirations */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="h-5 w-5" />
                            Próximos Vencimientos
                        </CardTitle>
                        <CardDescription>Documentos que vencen en los próximos 30 días</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {stats.upcomingExpirations.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">
                                No hay documentos por vencer próximamente
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {stats.upcomingExpirations.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium truncate">{doc.worker_name}</p>
                                            <p className="text-sm text-muted-foreground truncate">{doc.document_type}</p>
                                        </div>
                                        <Badge variant={doc.days_until <= 7 ? "destructive" : doc.days_until <= 14 ? "default" : "secondary"}>
                                            {doc.days_until === 0 ? "Hoy" : doc.days_until === 1 ? "Mañana" : `${doc.days_until} días`}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

// Helper components

interface KpiCardProps {
    title: string
    value: number
    subtitle: string
    icon: React.ComponentType<{ className?: string }>
    color?: string
    trend?: "up" | "warning" | "critical"
}

function KpiCard({ title, value, subtitle, icon: Icon, color = "text-primary", trend }: KpiCardProps) {
    return (
        <Card className="relative overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
                <Icon className={`h-5 w-5 ${color}`} />
            </CardHeader>
            <CardContent>
                <div className="text-3xl font-bold">{value}</div>
                <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
                    {trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                    {trend === "warning" && <Clock className="h-3 w-3 text-amber-500" />}
                    {trend === "critical" && <AlertTriangle className="h-3 w-3 text-red-500" />}
                </div>
            </CardContent>
            {/* Decorative gradient */}
            <div className={`absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r ${trend === "critical" ? "from-red-500 to-red-600" :
                    trend === "warning" ? "from-amber-500 to-amber-600" :
                        "from-primary to-primary/80"
                }`} />
        </Card>
    )
}

interface StatusRowProps {
    label: string
    value: number
    total: number
    color: string
    icon: React.ComponentType<{ className?: string }>
}

function StatusRow({ label, value, total, color, icon: Icon }: StatusRowProps) {
    const percentage = total > 0 ? Math.round((value / total) * 100) : 0
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${color.replace("bg-", "text-")}`} />
                    <span className="text-sm font-medium">{label}</span>
                </div>
                <span className="text-sm font-semibold">{value}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
                <div
                    className={`h-2 rounded-full ${color}`}
                    style={{ width: `${percentage}%`, transition: "width 0.5s ease" }}
                />
            </div>
        </div>
    )
}

function getGreeting(): string {
    const hour = new Date().getHours()
    if (hour < 12) return "Buenos días"
    if (hour < 19) return "Buenas tardes"
    return "Buenas noches"
}
