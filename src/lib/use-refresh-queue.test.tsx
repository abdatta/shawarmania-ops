import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useRefreshQueue } from './use-refresh-queue'

it('coalesces a burst into one trailing read and waits for it', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const read = vi
    .fn()
    .mockImplementationOnce(() => held)
    .mockResolvedValue(undefined)
  const hook = renderHook(() => useRefreshQueue(read))
  const first = hook.result.current.refresh()
  await act(async () => {
    await Promise.resolve()
  })
  const follows = Array.from({ length: 20 }, () => hook.result.current.refresh())
  expect(read).toHaveBeenCalledTimes(1)
  await act(async () => {
    release()
    await Promise.all([first, ...follows])
  })
  expect(read).toHaveBeenCalledTimes(2)
  hook.unmount()
})

it('invalidates an old response when its reader is replaced', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const commit = vi.fn()
  const oldRead = async (current: () => boolean) => {
    await held
    if (current()) commit()
  }
  const hook = renderHook(({ read }) => useRefreshQueue(read), { initialProps: { read: oldRead } })
  const flight = hook.result.current.refresh()
  await act(async () => {
    await Promise.resolve()
  })
  hook.rerender({ read: async () => {} })
  await act(async () => {
    release()
    await flight
  })
  expect(commit).not.toHaveBeenCalled()
  hook.unmount()
})
