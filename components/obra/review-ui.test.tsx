/**
 * UI de las correcciones de la revisión (jsdom, acciones y archivos simulados):
 * - Subida directa de una lámina: «Cancelar subida» corta el PUT (AbortSignal)
 *   sin mostrar el aviso de reducir; la capa se crea con la copia reducida
 *   para la IA; sin subida directa la lámina se prepara reducida al elegirla.
 * - Invitación: si aceptar falla por un estado terminal, se refresca la vista
 *   (el servidor muestra la tarjeta final); si es un error de red, no.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const MB = 1024 * 1024

// act() de React 19 fuera de un framework de pruebas: hay que declararlo.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  ticket: vi.fn(),
  createLayer: vi.fn(),
  upload: vi.fn(),
  forUpload: vi.fn(),
  asDataUrl: vi.fn(),
  accept: vi.fn(),
  acceptNew: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
}))

vi.mock("@/app/actions/obra/layers", () => ({
  createObraLayerUploadTicket: mocks.ticket,
  createObraLayer: mocks.createLayer,
}))
vi.mock("@/app/actions/obra/elements", () => ({
  createObraElements: vi.fn(),
  deleteObraElement: vi.fn(),
  updateObraElement: vi.fn(),
}))
vi.mock("@/app/actions/obra/suggestions", () => ({ approveObraSuggestion: vi.fn() }))
vi.mock("@/app/actions/obra/tasks", () => ({ setObraTaskStatus: vi.fn(), toggleObraTaskChecklist: vi.fn() }))
vi.mock("@/app/actions/obra/invitations", () => ({
  acceptObraInvitation: mocks.accept,
  acceptObraInvitationWithNewAccount: mocks.acceptNew,
}))
vi.mock("@/app/actions/auth", () => ({ logout: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, usePathname: () => "/" }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/obra/client-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/obra/client-files")>()),
  readImageFileForUpload: mocks.forUpload,
  readImageFileAsDataUrl: mocks.asDataUrl,
  uploadToSignedUrl: mocks.upload,
}))

import { PlanUploadError } from "@/lib/obra/client-files"
import { InvitationAccept } from "./invitation-accept"
import { LayerUploadDialog } from "./layer-upload-dialog"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  for (const m of [mocks.ticket, mocks.createLayer, mocks.upload, mocks.forUpload, mocks.asDataUrl, mocks.accept, mocks.acceptNew]) {
    m.mockReset()
  }
  for (const f of Object.values(mocks.router)) f.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // jsdom no implementa object URLs.
  URL.createObjectURL = vi.fn(() => "blob:vista-previa")
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

function buttonByText(text: string | RegExp): HTMLButtonElement | null {
  const all = Array.from(document.body.querySelectorAll("button"))
  return (all.find((b) => (typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? ""))) ??
    null) as HTMLButtonElement | null
}

async function chooseFile(file: File) {
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await flush()
}

async function submitForm() {
  const form = document.body.querySelector("form") as HTMLFormElement
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await flush()
}

const bigBlob = () => new Blob([new Uint8Array(5 * MB)], { type: "image/png" })
const ticketOk = {
  ok: true,
  data: {
    path: "obra/1/uploads/0f8fad5b-d9cb-469f-a165-70867728950e.png",
    upload_url: "https://x.supabase.co/storage/v1/object/upload/sign/obra-planos/obra/1/uploads/a.png?token=t",
    token: "t",
    expires_in: 7200,
    max_bytes: 25 * MB,
    mime: "image/png",
  },
}

function renderDialog(directUpload: boolean) {
  act(() => {
    root.render(
      <LayerUploadDialog open onOpenChange={vi.fn()} projectId={1} directUpload={directUpload} onCreated={vi.fn()} />,
    )
  })
}

describe("LayerUploadDialog", () => {
  it("«Cancelar subida» corta el PUT a Storage sin ofrecer reducir la lámina ni crear la capa", async () => {
    mocks.forUpload.mockResolvedValue({ blob: bigBlob(), width: 4000, height: 3000, mime: "image/png", reencoded: false })
    mocks.ticket.mockResolvedValue(ticketOk)
    let signal: AbortSignal | undefined
    mocks.upload.mockImplementation(
      (_url: string, _blob: Blob, _type: string, opts: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal = opts.signal
          opts.signal?.addEventListener("abort", () => reject(new PlanUploadError("Se canceló la subida de la lámina.", "aborted", 0)))
        }),
    )
    renderDialog(true)
    await chooseFile(new File([new Uint8Array(10)], "plano.png", { type: "image/png" }))
    expect(document.body.textContent).toContain("se subirá directo al almacenamiento de archivos")
    await submitForm()

    const cancel = buttonByText("Cancelar subida")
    expect(cancel).not.toBeNull()
    expect(cancel!.disabled).toBe(false)
    expect(signal?.aborted).toBe(false)
    await act(async () => cancel!.click())
    await flush()

    expect(signal?.aborted).toBe(true)
    expect(buttonByText("Cancelar subida")).toBeNull()
    expect(buttonByText("Cancelar")?.disabled).toBe(false)
    expect(buttonByText(/Reducir la lámina/)).toBeNull()
    expect(mocks.createLayer).not.toHaveBeenCalled()
  })

  it("tras subir directo, crea la capa con la ruta y una copia reducida para la IA", async () => {
    mocks.forUpload.mockResolvedValue({ blob: bigBlob(), width: 4000, height: 3000, mime: "image/png", reencoded: false })
    mocks.ticket.mockResolvedValue(ticketOk)
    mocks.upload.mockResolvedValue(undefined)
    mocks.asDataUrl.mockResolvedValue({ dataUrl: "data:image/jpeg;base64,AAAA", width: 3000, height: 2250, mime: "image/jpeg" })
    mocks.createLayer.mockResolvedValue({ ok: false, error: "Error de prueba." })
    renderDialog(true)
    await chooseFile(new File([new Uint8Array(10)], "plano.png", { type: "image/png" }))
    await submitForm()
    expect(mocks.createLayer).toHaveBeenCalledTimes(1)
    const input = mocks.createLayer.mock.calls[0][1] as { image_upload?: Record<string, unknown>; image?: unknown }
    expect(input.image).toBeUndefined()
    expect(input.image_upload).toEqual({
      path: ticketOk.data.path,
      width_px: 4000,
      height_px: 3000,
      analysis_data_url: "data:image/jpeg;base64,AAAA",
    })
    // La copia se hace del archivo ya preparado (no se vuelve a leer el original).
    expect((mocks.asDataUrl.mock.calls[0][0] as File).type).toBe("image/png")
  })

  it("sin subida directa en el servidor, la lámina se reduce al elegirla y se envía inline en un paso", async () => {
    mocks.asDataUrl.mockResolvedValue({ dataUrl: "data:image/jpeg;base64,AAAA", width: 3000, height: 2000, mime: "image/jpeg" })
    mocks.createLayer.mockResolvedValue({ ok: false, error: "Error de prueba." })
    renderDialog(false)
    await chooseFile(new File([new Uint8Array(10)], "plano.png", { type: "image/png" }))
    expect(mocks.forUpload).not.toHaveBeenCalled()
    expect(mocks.asDataUrl).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain("se subirá directo")
    await submitForm()
    expect(mocks.ticket).not.toHaveBeenCalled()
    const input = mocks.createLayer.mock.calls[0][1] as { image?: { data_url: string } }
    expect(input.image?.data_url).toBe("data:image/jpeg;base64,AAAA")
  })
})

describe("InvitationAccept", () => {
  const preview = {
    status: "pendiente" as const,
    project_name: "Edificio Los Aromos",
    role: "supervisor" as const,
    email: "ana@test.cl",
    name: "Ana",
    inviter_name: "Gerente",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  }

  function renderAccept() {
    act(() => {
      root.render(<InvitationAccept token={"a".repeat(43)} preview={preview} viewer={{ email: "ana@test.cl", name: "Ana" }} />)
    })
  }

  it("si la invitación ya no está pendiente al aceptar, refresca para mostrar su estado final", async () => {
    mocks.accept.mockResolvedValue({ ok: false, error: "Esta invitación fue revocada. Pide a quien te invitó un enlace nuevo." })
    renderAccept()
    await act(async () => buttonByText(/Aceptar y entrar a la obra/)!.click())
    await flush()
    expect(document.body.textContent).toContain("Esta invitación fue revocada")
    expect(mocks.router.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.router.push).not.toHaveBeenCalled()
  })

  it("con un error de red no refresca (la invitación puede seguir pendiente)", async () => {
    mocks.accept.mockRejectedValue(new TypeError("Failed to fetch"))
    renderAccept()
    await act(async () => buttonByText(/Aceptar y entrar a la obra/)!.click())
    await flush()
    expect(document.body.textContent).toContain("No se pudo conectar con el servidor")
    expect(mocks.router.refresh).not.toHaveBeenCalled()
  })
})
