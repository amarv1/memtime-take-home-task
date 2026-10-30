import { render } from '@testing-library/react'
import { TreeItem } from '@/features/hierarchy/TreeItem'
import { childKey, createTreeStore } from '@/features/hierarchy/treeContext'

describe('treeContext', () => {
  it('builds path keys', () => {
    expect(childKey('', 'client:1')).toBe('client:1')
    expect(childKey('client:1', 'project:2')).toBe('client:1/project:2')
  })

  it('toggles and expands keys, and notifies only on a real change', () => {
    const store = createTreeStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.toggle('a')
    store.expand(['a', 'b'])
    expect([...store.getSnapshot().expanded]).toEqual(['a', 'b'])
    store.toggle('a')
    expect([...store.getSnapshot().expanded]).toEqual(['b'])
    expect(listener).toHaveBeenCalledTimes(3)

    store.set({ activeKey: null, firstKey: '' })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('refuses to render tree items outside a tree', () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn())

    expect(() => render(<TreeItem level={1} nodeKey="a" name="A" />)).toThrow(
      /inside HierarchyTree/,
    )
    vi.restoreAllMocks()
  })
})
