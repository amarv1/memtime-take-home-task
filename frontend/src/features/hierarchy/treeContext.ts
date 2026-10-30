import { createContext, useContext } from 'react'

export interface TreeState {
  /** The one item that is in the tab order (roving tabindex). */
  tabKey: string
  isExpanded: (key: string) => boolean
  toggle: (key: string) => void
  /** The task named by the URL, or null. */
  selectedTaskId: number | null
  selectTask: (taskId: number) => void
  /** Where the selected task lives, once known. Lists page forward until they hold it. */
  target: TreeTarget | null
  /** Called with the selected task's row each time it renders. */
  onSelectedRow: (element: HTMLElement | null, key: string) => void
}

export interface TreeTarget {
  clientId: number
  projectId: number
  taskId: number
}

export const TreeContext = createContext<TreeState | null>(null)

export function useTree(): TreeState {
  const state = useContext(TreeContext)
  if (!state) throw new Error('Tree components must be rendered inside HierarchyTree')
  return state
}

/** Node keys are paths (`client:1/project:101`), so a key is unique across levels. */
export function childKey(parentKey: string, segment: string): string {
  return parentKey ? `${parentKey}/${segment}` : segment
}
