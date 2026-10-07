import { describe, expect, it } from "vitest"
import { chatErrorMessage } from "./ai-chat-errors"

describe("chatErrorMessage", () => {
  it("sesión vencida (401 'No autenticado')", () => {
    expect(chatErrorMessage(new Error("No autenticado"))).toMatch(/sesión venció/)
  })

  it("muestra el texto corto en español que manda el servidor", () => {
    const msg = "Configura la IA (proveedor y API key) en Configuración para usar el asistente."
    expect(chatErrorMessage(new Error(msg))).toBe(msg)
    expect(chatErrorMessage(new Error("Solicitud inválida"))).toBe("Solicitud inválida")
  })

  it("errores del SDK en inglés, HTML o vacíos → mensaje genérico sin nombrar un proveedor", () => {
    for (const e of [new Error("An error occurred."), new Error("<html><body>502 Bad Gateway</body></html>"), new Error(""), null]) {
      const m = chatErrorMessage(e)
      expect(m).toMatch(/No pude conectar con la IA/)
      expect(m).not.toMatch(/Google/)
    }
  })
})
