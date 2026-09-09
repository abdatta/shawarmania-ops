import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useOverviewRead } from './use-overview-read'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.restoreAllMocks())

it('rejects an old outlet response after the reader changes', async () => {
  const old = deferred<number>()
  const next = deferred<number>()
  const { result, rerender } = renderHook(({ read }) => useOverviewRead(read), {
    initialProps: { read: () => old.promise },
  })
  rerender({ read: () => next.promise })
  await act(async () => next.resolve(200))
  expect(result.current.value).toBe(200)
  await act(async () => old.resolve(100))
  expect(result.current.value).toBe(200)
})

it('keeps a successful amount while refreshing and ignores the superseded attempt', async () => {
  const first = deferred<number>()
  const second = deferred<number>()
  const latest = deferred<number>()
  const read = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(latest.promise)
  const { result } = renderHook(() => useOverviewRead<number>(read))
  await act(async () => first.resolve(100))
  await act(async () => result.current.retry())
  expect(result.current.value).toBe(100)
  await act(async () => result.current.retry())
  await act(async () => latest.resolve(300))
  await act(async () => second.resolve(200))
  expect(result.current.value).toBe(300)
})

it('refreshes on foreground, ignores hidden events and removes its listener on unmount', async () => {
  const read = vi.fn(async () => 123)
  const { result, unmount } = renderHook(() => useOverviewRead(read))
  await act(async () => {})
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(read).toHaveBeenCalledTimes(1)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(read).toHaveBeenCalledTimes(2)
  expect(result.current.value).toBe(123)
  unmount()
  document.dispatchEvent(new Event('visibilitychange'))
  expect(read).toHaveBeenCalledTimes(2)
})
