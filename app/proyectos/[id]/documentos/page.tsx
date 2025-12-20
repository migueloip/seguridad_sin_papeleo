import { DashboardLayout } from "@/components/dashboard-layout"
import { DocumentsContent } from "@/components/documents-content"
import { getDocumentTypes, getDocumentsByProject } from "@/app/actions/documents"
import { getWorkers } from "@/app/actions/workers"
import { getProjectById } from "@/app/actions/projects"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export default async function ProjectDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await params
  const parsed = parseIntId(p.id)
  if (parsed === null) notFound()
  const id = parsed
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const [documents, workers, documentTypes] = await Promise.all([getDocumentsByProject(id), getWorkers(id), getDocumentTypes()])

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <DocumentsContent initialDocuments={documents} workers={workers} documentTypes={documentTypes} projectId={id} />
    </DashboardLayout>
  )
}
