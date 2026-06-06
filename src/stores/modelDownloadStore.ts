import { writable } from 'svelte/store'

export interface ModelDownloadState {
  active: boolean
  message: string
  percent: number | null // null = indeterminate
}

const initial: ModelDownloadState = { active: false, message: '', percent: null }

export const modelDownloadStore = writable<ModelDownloadState>(initial)

/** Parse progress messages from TTS clients and update the store */
export function handleModelProgress(msg: string): void {
  const match = msg.match(/(\d+)%/)
  const percent = match ? parseInt(match[1], 10) : null
  modelDownloadStore.set({ active: true, message: msg, percent })
}

export function clearModelProgress(): void {
  modelDownloadStore.set(initial)
}
