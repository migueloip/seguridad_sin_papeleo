"use client"
import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import {
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Edit2,
  Save,
  FileText,
  ImageIcon,
  AlertTriangle,
  ClipboardCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { createDocument, findOrCreateWorkerByRut, findDocumentTypeByName } from "@/app/actions/documents"
import { getWorkers, getWorkerById } from "@/app/actions/workers"
import { getOcrMethod } from "@/app/actions/ocr"
import { extractDocumentData, classifyUpload } from "@/app/actions/document-processing"
import { scanFindingImage } from "@/app/actions/findings"
import { extractChecklistFromImage } from "@/app/actions/checklists"
import { createFinding } from "@/app/actions/findings"
import { createChecklistTemplate } from "@/app/actions/checklists"
import { documentTypes } from "@/app/data/document-types"
import { normalizeRut, isValidRut, normalizeDate } from "@/lib/utils"

interface ExtractedData {
  rut: string | null
  nombre: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  tipoDocumento: string | null
  empresa: string | null
  cargo: string | null
}

interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  status: "uploading" | "processing" | "completed" | "error" | "saving" | "saved"
  progress: number
  extractedData?: ExtractedData
  editedData?: ExtractedData
  isEditing?: boolean
  file?: File
  error?: string
  selectedWorkerId?: number
  target?: "document" | "finding" | "checklist"
  dataUrl?: string
  targetData?: {
    finding?: {
      title?: string
      description?: string
      severity?: "low" | "medium" | "high" | "critical"
      location?: string
      responsible_person?: string
      due_date?: string
    }
    checklist?: {
      name?: string
      description?: string
      items?: { items: Array<{ id?: string; text: string; checked?: boolean; hasIssue?: boolean; note?: string }> }
    }
  }
}

function extractDataFromText(text: string): ExtractedData {
  // Buscar RUT chileno (formato XX.XXX.XXX-X o XXXXXXXX-X)
  const rutMatch = text.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b/i)

  // Buscar fechas (formato DD/MM/YYYY o DD-MM-YYYY)
  const dateMatches: string[] = text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g) ?? []

  // Buscar nombres (secuencia de palabras con mayusculas)
  const nameMatch = text.match(
    /(?:nombre|titular|señor|señora|don|doña)[\s:]*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,4})/i,
  )

  // Detectar tipo de documento
  let tipoDocumento = null
  const lowerText = text.toLowerCase()
  if (lowerText.includes("licencia") && lowerText.includes("conducir")) {
    tipoDocumento = "Licencia de Conducir"
  } else if (lowerText.includes("certificado")) {
    tipoDocumento = "Certificado"
  } else if (lowerText.includes("carnet") || lowerText.includes("carné")) {
    tipoDocumento = "Carnet"
  } else if (lowerText.includes("curso")) {
    tipoDocumento = "Curso"
  } else if (lowerText.includes("cedula") || lowerText.includes("cédula") || lowerText.includes("identidad")) {
    tipoDocumento = "Cedula de Identidad"
  }

  // Buscar empresa
  const empresaMatch = text.match(/(?:empresa|institucion|emitido por|otorgado por)[\s:]*([A-ZÁÉÍÓÚÑ][^\n,]{3,50})/i)

  return {
    rut: rutMatch ? rutMatch[1].toUpperCase() : null,
    nombre: nameMatch ? nameMatch[1].trim() : null,
    fechaEmision: dateMatches.length > 0 ? dateMatches[0] : null,
    fechaVencimiento: dateMatches.length > 1 ? dateMatches[dateMatches.length - 1] : null,
    tipoDocumento,
    empresa: empresaMatch ? empresaMatch[1].trim() : null,
    cargo: null,
  }
}

