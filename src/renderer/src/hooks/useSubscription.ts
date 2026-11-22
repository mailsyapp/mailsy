import { useEffect } from 'react'
import { useLatest } from './useLatest'

export function useSubscription(active: boolean, subscribe: () => () => void): void {
  const latest = useLatest(subscribe)
  useEffect(() => {
    if (!active) return
    return latest.current()
  }, [active, latest])
}
