import { useEffect, type RefObject } from 'react'
import { useLatest } from './useLatest'

export function useIntersection(options: {
  target: RefObject<Element | null>
  root: RefObject<Element | null>
  rootMargin: string
  armKey: string | null
  onIntersect: () => void
}): void {
  const { target, root, rootMargin, armKey } = options
  const latest = useLatest(options.onIntersect)
  useEffect(() => {
    const targetElement = target.current
    const rootElement = root.current
    if (armKey === null || !targetElement || !rootElement) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current()
      },
      { root: rootElement, rootMargin }
    )
    observer.observe(targetElement)
    return () => observer.disconnect()
  }, [armKey, target, root, rootMargin, latest])
}
