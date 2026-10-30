import { createContext, useContext, useSyncExternalStore } from 'react'

export interface TreeTarget {
  clientId: number
  projectId: number
  taskId: number
}

/** What changes while the tree is used. Rows read it through selectors, never whole. */
export interface TreeSnapshot {
  expanded: ReadonlySet<string>
  /** The item last focused or selected. Null until there is one. */
  activeKey: string | null
  /** The tab stop while `activeKey` is null. */
  firstKey: string
  /** The task named by the URL, or null. */
  selectedTaskId: number | null
  /** Where the selected task lives, once known. Lists page forward until they hold it. */
  target: TreeTarget | null
  /** Memtime is refusing reads: levels wait to load, and lists don't load more. */
  paused: boolean
  /** When the pause ends (ms since epoch), for the countdowns. */
  pausedUntil: number
}

export interface TreeStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => TreeSnapshot
  /** Merges the changes; listeners run only if a field is different. */
  set: (changes: Partial<TreeSnapshot>) => void
  toggle: (key: string) => void
  expand: (keys: readonly string[]) => void
}

export function createTreeStore(): TreeStore {
  let snapshot: TreeSnapshot = {
    expanded: new Set(),
    activeKey: null,
    firstKey: '',
    selectedTaskId: null,
    target: null,
    paused: false,
    pausedUntil: 0,
  }
  const listeners = new Set<() => void>()

  function set(changes: Partial<TreeSnapshot>) {
    const changed = (Object.keys(changes) as (keyof TreeSnapshot)[]).some(
      (field) => !Object.is(changes[field], snapshot[field]),
    )
    if (!changed) return
    snapshot = { ...snapshot, ...changes }
    listeners.forEach((listener) => listener())
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    set,
    toggle: (key) => {
      const next = new Set(snapshot.expanded)
      if (!next.delete(key)) next.add(key)
      set({ expanded: next })
    },
    expand: (keys) => set({ expanded: new Set([...snapshot.expanded, ...keys]) }),
  }
}

/** Only stable things: the store and callbacks that keep their identity. */
export interface TreeApi {
  store: TreeStore
  toggle: (key: string) => void
  selectTask: (taskId: number) => void
  /** Called with the selected task's row each time it renders. */
  onSelectedRow: (element: HTMLElement | null, key: string) => void
}

export const TreeContext = createContext<TreeApi | null>(null)

export function useTree(): TreeApi {
  const api = useContext(TreeContext)
  if (!api) throw new Error('Tree components must be rendered inside HierarchyTree')
  return api
}

/** Re-renders only when the selected value changes, so it must be a primitive. */
export function useTreeSelector<T extends string | number | boolean | null | undefined>(
  selector: (snapshot: TreeSnapshot) => T,
): T {
  const { store } = useTree()
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

export const useIsExpanded = (key: string) => useTreeSelector((s) => s.expanded.has(key))

export const useIsPaused = () => useTreeSelector((s) => s.paused)

/** Roving tabindex: the active item, or the first one until there is an active one. */
export const useIsTabStop = (key: string) =>
  useTreeSelector((s) => (s.activeKey ?? s.firstKey) === key)

/** Node keys are paths (`client:1/project:101`), so a key is unique across levels. */
export function childKey(parentKey: string, segment: string): string {
  return parentKey ? `${parentKey}/${segment}` : segment
}
