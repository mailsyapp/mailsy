import { useEffect, useRef } from 'react'

type AutoGrowTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

// The box always fits its full content — no cap — and the surrounding
// section scrolls instead.
function fit(element: HTMLTextAreaElement): void {
  element.style.height = 'auto'
  // style height is border-box (padding + border included) while scrollHeight
  // excludes the border, so add it back or a 1-2px sliver keeps scrolling.
  const border = element.offsetHeight - element.clientHeight
  element.style.height = `${element.scrollHeight + border}px`
  element.style.overflowY = 'hidden'
}

export function AutoGrowTextarea(props: AutoGrowTextareaProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // Refit whenever the value changes (typing, prefill, draft switch) and
  // when the viewport changes (width changes rewrap the text).
  useEffect(() => {
    const element = ref.current
    if (!element) return
    fit(element)
    function onResize(): void {
      if (ref.current) fit(ref.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [props.value])

  return (
    <textarea
      ref={ref}
      {...props}
      style={{ ...props.style, overflowY: 'hidden', resize: 'vertical' }}
      onChange={(event) => {
        fit(event.currentTarget)
        props.onChange?.(event)
      }}
    />
  )
}
