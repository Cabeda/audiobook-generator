import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'
import { toastStore } from './toastStore'

describe('toastStore', () => {
  beforeEach(() => {
    // Clear toasts - accessing the underlying store via subscribe
    // Since we can't easily clear it via the exported object, we'll just dismiss all
    const toasts = get(toastStore)
    toasts.forEach((t) => toastStore.dismiss(t.id))
  })

  it('should add success toast', () => {
    toastStore.success('Success message')
    const toasts = get(toastStore)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Success message')
    expect(toasts[0].type).toBe('success')
  })

  it('should add error toast', () => {
    toastStore.error('Error message')
    const toasts = get(toastStore)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
  })

  it('should dismiss toast', () => {
    toastStore.info('Info message')
    let toasts = get(toastStore)
    const id = toasts[0].id

    toastStore.dismiss(id)
    toasts = get(toastStore)
    expect(toasts).toHaveLength(0)
  })

  it('should auto-dismiss after duration', () => {
    vi.useFakeTimers()
    toastStore.warning('Warning', 1000)

    expect(get(toastStore)).toHaveLength(1)

    vi.advanceTimersByTime(1000)

    expect(get(toastStore)).toHaveLength(0)
    vi.useRealTimers()
  })
})
