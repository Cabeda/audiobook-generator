import { writable, type Writable } from 'svelte/store'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration: number
}

const toasts: Writable<Toast[]> = writable([])

let nextId = 0

function addToast(message: string, type: Toast['type'], duration = 3000) {
  const id = nextId++
  const toast: Toast = { id, message, type, duration }

  toasts.update((all) => [...all, toast])

  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      removeToast(id)
    }, duration)
  }
}

function removeToast(id: number) {
  toasts.update((all) => all.filter((t) => t.id !== id))
}

export const toastStore = {
  subscribe: toasts.subscribe,
  success: (message: string, duration?: number) => addToast(message, 'success', duration),
  error: (message: string, duration?: number) => addToast(message, 'error', duration),
  warning: (message: string, duration?: number) => addToast(message, 'warning', duration),
  info: (message: string, duration?: number) => addToast(message, 'info', duration),
  dismiss: removeToast,
}
