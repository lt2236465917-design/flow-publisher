import { useEffect, useCallback } from 'react'

interface ShortcutMap {
  [key: string]: () => void
}

/**
 * Register global keyboard shortcuts.
 * Keys are in the format "ctrl+v", "ctrl+shift+s", etc.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('ctrl')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')

      const key = e.key.toLowerCase()
      // Avoid duplicating modifier keys
      if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
        parts.push(key)
      }

      const combo = parts.join('+')
      const handler = shortcuts[combo]
      if (handler) {
        e.preventDefault()
        handler()
      }
    },
    [shortcuts]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
