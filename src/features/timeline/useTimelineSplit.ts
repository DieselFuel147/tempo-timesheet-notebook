import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clampTimelineWidth, readTimelineWidth, writeTimelineWidth } from './timelineWidth'

// Draggable notebook/timeline split: owns the persisted panel width and the
// pointer-drag handler for the divider between the two panels.
export function useTimelineSplit() {
  const [timelineWidth, setTimelineWidth] = useState<number>(() => readTimelineWidth())
  const timelineWidthRef = useRef(timelineWidth)
  useEffect(() => {
    timelineWidthRef.current = timelineWidth
  }, [timelineWidth])

  const handleSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = timelineWidthRef.current

    const onMove = (moveEvent: PointerEvent) => {
      // Handle sits to the left of the timeline panel, so dragging left (a
      // smaller clientX) widens the timeline.
      setTimelineWidth(clampTimelineWidth(startWidth + (startX - moveEvent.clientX)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      writeTimelineWidth(timelineWidthRef.current)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  return { timelineWidth, handleSplitPointerDown }
}
