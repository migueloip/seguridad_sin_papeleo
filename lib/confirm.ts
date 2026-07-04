import { toast } from "sonner"

interface ConfirmOptions {
  /** Texto del botón de confirmación. Default "Confirmar" / "Eliminar" si danger. */
  confirmLabel?: string
  /** Si true, usa estilo destructivo en el botón de confirmación. Default true. */
  danger?: boolean
  /** Mensaje del toast. Si no se pasa, se usa el primer argumento como mensaje. */
  description?: string
  /** Duración del toast en ms antes de auto-cerrar. Default 15000 (15s). */
  duration?: number
}

/**
 * Reemplaza `window.confirm()` con un toast no-bloqueante de sonner que tiene
 * botones de acción. Sintaxis:
 *
 *     confirmToast("¿Eliminar plano X?", () => deletePlan(id), { danger: true })
 *
 * Diferencia clave vs confirm() nativo: NO bloquea el hilo. El callback se
 * dispara cuando el usuario hace click en "Eliminar". Si cierra el toast o
 * elige "Cancelar", no pasa nada.
 */
export function confirmToast(
  message: string,
  onConfirm: () => void | Promise<void>,
  options: ConfirmOptions = {},
) {
  const { confirmLabel, danger = true, description, duration = 15000 } = options
  toast(message, {
    description,
    duration,
    action: {
      label: confirmLabel ?? (danger ? "Eliminar" : "Confirmar"),
      onClick: () => {
        void onConfirm()
      },
    },
    cancel: {
      label: "Cancelar",
      onClick: () => {
        /* no-op */
      },
    },
  })
}
