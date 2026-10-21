import { writable } from 'svelte/store'

/**
 * The status of the model the app is preparing — downloading or loading.
 *
 * One store for one indicator: a download and a load are the same wait to the
 * person watching it.
 */
export type ModelStatus = {
  /** True while the model is being fetched or loaded. */
  active: boolean
  message: string
  /** 0–100, undefined when the step does not report progress. */
  percent: number | undefined
}

const initial: ModelStatus = { active: false, message: '', percent: undefined }

export const modelStatus = writable<ModelStatus>(initial)

export function startModelStatus(message: string, percent?: number) {
  modelStatus.set({ active: true, message, percent })
}

/** Report progress on a model that is being fetched or loaded. */
export function updateModelStatus(message: string, percent?: number) {
  modelStatus.set({ active: true, message, percent })
}

/** The model is usable: show it briefly, then get out of the way. */
export function finishModelStatus() {
  modelStatus.set({ active: false, message: 'Model ready', percent: 100 })
  setTimeout(() => modelStatus.set(initial), 2000)
}

export function clearModelStatus() {
  modelStatus.set(initial)
}
