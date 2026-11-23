import { useEffect } from 'react'
import { useLatest } from './useLatest'

export function useSettledValue<T>(value: T, quietMs: number, onSettled: (value: T) => void): void {
  const latest = useLatest(onSettled)
  useEffect(() => {
    const timer = window.setTimeout(() => latest.current(value), quietMs)
    return () => window.clearTimeout(timer)
  }, [value, quietMs, latest])
}
