"use client"
import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import { Upload, CheckCircle, AlertCircle, Loader2, X, Edit2, Save, FileText, ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { createDocument, findOrCreateWorkerByRut, findDocumentTypeByName } from "@/app/actions/documents"
import { getOcrMethod } from "@/app/actions/ocr"
import { extractDocumentData } from "@/app/actions/document-processing"
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

export function UploadContent() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [ocrMethod, setOcrMethod] = useState<string>("tesseract")
  
  // Load default OCR method from server settings
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const method = await getOcrMethod()
        if (active && method) setOcrMethod(method)
      } catch {}
    })()
    return () => {
      active = false
    }
  }, [])

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

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                status: "completed",
                progress: 100,
                extractedData,
                editedData: { ...extractedData },
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
          const base64 = (e.target?.result as string).split(",")[1]

          try {
            const extractedData = await extractDocumentData(base64, file.type)
            setFiles((prev) =>
              prev.map((f) =>
                f.id === id
                  ? {
                      ...f,
                      status: "completed",
                      progress: 100,
                      extractedData,
                      editedData: { ...extractedData },
                    }
                  : f,
              ),
            )
          } catch {
            await processWithTesseract(file, id)
          }
        }
        reader.readAsDataURL(file)
      }
    },
    [ocrMethod, processWithTesseract],
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

  const saveDocument = async (fileData: UploadedFile) => {
    const data = fileData.editedData || fileData.extractedData
    if (!data?.rut || !data?.nombre) {
      alert("Se requiere RUT y nombre para guardar el documento")
      return
    }

    setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saving" } : f)))

    try {
      let documentTypeId = 1
      if (data.tipoDocumento) {
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

      const rut = normalizeRut(data.rut!)
      if (!isValidRut(rut)) {
        alert("RUT inválido")
        setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "completed" } : f)))
        return
      }

      const nameParts = (data.nombre || "").trim().split(/\s+/)
      const firstName = nameParts[0] || ""
      const lastName = nameParts.slice(1).join(" ") || ""
      const worker = await findOrCreateWorkerByRut({
        rut,
        first_name: firstName,
        last_name: lastName || firstName,
        company: data.empresa || undefined,
        role: data.cargo || undefined,
      })

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
        worker_id: worker.id,
        document_type_id: documentTypeId,
        file_name: fileData.name,
        file_url: fileUrl,
        issue_date: normalizeDate(data.fechaEmision),
        expiry_date: normalizeDate(data.fechaVencimiento),
        extracted_data: (data as unknown as Record<string, unknown>),
      })

      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "saved" } : f)))
    } catch (error) {
      console.error("Error saving document:", error)
      setFiles((prev) => prev.map((f) => (f.id === fileData.id ? { ...f, status: "completed" } : f)))
      alert("Error al guardar el documento")
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
                        <Button size="sm" onClick={() => saveDocument(file)} disabled={file.status === "saving"}>
                          <Save className="mr-1 h-3 w-3" />
                          {file.status === "saving" ? "Guardando..." : "Guardar Documento"}
                        </Button>
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
