import { render } from '@testing-library/react'
import { TreeItem } from '@/features/hierarchy/TreeItem'
import { childKey } from '@/features/hierarchy/treeContext'

describe('treeContext', () => {
  it('builds path keys', () => {
    expect(childKey('', 'client:1')).toBe('client:1')
    expect(childKey('client:1', 'project:2')).toBe('client:1/project:2')
  })

  it('refuses to render tree items outside a tree', () => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn())

    expect(() => render(<TreeItem level={1} nodeKey="a" name="A" />)).toThrow(
      /inside HierarchyTree/,
    )
    vi.restoreAllMocks()
  })
})
