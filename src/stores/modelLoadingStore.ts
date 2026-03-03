import { writable } from 'svelte/store'

export type ModelLoadingState = {
  loading: boolean
  message: string
  /** 0–100, undefined when indeterminate */
  progress: number | undefined
}

const initial: ModelLoadingState = { loading: false, message: '', progress: undefined }

export const modelLoadingStore = writable<ModelLoadingState>(initial)

export function setModelLoading(message: string, progress?: number) {
  modelLoadingStore.set({ loading: true, message, progress })
}

export function setModelReady() {
  modelLoadingStore.set({ loading: false, message: 'Model ready', progress: 100 })
  // Clear after a short delay so the "ready" state briefly shows
  setTimeout(() => modelLoadingStore.set(initial), 2000)
}

export function setModelError() {
  modelLoadingStore.set(initial)
}
