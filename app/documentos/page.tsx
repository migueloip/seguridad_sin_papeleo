import { DashboardLayout } from "@/components/dashboard-layout"
import { DocumentsContent } from "@/components/documents-content"
import { getDocuments, getDocumentTypes } from "@/app/actions/documents"
import { getWorkers } from "@/app/actions/workers"
import { getSession } from "@/lib/auth"

export default async function DocumentsPage() {
  const [documents, workers, documentTypes, session] = await Promise.all([
    getDocuments(),
    getWorkers(),
    getDocumentTypes(),
    getSession(),
  ])

  return (
    <DashboardLayout user={session as any}>
      <DocumentsContent initialDocuments={documents as any} workers={workers as any} documentTypes={documentTypes as any} />
    </DashboardLayout>
  )
}
