import { writable } from 'svelte/store'

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  duration?: number
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([])

  return {
    subscribe,
    show(message: string, type: Toast['type'] = 'info', duration = 3000) {
      const id = `${Date.now()}-${Math.random()}`
      const toast: Toast = { id, message, type, duration }

      update((toasts) => [...toasts, toast])

      if (duration > 0) {
        setTimeout(() => {
          this.dismiss(id)
        }, duration)
      }

      return id
    },
    success(message: string, duration?: number) {
      return this.show(message, 'success', duration)
    },
    error(message: string, duration?: number) {
      return this.show(message, 'error', duration)
    },
    info(message: string, duration?: number) {
      return this.show(message, 'info', duration)
    },
    warning(message: string, duration?: number) {
      return this.show(message, 'warning', duration)
    },
    dismiss(id: string) {
      update((toasts) => toasts.filter((t) => t.id !== id))
    },
    clear() {
      update(() => [])
    },
  }
}

export const toastStore = createToastStore()
