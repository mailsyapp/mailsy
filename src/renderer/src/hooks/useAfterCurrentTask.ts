import { useCallback } from 'react'
import { useLatest } from './useLatest'
import { useTimers } from './useTimers'

export function useAfterCurrentTask(run: () => void): () => void {
  const latest = useLatest(run)
  const timers = useTimers()
  return useCallback(() => {
    timers.start('next-task', 0, () => latest.current())
  }, [timers, latest])
}
