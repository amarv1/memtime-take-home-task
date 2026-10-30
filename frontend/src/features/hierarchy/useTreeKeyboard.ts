import type { KeyboardEvent } from 'react'

const ITEM = '[role="treeitem"]'

/**
 * Keyboard behaviour of the ARIA tree pattern, from one handler on the tree root.
 * The visible items are the treeitems in the DOM, because collapsed groups aren't rendered.
 */
export function useTreeKeyboard(toggle: (key: string) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const current = (event.target as HTMLElement).closest<HTMLElement>(ITEM)
    if (!current) return

    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM)]
    const index = items.indexOf(current)
    const key = current.dataset.nodeKey ?? ''
    const expanded = current.getAttribute('aria-expanded')

    const focus = (item: HTMLElement | null | undefined) => {
      event.preventDefault()
      item?.focus()
    }

    switch (event.key) {
      case 'ArrowDown':
        return focus(items[index + 1] ?? current)
      case 'ArrowUp':
        return focus(items[index - 1] ?? current)
      case 'Home':
        return focus(items[0])
      case 'End':
        return focus(items[items.length - 1])
      case 'ArrowRight':
        if (expanded === 'false') {
          event.preventDefault()
          toggle(key)
        } else if (expanded === 'true') {
          // The next item in the DOM is the first child, as long as there is one.
          focus(items[index + 1] ?? current)
        }
        return
      case 'ArrowLeft':
        if (expanded === 'true') {
          event.preventDefault()
          toggle(key)
        } else {
          focus(current.parentElement?.closest<HTMLElement>(ITEM) ?? current)
        }
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (expanded !== null) toggle(key)
        else current.click()
        return
    }
  }
}
