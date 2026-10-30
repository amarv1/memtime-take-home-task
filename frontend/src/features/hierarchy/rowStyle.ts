/** Left padding of a row: 0.5rem plus one step per level. */
export const indent = (level: number) => ({
  paddingLeft: `${0.5 + (level - 1) * 1.5}rem`,
})

export const rowClass =
  'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-sm hover:bg-muted group-focus-visible/item:bg-muted group-focus-visible/item:ring-3 group-focus-visible/item:ring-ring/50'
