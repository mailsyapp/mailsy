import { useEffect, useRef } from 'react'
import { useLatest } from './useLatest'

function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
}

export function useReaction(triggers: readonly unknown[], react: () => void): void {
  const latest = useLatest(react)
  const seen = useRef<readonly unknown[] | null>(null)
  useEffect(() => {
    const previous = seen.current
    seen.current = triggers
    if (previous && sameValues(previous, triggers)) return
    latest.current()
  })
}
