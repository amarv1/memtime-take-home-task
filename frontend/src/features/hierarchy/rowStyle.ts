/** Left padding of a row: 0.5rem plus one step per level. */
export const indent = (level: number) => ({
  paddingLeft: `${0.5 + (level - 1) * 1.5}rem`,
})

// Off-screen rows skip layout and paint but stay in the DOM, so keyboard navigation and
// scrollIntoView still work. 2.25rem is `min-h-9`.
export const rowClass =
  '[content-visibility:auto] [contain-intrinsic-size:auto_2.25rem] flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-sm hover:bg-muted group-focus-visible/item:bg-muted group-focus-visible/item:ring-3 group-focus-visible/item:ring-ring/50'

// Stays on while the task is selected. The inset bar keeps it distinct from hover and
// from the focus ring without relying on colour alone; `aria-selected` carries the meaning.
export const selectedRowClass =
  'bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--color-primary)]'

// The client and project that hold the selected task. Marked even while collapsed, so a
// closed client still shows where the task is. `aria-current` carries the meaning.
export const ancestorRowClass = 'bg-primary/5 text-primary'
