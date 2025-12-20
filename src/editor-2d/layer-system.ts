import type { Layer, UUID } from "@/src/core"

// Crea una capa nueva con configuración por defecto.
export function createLayer(params: { id: UUID; name: string; type?: Layer["type"] }): Layer {
  return {
    id: params.id,
    name: params.name,
    type: params.type ?? "architectural",
    isLocked: false,
    isVisible: true,
  }
}

// Alterna visibilidad de una capa sin mutar el array original.
export function toggleLayerVisibility(layers: Layer[], layerId: UUID): Layer[] {
  return layers.map((layer) =>
    layer.id === layerId
      ? {
          ...layer,
          isVisible: !layer.isVisible,
        }
      : layer,
  )
}

// Alterna bloqueo de edición de una capa.
export function toggleLayerLock(layers: Layer[], layerId: UUID): Layer[] {
  return layers.map((layer) =>
    layer.id === layerId
      ? {
          ...layer,
          isLocked: !layer.isLocked,
        }
      : layer,
  )
}

// Reordena capas para control de z-index en el render 2D.
export function reorderLayer(layers: Layer[], layerId: UUID, newIndex: number): Layer[] {
  const currentIndex = layers.findIndex((l) => l.id === layerId)
  if (currentIndex === -1) return layers
  const clampedIndex = Math.max(0, Math.min(newIndex, layers.length - 1))
  if (currentIndex === clampedIndex) return layers
  const copy = layers.slice()
  const [layer] = copy.splice(currentIndex, 1)
  copy.splice(clampedIndex, 0, layer)
  return copy
}

