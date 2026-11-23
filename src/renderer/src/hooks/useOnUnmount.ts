import { useEffect } from 'react'
import { useLatest } from './useLatest'

export function useOnUnmount(run: () => void): void {
  const latest = useLatest(run)
  useEffect(() => () => latest.current(), [latest])
}
