import { isValidDateFormat } from "@/lib/date-utils";

/** Earliest accepted reading timestamp (guards against epoch/garbage values). */
const MIN_READING_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
/** Tolerated client clock skew for readings stamped slightly in the future. */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** Maximum span of a readings GET range, in calendar days (inclusive). */
export const MAX_READINGS_RANGE_DAYS = 31;

/** Upper bounds that keep client values inside Postgres int4 and physiological sanity. */
export const READING_LIMITS = {
  glucoseMgDlMax: 2000,
  bloodPressureMmHgMax: 300,
  heartRateBpmMax: 300,
  hydrationMlMax: 10000,
} as const;

const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * True when `value` is a real ISO 8601 instant: calendar-valid date (rejects Feb 30 and month 13),
 * valid clock fields and offset, and within a sane window (>= 2000-01-01, <= now + 24h).
 */
export function isValidReadingTimestamp(value: string): boolean {
  const m = ISO_INSTANT_RE.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  return ts >= MIN_READING_TIMESTAMP_MS && ts <= Date.now() + MAX_FUTURE_SKEW_MS;
}

/** True for integers in [1, max]. */
export function isPositiveIntUpTo(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/** True for finite numbers in (0, max]. */
export function isPositiveNumberUpTo(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;
}

export type ReadingsRangeResult = { from: string; to: string } | { error: string };

/** Parses the `date` or `from`/`to` query parameters shared by the readings GET routes. */
export function parseReadingsRange(searchParams: URLSearchParams): ReadingsRangeResult {
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (date !== null) {
    if (!isValidDateFormat(date)) return { error: "Invalid date format. Use YYYY-MM-DD" };
    return { from: date, to: date };
  }
  if (from === null && to === null) {
    return { error: "Missing query parameter: provide 'date' or 'from'/'to' range" };
  }
  if (from === null) return { error: "Missing 'from' parameter (required when 'to' is provided)" };
  if (to === null) return { error: "Missing 'to' parameter (required when 'from' is provided)" };
  if (!isValidDateFormat(from)) return { error: "Invalid date format for 'from'. Use YYYY-MM-DD" };
  if (!isValidDateFormat(to)) return { error: "Invalid date format for 'to'. Use YYYY-MM-DD" };
  if (from > to) return { error: "'from' must not be after 'to' in date range" };

  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (spanDays > MAX_READINGS_RANGE_DAYS) {
    return { error: `Date range must not exceed ${MAX_READINGS_RANGE_DAYS} days` };
  }
  return { from, to };
}

/** Thrown by the readings GET queries when the range holds more rows than MAX_READINGS_ROWS. */
export const READINGS_LIMIT_EXCEEDED_MESSAGE = "READINGS_LIMIT_EXCEEDED";

/** Hard cap on rows returned by one readings GET (31 days of 5-minute CGM data is ~8.9k). */
export const MAX_READINGS_ROWS = 20000;
