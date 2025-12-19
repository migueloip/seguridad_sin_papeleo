import { DashboardLayout } from "@/components/dashboard-layout"
import { DocumentsContent } from "@/components/documents-content"
import { getDocuments, getDocumentTypes } from "@/app/actions/documents"
import { getWorkers } from "@/app/actions/workers"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function DocumentsPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const [documents, workers, documentTypes] = await Promise.all([getDocuments(), getWorkers(), getDocumentTypes()])

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <DocumentsContent initialDocuments={documents} workers={workers} documentTypes={documentTypes} />
    </DashboardLayout>
  )
}
