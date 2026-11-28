import { useSyncExternalStore } from 'react'
import { leftSends, type LeftSend } from '../lib/pendingSend'

export function useLeftSends(): readonly LeftSend[] {
  return useSyncExternalStore(leftSends.subscribe, leftSends.snapshot)
}

export function scheduleOutlivingUnmount(delayMs: number, commit: () => void): () => void {
  const timer = window.setTimeout(commit, delayMs)
  return () => window.clearTimeout(timer)
}
