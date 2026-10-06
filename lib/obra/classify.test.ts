import { describe, expect, it } from "vitest"
import { classifyFindingText, normalizeFindingText } from "./classify"
import type { FindingCategory } from "./types"

describe("normalizeFindingText", () => {
  it("quita tildes, mayúsculas y signos", () => {
    expect(normalizeFindingText("¡Olor a GAS en la Cañería!")).toBe("olor a gas en la caneria")
    expect(normalizeFindingText("Filtración / humedad")).toBe("filtracion humedad")
  })
})

describe("classifyFindingText", () => {
  const cases: Array<[string, FindingCategory]> = [
    // Grietas
    ["Grieta en muro del eje B", "grieta"],
    ["Fisuras en la losa del 2° piso", "grieta"],
    ["Trizadura diagonal en tabique", "grieta"],
    // Humedad / filtración
    ["Humedad en cielo del baño", "humedad_filtracion"],
    ["FILTRACIÓN en muro perimetral", "humedad_filtracion"],
    ["Gotera sobre pasillo", "humedad_filtracion"],
    ["Mancha de agua en el cielo", "humedad_filtracion"],
    ["Fuga de agua en shaft", "humedad_filtracion"],
    // Hundimiento
    ["Hundimiento del radier en estacionamiento", "hundimiento"],
    ["Asentamiento en vereda", "hundimiento"],
    ["Socavón junto a la cámara", "hundimiento"],
    // Olor a gas o alcantarilla
    ["Olor a gas en sala de calderas", "olor_gas"],
    ["Mal olor en el baño", "olor_gas"],
    ["Medidor de gas golpeado", "olor_gas"],
    ["Olor a alcantarillado en subterráneo", "olor_gas"],
    // Falla eléctrica
    ["Chispa en enchufe del comedor", "falla_electrica"],
    ["Cortocircuito en faena", "falla_electrica"],
    ["Cable pelado en extensión", "falla_electrica"],
    ["Tablero sin tapa", "falla_electrica"],
    ["Enchufe quemado", "falla_electrica"],
    // Corrosión
    ["Óxido en baranda de escalera", "corrosion"],
    ["Corrosión en cañería de cobre", "corrosion"],
    // Desprendimiento
    ["Desprendimiento de cerámica en fachada", "desprendimiento"],
    ["Caída de material desde el 5° piso", "desprendimiento"],
    ["Estuco suelto en el hall", "desprendimiento"],
    // Obstrucción
    ["Obstrucción en sumidero", "obstruccion"],
    ["Rebalse de cámara", "obstruccion"],
    ["Desagüe tapado", "obstruccion"],
    // Excavación
    ["Excavación sin entibar", "excavacion"],
    ["Zanja abierta sin baranda", "excavacion"],
    // Sin coincidencias
    ["Trabajador sin casco", "otro"],
    ["", "otro"],
  ]

  for (const [text, expected] of cases) {
    it(`«${text}» → ${expected}`, () => {
      expect(classifyFindingText(text)).toBe(expected)
    })
  }

  it("prioriza la coincidencia más específica", () => {
    // "olor a gas" gana a "olor" y "gas" sueltos, aunque aparezca después.
    expect(classifyFindingText("Mal olor; se sospecha olor a gas")).toBe("olor_gas")
    // "rebalse" gana a "alcantarillado".
    expect(classifyFindingText("Alcantarillado con rebalse en patio")).toBe("obstruccion")
    // "gotera" gana a "tablero".
    expect(classifyFindingText("Tablero eléctrico con gotera encima")).toBe("humedad_filtracion")
    // "olor a quemado" es eléctrico, no gas.
    expect(classifyFindingText("Olor a quemado en tablero")).toBe("falla_electrica")
    // "excavación" gana a "gas".
    expect(classifyFindingText("Excavación junto a red de gas")).toBe("excavacion")
  })

  it("a igual peso gana lo que aparece primero", () => {
    expect(classifyFindingText("Grieta con humedad")).toBe("grieta")
    expect(classifyFindingText("Humedad con grieta")).toBe("humedad_filtracion")
  })

  it("no confunde palabras que solo comparten raíz", () => {
    expect(classifyFindingText("Gastos de faena")).toBe("otro")
    expect(classifyFindingText("Tapa de registro rota")).toBe("otro")
  })

  it("tolera entradas que no son texto", () => {
    expect(classifyFindingText(undefined as unknown as string)).toBe("otro")
    expect(classifyFindingText(42 as unknown as string)).toBe("otro")
  })
})
