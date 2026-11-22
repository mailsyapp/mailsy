import { useEffect } from 'react'
import { useLatest } from './useLatest'

export function useOnMount(run: (isMounted: () => boolean) => void): void {
  const latest = useLatest(run)
  useEffect(() => {
    let mounted = true
    latest.current(() => mounted)
    return () => {
      mounted = false
    }
  }, [latest])
}
