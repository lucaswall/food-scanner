/** Message of the Error thrown when a compare-and-set write finds the entry changed or removed. */
export const ENTRY_CONFLICT_MESSAGE = "ENTRY_CONFLICT";

export function isEntryConflictError(error: unknown): boolean {
  return error instanceof Error && error.message === ENTRY_CONFLICT_MESSAGE;
}
