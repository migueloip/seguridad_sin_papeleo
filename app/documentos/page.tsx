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
    <DashboardLayout user={session as any}>
      <DocumentsContent initialDocuments={documents as any} workers={workers as any} documentTypes={documentTypes as any} />
    </DashboardLayout>
  )
}
