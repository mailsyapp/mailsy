import { useEffect, useMemo, useRef } from 'react'

export interface Timers {
  start: (key: string, delayMs: number, run: () => void) => void
  cancel: (key: string) => void
  cancelAll: () => void
  isPending: (key: string) => boolean
}

export function useTimers(): Timers {
  const pending = useRef(new Map<string, number>())
  const timers = useMemo<Timers>(() => {
    function cancel(key: string): void {
      const timer = pending.current.get(key)
      if (timer === undefined) return
      window.clearTimeout(timer)
      pending.current.delete(key)
    }
    function cancelAll(): void {
      pending.current.forEach((timer) => window.clearTimeout(timer))
      pending.current.clear()
    }
    return {
      start(key, delayMs, run) {
        cancel(key)
        pending.current.set(
          key,
          window.setTimeout(() => {
            pending.current.delete(key)
            run()
          }, delayMs)
        )
      },
      cancel,
      cancelAll,
      isPending: (key) => pending.current.has(key)
    }
  }, [])
  useEffect(() => () => timers.cancelAll(), [timers])
  return timers
}
