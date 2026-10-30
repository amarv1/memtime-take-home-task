import type { TimeEntry } from './timeEntryService.ts'

/**
 * A full read of Memtime's list, page by page in id order. Kept between requests, so a read
 * that runs out of rate-limit budget goes on from where it stopped.
 */
export interface Reload {
  /** Entries read so far, by id ascending. */
  entries: TimeEntry[]
  /** Where the next page starts in Memtime's list sorted by id. */
  offset: number
  /** The newest `updatedAt` when the read began. Changes after it are kept from the served list. */
  since: string | null
}

/** What the server knows about one key's entries. Replaced as a whole on every change. */
export interface Snapshot {
  /** The complete list by id ascending, or null until the first full read finishes. */
  entries: TimeEntry[] | null
  /** The newest `updatedAt` Memtime has listed; the next check asks for changes from here. */
  highWater: string | null
  /** When the list was last checked against Memtime (local ms); 0 forces a check. */
  checkedAt: number
  reload: Reload | null
  /** Bumped by every save this server makes, so a read that overlapped one is not applied. */
  version: number
}

export const emptySnapshot: Snapshot = {
  entries: null,
  highWater: null,
  checkedAt: 0,
  reload: null,
  version: 0,
}

/** How many entries a snapshot holds, counting a partial reload; at least 1. */
export const snapshotSize = (snapshot: Snapshot) =>
  Math.max(1, (snapshot.entries?.length ?? 0) + (snapshot.reload?.entries.length ?? 0))

const time = (iso: string) => Date.parse(iso)

/** Whether a change made at `updatedAt` is one the check from `since` must pick up. */
export const isNotBefore = (updatedAt: string, since: string | null) =>
  since === null || time(updatedAt) >= time(since)

function later(a: string | null, b: string | null) {
  if (a === null) return b
  if (b === null) return a
  return time(a) >= time(b) ? a : b
}

/** `entries` with `changes` applied by id, keeping whichever version was updated last. Sorted by id. */
export function merge(
  entries: readonly TimeEntry[],
  changes: readonly TimeEntry[],
): TimeEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  for (const change of changes) {
    const current = byId.get(change.id)
    if (!current || isNotBefore(change.updatedAt, current.updatedAt))
      byId.set(change.id, change)
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** Applies the entries Memtime listed as changed since `highWater`, and moves `highWater` up to them. */
export function applyChanges(
  snapshot: Snapshot,
  changes: readonly TimeEntry[],
): Snapshot {
  if (!snapshot.entries) return snapshot
  return {
    ...snapshot,
    entries: merge(snapshot.entries, changes),
    highWater: changes.reduce<string | null>(
      (newest, entry) => later(newest, entry.updatedAt),
      snapshot.highWater,
    ),
  }
}

/**
 * Deletes leave no trace in `updatedAt`, so the count shows them: read Memtime's list sorted by
 * id from this offset, and it should hold exactly our last entry.
 */
export const countCheckOffset = (entries: readonly TimeEntry[]) =>
  Math.max(entries.length - 1, 0)

export function countMatches(entries: readonly TimeEntry[], page: readonly TimeEntry[]) {
  const last = entries.at(-1)
  return last ? page.length === 1 && page[0]?.id === last.id : page.length === 0
}

/** Starts a full read. `since` is the newest `updatedAt` Memtime listed when it began. */
export function startReload(snapshot: Snapshot, since: string | null): Snapshot {
  return {
    ...snapshot,
    highWater: later(snapshot.highWater, since),
    reload: { entries: [], offset: 0, since },
  }
}

/** Adds a page of the full read. A short page is the last one and makes the result the served list. */
export function addReloadPage(
  snapshot: Snapshot,
  page: readonly TimeEntry[],
  pageSize: number,
  now: number,
): Snapshot {
  if (!snapshot.reload) return snapshot
  const reload: Reload = {
    ...snapshot.reload,
    entries: merge(snapshot.reload.entries, page),
    offset: snapshot.reload.offset + page.length,
  }
  if (page.length === pageSize) return { ...snapshot, reload }

  // Changes the served list picked up after the read began may be newer than what was read.
  const since = reload.since
  const changedSince = (snapshot.entries ?? []).filter(
    (entry) => since === null || time(entry.updatedAt) > time(since),
  )
  return {
    entries: merge(reload.entries, changedSince),
    highWater: later(snapshot.highWater, since),
    checkedAt: now,
    reload: null,
    version: snapshot.version,
  }
}

/** Puts an entry this server just created or updated into the list and into a full read under way. */
export function applySaved(snapshot: Snapshot, entry: TimeEntry): Snapshot {
  return {
    ...snapshot,
    version: snapshot.version + 1,
    entries: snapshot.entries && merge(snapshot.entries, [entry]),
    reload: snapshot.reload && savedDuringReload(snapshot.reload, entry),
  }
}

function savedDuringReload(reload: Reload, entry: TimeEntry): Reload {
  const known = reload.entries.some((e) => e.id === entry.id)
  const last = reload.entries.at(-1)
  // An entry past the last one read comes with a later page.
  if (!known && (!last || entry.id > last.id)) return reload
  // A new entry below the last one read moves the rest of Memtime's list down by one.
  return {
    ...reload,
    entries: merge(reload.entries, [entry]),
    offset: reload.offset + (known ? 0 : 1),
  }
}

/** Removes an entry that is gone from Memtime, from the list and from a full read under way. */
export function applyDeleted(snapshot: Snapshot, id: number): Snapshot {
  return {
    ...snapshot,
    version: snapshot.version + 1,
    entries: snapshot.entries?.filter((e) => e.id !== id) ?? null,
    reload: snapshot.reload && deletedDuringReload(snapshot.reload, id),
  }
}

function deletedDuringReload(reload: Reload, id: number): Reload {
  if (!reload.entries.some((e) => e.id === id)) return reload
  // Memtime's list moves up by one, so the next page starts one earlier.
  return {
    ...reload,
    entries: reload.entries.filter((e) => e.id !== id),
    offset: reload.offset - 1,
  }
}

/** After a save whose outcome is unknown: the next read checks Memtime, and reads under way are not applied. */
export function markStale(snapshot: Snapshot): Snapshot {
  return { ...snapshot, version: snapshot.version + 1, checkedAt: 0 }
}
