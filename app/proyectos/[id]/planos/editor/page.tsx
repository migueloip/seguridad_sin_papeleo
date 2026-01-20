import { DashboardLayout } from "@/components/dashboard-layout"
import { PlanEditor } from "@/components/plans-3d/editor"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function PlansEditorPage({ params }: { params: { id: string } }) {
    const session = await getSession()
    if (!session) redirect("/auth/login")

    const layoutUser = {
        name: session.name,
        email: session.email,
        role: session.role
    }

    return (
        <DashboardLayout user={layoutUser}>
            <div className="flex flex-col gap-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Editor de Planos 3D</h1>
                    <p className="text-muted-foreground">
                        Visualización y gestión inteligente de planos con IA
                    </p>
                </div>

                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-1">
                    <PlanEditor />
                </div>
            </div>
        </DashboardLayout>
    )
}
