import { useEffect } from 'react'
import { useLatest } from './useLatest'

export function useInterval(
  active: boolean,
  everyMs: number,
  tick: () => void,
  options: { immediate?: boolean } = {}
): void {
  const latest = useLatest(tick)
  const immediate = options.immediate === true
  useEffect(() => {
    if (!active) return
    if (immediate) latest.current()
    const timer = window.setInterval(() => latest.current(), everyMs)
    return () => window.clearInterval(timer)
  }, [active, everyMs, immediate, latest])
}
