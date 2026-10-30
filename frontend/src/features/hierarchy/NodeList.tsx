import { useEffect, type ReactNode } from 'react'
import { RATE_LIMITED_MESSAGE, isRateLimited, useCountdown } from '@/lib/rateLimit'
import { Spinner, StatusRow } from './StatusRow'
import { childKey } from './treeContext'

/** The part of an infinite query the list needs. */
export interface ListQuery<T> {
  data: T[] | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
  isFetchNextPageError: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => unknown
  refetch: () => unknown
}

interface Props<T> {
  query: ListQuery<T>
  level: number
  parentKey: string
  /** Plural noun used in messages, e.g. "projects". */
  noun: string
  render: (item: T) => ReactNode
  /** An item to bring into view: further pages load until it is in the list. */
  targetId?: number
}

/** The rows of one level: its items, then whatever state the query is in. */
export function NodeList<T extends { id: number }>({
  query,
  level,
  parentKey,
  noun,
  render,
  targetId,
}: Props<T>) {
  const { data, isPending, isError, error, isFetchNextPageError } = query
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const secondsLeft = useCountdown(error)
  const missing = targetId !== undefined && !data?.some((item) => item.id === targetId)

  // Stops when the item shows up, the pages run out, or a page fails (the error row takes over).
  useEffect(() => {
    if (missing && hasNextPage && !isFetchingNextPage && !isError) {
      void fetchNextPage()
    }
  }, [missing, hasNextPage, isFetchingNextPage, isError, fetchNextPage])

  const key = (segment: string) => childKey(parentKey, `status:${segment}`)

  if (isPending) {
    return (
      <StatusRow level={level} nodeKey={key('loading')}>
        <Spinner />
        Loading {noun}…
      </StatusRow>
    )
  }

  const items = data ?? []

  return (
    <>
      {items.map((item) => render(item))}
      {items.length === 0 && !isError && (
        <StatusRow level={level} nodeKey={key('empty')}>
          No {noun}
        </StatusRow>
      )}
      {isError ? (
        <StatusRow
          level={level}
          nodeKey={key('error')}
          // A failed next page is retried as a next page; anything else as a reload.
          onActivate={() =>
            void (isFetchNextPageError ? query.fetchNextPage() : query.refetch())
          }
          disabled={secondsLeft > 0}
        >
          <span className="min-w-0 truncate">
            {isRateLimited(error)
              ? RATE_LIMITED_MESSAGE
              : `Couldn't load ${noun}. ${error?.message}`}
          </span>
          <span className="shrink-0 font-medium text-foreground underline">
            {secondsLeft > 0 ? `Try again in ${secondsLeft}s` : 'Try again'}
          </span>
        </StatusRow>
      ) : (
        query.hasNextPage && (
          <StatusRow
            level={level}
            nodeKey={key('load-more')}
            onActivate={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? (
              <>
                <Spinner />
                Loading more…
              </>
            ) : (
              <>Load more {noun}</>
            )}
          </StatusRow>
        )
      )}
    </>
  )
}
