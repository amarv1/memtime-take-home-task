// ISO 8601 date and time with a zone; seconds and fractions are optional.
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i

/** Milliseconds since the epoch, or `undefined` when `value` is not an ISO 8601 date and time with a zone. */
export function parseInstant(value: string): number | undefined {
  const match = ISO_WITH_ZONE.exec(value)
  if (!match) return undefined
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return undefined

  // Date.parse rolls "02-30" over to March instead of rejecting it.
  const [, year, month, day] = match.map(Number)
  const calendar = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day))
  if (calendar.getUTCMonth() !== (month ?? 0) - 1) return undefined
  return ms
}