export function UploadContent({ projectId }: { projectId?: number }) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [ocrMethod, setOcrMethod] = useState<string>("tesseract")
  const [workers, setWorkers] = useState<Array<{ id: number; first_name: string; last_name: string; rut: string | null }>>([])
  
  // Load default OCR method from server settings
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const method = await getOcrMethod()
        if (active && method) setOcrMethod(method)
      } catch {}
      try {
        const list = await getWorkers(projectId)
        if (active && Array.isArray(list)) {
          const casted = list as Array<{ id: number; first_name: string; last_name: string; rut: string | null }>
          setWorkers(
            casted.map((w) => ({ id: Number(w.id), first_name: String(w.first_name), last_name: String(w.last_name), rut: w.rut })),
          )
        }
      } catch {}
    })()
    return () => {
      active = false
    }
  }, [projectId])

  const processWithTesseract = useCallback(async (file: File, id: string) => {
    try {
      // Convert file to base64 data URL which Tesseract handles better
      const base64DataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // For PDFs, show error - Tesseract only works with images
      if (file.type === "application/pdf") {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id
              ? {
                  ...f,
                  status: "error",
                  error: "Tesseract solo soporta imágenes. Use el método IA para PDFs.",
                }
              : f,
          ),
        )
        return
      }

      // Create an image element and wait for it to load to ensure valid image data
      const img = new Image()
      img.crossOrigin = "anonymous"

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("Error loading image"))
        img.src = base64DataUrl
      })

      // Create a canvas to get clean image data
      const canvas = document.createElement("canvas")
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Could not get canvas context")
      ctx.drawImage(img, 0, 0)

      // Get blob from canvas
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error("Could not create blob"))
        }, "image/png")
      })

      // Dynamic import Tesseract to avoid SSR issues
      const Tesseract = await import("tesseract.js")

      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, progress: 10 } : f)))

      // Use recognize directly with the blob
      const result = await Tesseract.recognize(blob, "spa", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, progress: Math.round(10 + (m.progress || 0) * 90) } : f)),
            )
          }
        },
      })

      const extractedData = extractDataFromText(result.data.text)
      const nRut = extractedData.rut ? normalizeRut(extractedData.rut) : null
      const found = nRut ? workers.find((w) => (w.rut ? normalizeRut(w.rut) : "") === nRut) : undefined

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                status: "completed",
                progress: 100,
                extractedData,
                editedData: { ...extractedData },
                selectedWorkerId: found?.id ?? f.selectedWorkerId,
                target: "document",
                dataUrl: base64DataUrl,
              }
            : f,
        ),
      )
    } catch (error) {
      console.error("Tesseract error:", error)
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                status: "error",
                error: "Error al procesar el documento con OCR. Intente con el método IA.",
              }
            : f,
        ),
      )
    }
  }, [])

  const processFile = useCallback(
    async (file: File, id: string) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 0 } : f)))

      if (ocrMethod === "tesseract") {
        await processWithTesseract(file, id)
      } else {
        const reader = new FileReader()
        reader.onload = async (e) => {
          let base64 = (e.target?.result as string).split(",")[1]
          let mime = file.type
          let dataUrl = e.target?.result as string

          // If PDF, render first page to PNG for Vision models
          if (file.type === "application/pdf") {
            try {
              const pdfjs = (await import("pdfjs-dist")) as typeof import("pdfjs-dist")
              try { pdfjs.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@4/build/pdf.worker.min.mjs" } catch {}
              // pdfjs.getDocument expects an ArrayBuffer
              const buf = await file.arrayBuffer()
              const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) })
              const pdf = await loadingTask.promise
              const page = await pdf.getPage(1)
              const viewport = page.getViewport({ scale: 1.5 })
              const canvas = document.createElement("canvas")
              const ctx = canvas.getContext("2d")!
              canvas.width = viewport.width
              canvas.height = viewport.height
              await page.render({ canvasContext: ctx, viewport }).promise
              base64 = canvas.toDataURL("image/png").split(",")[1]
              mime = "image/png"
              dataUrl = `data:${mime};base64,${base64}`
            } catch {
              setFiles((prev) =>
                prev.map((f) =>
                  f.id === id
                    ? {
                        ...f,
                        status: "error",
                        error: "No se pudo procesar el PDF para IA. Intente con una imagen.",
                      }
                    : f,
                ),
              )
              return
            }
          }

          try {
            const classification = await classifyUpload(base64, mime)
            const target = (classification.target || "document") as "document" | "finding" | "checklist"
            let autoWorkerId: number | undefined = undefined
            if (classification?.rut) {
              const n = normalizeRut(classification.rut as string)
              const found = workers.find((w) => (w.rut ? normalizeRut(w.rut) : "") === n)
              if (found) autoWorkerId = found.id
            }
            const extractedData = await extractDocumentData(base64, mime)
            let targetData: UploadedFile["targetData"] = undefined
            if (target === "finding") {
              try {
                const fd = await scanFindingImage(base64, mime)
                targetData = { finding: fd }
              } catch {}
            } else if (target === "checklist") {
              try {
                const cd = await extractChecklistFromImage(base64, mime)
                targetData = { checklist: cd }
              } catch {}
            }
            const mergedEdited: ExtractedData = {
              rut: extractedData.rut || classification.rut || null,
              nombre: extractedData.nombre,
              fechaEmision: extractedData.fechaEmision,
              fechaVencimiento: extractedData.fechaVencimiento,
              tipoDocumento: extractedData.tipoDocumento || classification.documentType || null,
              empresa: extractedData.empresa,
              cargo: extractedData.cargo,
            }
            setFiles((prev) =>
              prev.map((f) =>
                f.id === id
                  ? {
                      ...f,
                      status: "completed",
                      progress: 100,
                      extractedData,
                      editedData: { ...mergedEdited },
                      target,
                      selectedWorkerId: autoWorkerId ?? f.selectedWorkerId,
                      dataUrl,
                      targetData,
                    }
                  : f,
              ),
            )
          } catch (err) {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === id
                  ? {
                      ...f,
                      status: "error",
                      error: `Error con IA: ${
                        err instanceof Error ? err.message : "verifique su configuración de IA"
                      }. Configure la API de IA en Configuración o vuelva a intentar con una imagen compatible.`,
                    }
                  : f,
              ),
            )
          }
        }
        reader.readAsDataURL(file)
      }
    },
    [ocrMethod, processWithTesseract, workers],
  )

  const handleUpload = useCallback(
    async (file: File) => {
      const id = Math.random().toString(36).substr(2, 9)
      const newFile: UploadedFile = {
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "uploading",
        progress: 0,
        file,
      }

      setFiles((prev) => [...prev, newFile])

      let progress = 0
      const uploadInterval = setInterval(() => {
        progress += 25
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, progress: Math.min(progress, 100) } : f)))

        if (progress >= 100) {
          clearInterval(uploadInterval)
          processFile(file, id)
        }
      }, 150)
    },
    [processFile],
  )

  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      acceptedFiles.forEach((file) => handleUpload(file))
    },
    [handleUpload],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg"],
      "application/pdf": [".pdf"],
    },
  })

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const toggleEdit = (id: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, isEditing: !f.isEditing } : f)))
  }

  const updateEditedData = (id: string, field: keyof ExtractedData, value: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id && f.editedData ? { ...f, editedData: { ...f.editedData, [field]: value || null } } : f,
      ),
    )
  }

  const updateSelectedWorker = (id: string, workerId: number | null) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, selectedWorkerId: workerId ?? undefined } : f)))
  }

  const updateTarget = (id: string, target: "document" | "finding" | "checklist") => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, target } : f)))
  }

  const saveDocument = async (fileData: UploadedFile) => {
    const data = fileData.editedData || fileData.extractedData
    if (!fileData.selectedWorkerId && (!data?.rut || !data?.nombre)) {
      alert("Seleccione un trabajador o proporcione RUT y nombre")
      return
    }

    setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saving" } : f)))

    try {
      let documentTypeId = 1
      if (data?.tipoDocumento) {
        const serverDocType = await findDocumentTypeByName(data.tipoDocumento)
        if (serverDocType?.id) {
          documentTypeId = serverDocType.id
        } else {
          const localDocType = documentTypes.find((dt) => dt.name === data.tipoDocumento)
          if (localDocType) {
            documentTypeId = localDocType.id
          }
        }
      }

      let workerId: number
      if (fileData.selectedWorkerId) {
        const existing = await getWorkerById(fileData.selectedWorkerId)
        workerId = Number(existing?.id as number)
      } else {
        const rut = normalizeRut((data!.rut as string))
        if (!isValidRut(rut)) {
          alert("RUT inválido")
          setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "completed" } : f)))
          return
        }
        const nameParts = (String(data!.nombre || "")).trim().split(/\s+/)
        const firstName = nameParts[0] || ""
        const lastName = nameParts.slice(1).join(" ") || ""
        const worker = await findOrCreateWorkerByRut({
          rut,
          first_name: firstName,
          last_name: lastName || firstName,
          company: (data!.empresa as string) || undefined,
          role: (data!.cargo as string) || undefined,
          project_id: projectId,
        })
        workerId = Number(worker.id as number)
      }

      let fileUrl: string | undefined
      if (fileData.file) {
        fileUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(fileData.file!)
        })
      }

      await createDocument({
        worker_id: workerId,
        document_type_id: documentTypeId,
        file_name: fileData.name,
        file_url: fileUrl,
        issue_date: normalizeDate(((data?.fechaEmision as string) || null) as string | null),
        expiry_date: normalizeDate(((data?.fechaVencimiento as string) || null) as string | null),
        extracted_data: ((data || {}) as unknown as Record<string, unknown>),
      })

      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saved" } : f)))
    } catch (error) {
      console.error("Error saving document:", error)
      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "completed" } : f)))
      alert("Error al guardar el documento")
    }
  }

  const saveFinding = async (fileData: UploadedFile) => {
    setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saving" } : f)))
    try {
      const ai = fileData.targetData?.finding
      const title = (ai?.title && String(ai.title)) || fileData.name.replace(/\.[^/.]+$/, "")
      const description =
        (ai?.description && String(ai.description)) ||
        ((fileData.editedData?.tipoDocumento ? String(fileData.editedData?.tipoDocumento) + " - " : "") +
          (fileData.editedData?.nombre ? String(fileData.editedData?.nombre) : ""))
      const photos = fileData.dataUrl ? [fileData.dataUrl] : undefined
      await createFinding({
        project_id: projectId,
        title,
        description: description || undefined,
        severity: (ai?.severity as any) || "medium",
        location: ai?.location || undefined,
        responsible_person: ai?.responsible_person || undefined,
        due_date: ai?.due_date || undefined,
        photos,
      })
      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saved" } : f)))
    } catch (error) {
      console.error("Error creating finding:", error)
      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "completed" } : f)))
      alert("Error al crear el hallazgo")
    }
  }

  const saveChecklist = async (fileData: UploadedFile) => {
    setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saving" } : f)))
    try {
      const ai = fileData.targetData?.checklist
      const name = (ai?.name && String(ai.name)) || fileData.name.replace(/\.[^/.]+$/, "")
      const description =
        (ai?.description && String(ai.description)) ||
        (fileData.editedData?.empresa ? String(fileData.editedData?.empresa) : "") ||
        (fileData.editedData?.tipoDocumento ? String(fileData.editedData?.tipoDocumento) : "")
      const items = ai?.items || {
        items: [
          { id: "auto-1", text: "Revisar EPP", checked: false, hasIssue: false },
          { id: "auto-2", text: "Verificar señalización", checked: false, hasIssue: false },
          { id: "auto-3", text: "Registro fotográfico", checked: false, hasIssue: false },
        ],
      }
      await createChecklistTemplate({
        name,
        description: description || undefined,
        items,
      })
      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saved" } : f)))
    } catch (error) {
      console.error("Error creating checklist:", error)
      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "completed" } : f)))
      alert("Error al crear el checklist")
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B"
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
    return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Subir Documentos</h1>
          <p className="text-muted-foreground">Sube documentos PDF o imagenes para procesamiento automatico con OCR</p>
        </div>
        <Select value={ocrMethod} onValueChange={setOcrMethod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Método OCR" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tesseract">Tesseract (Local)</SelectItem>
            <SelectItem value="ai">IA con Vision</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Upload Zone */}
      <Card>
        <CardContent className="p-6">
          <div
            {...getRootProps()}
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors cursor-pointer ${
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">
              {isDragActive ? "Suelta los archivos aqui" : "Arrastra y suelta archivos aqui"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">o haz clic para seleccionar</p>
            <div className="mt-4 flex gap-2">
              <span className="rounded bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600">PDF</span>
              <span className="rounded bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600">JPG</span>
              <span className="rounded bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600">PNG</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File List */}
      {files.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {files.map((file) => (
                <div key={file.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        {file.type.includes("image") ? (
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {file.status === "uploading" && (
                        <span className="rounded bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                          Subiendo...
                        </span>
                      )}
                      {file.status === "processing" && (
                        <span className="flex items-center gap-1 rounded bg-yellow-500/10 px-2.5 py-0.5 text-xs font-medium text-yellow-600">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          OCR {file.progress > 0 && `(${file.progress}%)`}
                        </span>
                      )}
                      {file.status === "completed" && (
                        <span className="flex items-center gap-1 rounded bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Completado
                        </span>
                      )}
                      {file.status === "saving" && (
                        <span className="flex items-center gap-1 rounded bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Guardando...
                        </span>
                      )}
                      {file.status === "saved" && (
                        <span className="flex items-center gap-1 rounded bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Guardado
                        </span>
                      )}
                      {file.status !== "saved" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeFile(file.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {(file.status === "uploading" || file.status === "processing") && (
                    <div className="mt-3">
                      <Progress value={file.progress} className="h-2" />
                    </div>
                  )}

                  {(file.status === "completed" || file.status === "saving") && file.editedData && (
                    <div className="mt-4 rounded-lg bg-muted/50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-medium">Datos Extraidos</p>
                        <Button variant="ghost" size="sm" onClick={() => toggleEdit(file.id)}>
                          <Edit2 className="mr-1 h-3 w-3" />
                          {file.isEditing ? "Cerrar" : "Editar"}
                        </Button>
                      </div>

                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <div className="sm:col-span-1">
                          <Label className="text-xs">Destino</Label>
                          <Select
                            value={file.target || "document"}
                            onValueChange={(value) =>
                              updateTarget(file.id, value as "document" | "finding" | "checklist")
                            }
                          >
                            <SelectTrigger className="mt-1 h-8">
                              <SelectValue placeholder="Seleccionar destino" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="document">
                                <span className="inline-flex items-center gap-2">
                                  <FileText className="h-3 w-3" />
                                  Documentos
                                </span>
                              </SelectItem>
                              <SelectItem value="finding">
                                <span className="inline-flex items-center gap-2">
                                  <AlertTriangle className="h-3 w-3" />
                                  Hallazgos
                                </span>
                              </SelectItem>
                              <SelectItem value="checklist">
                                <span className="inline-flex items-center gap-2">
                                  <ClipboardCheck className="h-3 w-3" />
                                  Checklists
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {file.isEditing ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs">Tipo de Documento</Label>
                            <Select
                              value={file.editedData.tipoDocumento || ""}
                              onValueChange={(value) => updateEditedData(file.id, "tipoDocumento", value)}
                            >
                              <SelectTrigger className="mt-1 h-8">
                                <SelectValue placeholder="Seleccionar tipo" />
                              </SelectTrigger>
                              <SelectContent>
                                {documentTypes.map((dt) => (
                                  <SelectItem key={dt.id} value={dt.name}>
                                    {dt.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">RUT</Label>
                            <Input
                              value={file.editedData.rut || ""}
                              onChange={(e) => updateEditedData(file.id, "rut", e.target.value)}
                              className="mt-1 h-8"
                              placeholder="12.345.678-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Nombre</Label>
                            <Input
                              value={file.editedData.nombre || ""}
                              onChange={(e) => updateEditedData(file.id, "nombre", e.target.value)}
                              className="mt-1 h-8"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Trabajador</Label>
                            <Select
                              value={file.selectedWorkerId ? String(file.selectedWorkerId) : ""}
                              onValueChange={(value) => updateSelectedWorker(file.id, value ? Number(value) : null)}
                            >
                              <SelectTrigger className="mt-1 h-8">
                                <SelectValue placeholder="Seleccionar trabajador (opcional)" />
                              </SelectTrigger>
                              <SelectContent>
                                {workers.map((w) => (
                                  <SelectItem key={w.id} value={String(w.id)}>
                                    {w.first_name} {w.last_name} {w.rut ? `(${w.rut})` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Fecha Vencimiento</Label>
                            <Input
                              value={file.editedData.fechaVencimiento || ""}
                              onChange={(e) => updateEditedData(file.id, "fechaVencimiento", e.target.value)}
                              className="mt-1 h-8"
                              placeholder="DD/MM/YYYY"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Empresa</Label>
                            <Input
                              value={file.editedData.empresa || ""}
                              onChange={(e) => updateEditedData(file.id, "empresa", e.target.value)}
                              className="mt-1 h-8"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Cargo</Label>
                            <Input
                              value={file.editedData.cargo || ""}
                              onChange={(e) => updateEditedData(file.id, "cargo", e.target.value)}
                              className="mt-1 h-8"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <p className="text-xs text-muted-foreground">Tipo de Documento</p>
                            <p className="font-medium">{file.editedData.tipoDocumento || "-"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">RUT</p>
                            <p className="font-medium">{file.editedData.rut || "-"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Nombre</p>
                            <p className="font-medium">{file.editedData.nombre || "-"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Fecha Vencimiento</p>
                            <p className="font-medium">{file.editedData.fechaVencimiento || "-"}</p>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex gap-2">
                        {(!file.target || file.target === "document") && (
                          <Button size="sm" onClick={() => saveDocument(file)} disabled={file.status === "saving"}>
                            <Save className="mr-1 h-3 w-3" />
                            {file.status === "saving" ? "Guardando..." : "Guardar Documento"}
                          </Button>
                        )}
                        {file.target === "finding" && (
                          <Button size="sm" onClick={() => saveFinding(file)} disabled={file.status === "saving"}>
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {file.status === "saving" ? "Creando..." : "Crear Hallazgo"}
                          </Button>
                        )}
                        {file.target === "checklist" && (
                          <Button size="sm" onClick={() => saveChecklist(file)} disabled={file.status === "saving"}>
                            <ClipboardCheck className="mr-1 h-3 w-3" />
                            {file.status === "saving" ? "Creando..." : "Crear Checklist"}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {file.status === "saved" && (
                    <div className="mt-4 rounded-lg bg-green-500/10 p-4">
                      <p className="flex items-center gap-2 font-medium text-green-600">
                        <CheckCircle className="h-4 w-4" />
                        Documento guardado exitosamente
                      </p>
                    </div>
                  )}

                  {file.status === "error" && (
                    <div className="mt-4 rounded-lg bg-destructive/10 p-4">
                      <p className="flex items-center gap-2 font-medium text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        {file.error}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
