import { useState, useRef, useCallback } from 'react'

export type SidebarPanel = 'bookmarks' | 'history' | 'downloads' | 'pipelines' | null

export interface SidebarState {
  expanded: boolean
  activePanel: SidebarPanel
  onMouseEnter: () => void
  onMouseLeave: () => void
  togglePanel: (panel: SidebarPanel) => void
  closePanel: () => void
}

const EXPAND_DELAY = 300
const COLLAPSE_DELAY = 200

export function useSidebarState(): SidebarState {
  const [expanded, setExpanded] = useState(false)
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = () => {
    if (expandTimer.current) { clearTimeout(expandTimer.current); expandTimer.current = null }
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null }
  }

  const onMouseEnter = useCallback(() => {
    clearTimers()
    expandTimer.current = setTimeout(() => setExpanded(true), EXPAND_DELAY)
  }, [])

  const onMouseLeave = useCallback(() => {
    clearTimers()
    collapseTimer.current = setTimeout(() => {
      setExpanded(false)
      setActivePanel(null)
    }, COLLAPSE_DELAY)
  }, [])

  const togglePanel = useCallback((panel: SidebarPanel) => {
    setActivePanel(prev => prev === panel ? null : panel)
    setExpanded(true)
    clearTimers()
  }, [])

  const closePanel = useCallback(() => {
    setActivePanel(null)
  }, [])

  return { expanded, activePanel, onMouseEnter, onMouseLeave, togglePanel, closePanel }
}
