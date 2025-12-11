import { DashboardLayout } from "@/components/dashboard-layout"
import { DocumentsContent } from "@/components/documents-content"
import { getDocuments, getDocumentTypes } from "@/app/actions/documents"
import { getWorkers } from "@/app/actions/workers"

export default async function DocumentsPage() {
  const [documents, workers, documentTypes] = await Promise.all([getDocuments(), getWorkers(), getDocumentTypes()])

  return (
    <DashboardLayout>
      <DocumentsContent initialDocuments={documents} workers={workers} documentTypes={documentTypes} />
    </DashboardLayout>
  )
}
