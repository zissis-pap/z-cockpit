import { useState, useCallback } from 'react'

export function useResizable(initialHeight: number, min = 80, max = 4000) {
  const [height, setHeight] = useState(initialHeight)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height

    function onMove(ev: MouseEvent) {
      // dragging up → larger panel (startY - ev.clientY is positive when moving up)
      const next = Math.min(max, Math.max(min, startH + startY - ev.clientY))
      setHeight(next)
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [height, min, max])

  return { height, onMouseDown }
}
