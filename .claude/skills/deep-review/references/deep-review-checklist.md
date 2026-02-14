# Deep Review Checklist

Cross-domain checklist organized around interaction patterns. Each section requires reasoning about how multiple files work together — not just individual file quality.

## 1. Data Flow Integrity

Trace data from source to display and back.

### API Contract Alignment
- Response type from API route matches what the client component expects
- All fields the component accesses actually exist in the API response
- Optional/nullable fields in the response are handled in the component (not bare `.field` access)
- Error response shape from API is handled by the client error handling
- Request body shape from client matches what the API route validates/expects

### Type Safety Across Boundaries
- Shared types in `src/types/` used by BOTH the API route and the client
- No `as any` or `as Type` casts that paper over a contract mismatch
- API response transformations preserve type safety (no lossy conversions)
- Fitbit API responses validated before use (external data boundary)
- Claude API responses validated before use (AI output boundary)

### Data Transformation
- Date/time values serialized and deserialized correctly across client/server boundary
- Numeric values (calories, weight) maintain precision through transformations
- Arrays/collections handled correctly when empty, single-element, or large
- Undefined vs null vs missing key handled consistently

## 2. State Lifecycle

### Staleness
- SWR cache keys unique enough to prevent showing wrong data
- SWR revalidation triggers when data should refresh (after mutations, on focus, on reconnect)
- Component state reset when route params change (key prop or useEffect dependency)
- No stale closures capturing old state in event handlers or callbacks
- Optimistic updates (if any) correctly roll back on failure

### Race Conditions
- Rapid user actions don't cause interleaved API calls with wrong results
- Navigation away during pending API call doesn't cause state update on unmounted component
- Concurrent mutations to same resource handled (last-write-wins or conflict detection)
- AbortController used for cancellable requests when component unmounts or user navigates

### Mount/Unmount
- useEffect cleanup functions clean up subscriptions, timers, AbortControllers
- Component handles being unmounted and remounted (React StrictMode double-mount)
- Event listeners added in useEffect have corresponding removal in cleanup

## 3. Error Path Completeness

### API Route Errors
- Every `await` in API routes wrapped in try/catch or within a try block
- Database errors return appropriate HTTP status (500, not swallowed)
- External API errors (Fitbit, Claude) return appropriate HTTP status
- Validation errors return 400 with useful error message
- Auth failures return 401/403 consistently
- Error responses use standardized format (ErrorCode from src/types)

### Client Error Handling
- fetch/useSWR error states rendered with user-friendly messages
- Network errors (offline, timeout) distinguished from server errors
- Error messages include actionable guidance ("Try again" / "Check your connection")
- Error boundaries catch rendering errors in the component tree
- Form submission errors shown inline, not just console.error

### Error Recovery
- User can retry after transient failures without full page refresh
- Form data preserved after submission failure (not cleared on error)
- Partial success states handled (e.g., analysis succeeded but Fitbit log failed)

## 4. Edge Cases

### Empty/Missing Data
- Component renders correctly with no data (empty arrays, null values)
- Empty state has clear messaging and call to action
- API returns appropriate response for empty results (empty array, not 404)
- First-time user experience works (no prior data, no Fitbit connection)

### Boundary Values
- Very long text (food descriptions, names) handled (truncation, wrapping)
- Very large numbers (high-calorie meals) display correctly
- Zero values displayed correctly (0 calories is valid, not treated as "missing")
- Special characters in user input don't break display or queries
- Multiple rapid submissions handled (debounce or button disable)

### Navigation
- Multiple browser tabs don't conflict
- Back/forward browser navigation preserves expected state
- Deep linking works (URL directly to a specific state)
- Page refresh preserves or gracefully resets state

## 5. Security Surface

### Authentication & Authorization
- Route handler checks session/auth before processing
- Session validation matches CLAUDE.md convention (getSession + validateSession for browser, validateApiRequest for v1)
- OAuth tokens stay server-side, never exposed to client
- Allowlist enforcement (ALLOWED_EMAILS) applied consistently

### Input Validation
- User input sanitized before database operations
- File uploads validated (size, type) before processing
- API request bodies validated with appropriate schemas
- No path traversal via user-controlled file paths
- No XSS via user-controlled content rendered as HTML (dangerouslySetInnerHTML, unescaped output)

### Sensitive Data
- Tokens, secrets, session data not logged (check pino calls)
- Sensitive data not in client-accessible responses
- Images not logged or stored longer than needed
- Error responses don't leak internal details (stack traces, file paths)

## 6. User Experience

### Loading States
- loading.tsx exists with Skeleton matching page layout
- Async operations show loading indicators (spinner, skeleton, disabled button)
- Loading state appears immediately (no gap before indicator shows)
- Partial loading: only the updating section shows loading, not the entire screen

### Feedback
- Every user action has visible feedback (button state change, toast, inline message)
- Success confirmations are specific ("Logged 450 cal to Fitbit" not "Success")
- Destructive actions require confirmation
- Long operations show progress or at least a descriptive message

### Accessibility
- Interactive elements use semantic HTML (button, a, input — not div onClick)
- Images have meaningful alt text
- Form inputs have associated labels (htmlFor/id)
- Focus management correct for modals/dialogs (trap focus, return on close)
- Touch targets >= 44x44px
- Color not the sole indicator of state or information

### Responsive & Mobile
- Layout works at 320px width without horizontal scroll
- Touch targets have adequate spacing (no accidental taps)
- No hover-only interactions (must work on touch)
- Safe area insets handled (notch, home indicator)
- Keyboard doesn't obscure input fields on mobile

## 7. Performance

### Rendering
- No unnecessary re-renders (check useEffect/useMemo/useCallback dependency arrays)
- Large lists use virtualization or pagination if applicable
- Client Component boundary pushed as low as possible in component tree
- Server Components used for static/data-fetching content

### Bundle
- Heavy libraries dynamically imported (next/dynamic)
- No barrel imports from large packages
- `'use client'` only where truly needed (hooks, event handlers, browser APIs)

### Network
- No redundant API calls on mount
- SWR deduplicates concurrent requests for same key
- Images use next/image (auto optimization, lazy loading)
- No waterfall requests that could be parallel
