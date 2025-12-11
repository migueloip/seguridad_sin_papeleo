import { DashboardLayout } from "@/components/dashboard-layout"
import { UploadContent } from "@/components/upload-content"
import { getDocumentTypes } from "@/app/actions/documents"

export default async function UploadPage() {
  const documentTypes = await getDocumentTypes()

  return (
    <DashboardLayout>
      <UploadContent documentTypes={documentTypes} />
    </DashboardLayout>
  )
}
