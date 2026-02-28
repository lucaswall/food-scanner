# External API

The external API (`/api/v1/*`) provides programmatic access to Food Scanner data. It is separate from the browser-facing routes which use session cookies.

---

## Authentication

All `/api/v1/*` endpoints require a Bearer API key in the `Authorization` header:

```
Authorization: Bearer fsk_<64 hex chars>
```

**Key format:** `fsk_` prefix + 32 random bytes as hex (68 characters total).

**Key management:** Create and revoke keys through the browser UI at `/app` → API Keys, or via the browser-facing endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/api-keys` | List API keys |
| POST | `/api/api-keys` | Create API key |
| DELETE | `/api/api-keys/[id]` | Revoke API key |

The raw key is shown once at creation and never stored. Only a SHA-256 hash is kept in the database. The first 8 characters after the prefix are stored for display purposes.

**Auth errors:** Missing, malformed, or invalid/revoked keys return `401` with error code `AUTH_MISSING_SESSION`.

---

## Response Format

All responses use a standard envelope:

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "timestamp": 1709000000000
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Missing required parameter: date"
  },
  "timestamp": 1709000000000
}
```

The `details` field is only present when additional context is available (e.g., validation details). It is omitted from the response when not applicable.

All success responses include the following headers:

| Header | Value |
|---|---|
| `ETag` | Strong ETag (e.g., `"a3f1b2c4d5e6f789"`) based on response data |
| `Cache-Control` | `private, no-cache` |
| `Content-Type` | `application/json` |

Possible response statuses for GET endpoints: `200` (data returned), `304` (not modified — see below), `4xx`/`5xx` (errors).

---

## Conditional Requests (ETags)

All GET endpoints support conditional requests via the `ETag` / `If-None-Match` mechanism. This allows clients to avoid downloading data they already have cached.

### How it works

**First request — always returns full data:**
```
GET /api/v1/food-log?date=2026-02-28
Authorization: Bearer fsk_...

HTTP/1.1 200 OK
ETag: "a3f1b2c4d5e6f789"
Cache-Control: private, no-cache
Content-Type: application/json

{ "success": true, "data": { ... }, "timestamp": 1709000000000 }
```

**Subsequent request — returns 304 if data unchanged:**
```
GET /api/v1/food-log?date=2026-02-28
Authorization: Bearer fsk_...
If-None-Match: "a3f1b2c4d5e6f789"

HTTP/1.1 304 Not Modified
ETag: "a3f1b2c4d5e6f789"
Cache-Control: private, no-cache
```

A `304` response has **no body**. The client should use its previously cached data.

If the data has changed since the last request, a normal `200` response is returned with updated data and a new `ETag`.

### Notes

- The `ETag` is computed from **response data content only**, not from the timestamp. The same data always produces the same ETag.
- `Cache-Control: private, no-cache` means "cache the response privately, but always revalidate with the server before using it." This is the ideal pairing with ETags — the client can cache data locally and use `If-None-Match` to efficiently check for updates.
- Wildcard (`If-None-Match: *`) and comma-separated lists are supported per [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.2).
- Weak comparison semantics are used: `W/"abc"` in `If-None-Match` matches a stored `"abc"` ETag.

---

## Rate Limiting

Rate limits are per-API-key per-endpoint:

| Route type | Limit | Window |
|---|---|---|
| Database-only routes | 60 req/min | 60s |
| Fitbit API routes | 30 req/min | 60s |

Exceeding the limit returns `429` with error code `RATE_LIMIT_EXCEEDED`.

---

## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `AUTH_MISSING_SESSION` | 401 | Missing, malformed, or invalid API key |
| `VALIDATION_ERROR` | 400 | Invalid or missing request parameters |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded |
| `FITBIT_CREDENTIALS_MISSING` | 424 | Fitbit credentials not configured for this user |
| `FITBIT_TOKEN_INVALID` | 401 | Fitbit OAuth token expired or invalid |
| `FITBIT_SCOPE_MISSING` | 403 | Required Fitbit permission not granted |
| `FITBIT_API_ERROR` | 502 | Fitbit upstream error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Endpoints

### GET /api/v1/food-log

Returns food log entries for a date, grouped by meal.

**Data source:** PostgreSQL (60 req/min)

**Query parameters:**

| Name | Required | Format | Description |
|---|---|---|---|
| `date` | Yes | `YYYY-MM-DD` | Date to retrieve |

**Response schema:**

```typescript
interface NutritionSummary {
  date: string;
  meals: MealGroup[];
  totals: NutritionTotals;
}

interface MealGroup {
  mealTypeId: number;  // 1=Breakfast, 2=Morning Snack, 3=Lunch, 4=Afternoon Snack, 5=Dinner, 7=Anytime
  entries: MealEntry[];
  subtotal: NutritionTotals;
}

interface MealEntry {
  id: number;
  customFoodId: number;
  foodName: string;
  time: string | null;       // HH:mm:ss
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG: number | null;
  transFatG: number | null;
  sugarsG: number | null;
  caloriesFromFat: number | null;
}

interface NutritionTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG: number;
  transFatG: number;
  sugarsG: number;
  caloriesFromFat: number;
}
```

---

### GET /api/v1/nutrition-summary

Returns the daily nutrition summary for a date. Same data shape as `/food-log` — semantically focused on totals rather than per-entry detail.

**Data source:** PostgreSQL (60 req/min)

**Query parameters:**

| Name | Required | Format | Description |
|---|---|---|---|
| `date` | Yes | `YYYY-MM-DD` | Date to retrieve |

**Response schema:** Same `NutritionSummary` as `/food-log`.

---

### GET /api/v1/nutrition-goals

Returns the user's calorie goal from Fitbit.

**Data source:** Fitbit API (30 req/min)

**Query parameters:** None.

**Response schema:**

```typescript
interface NutritionGoals {
  calories: number | null;
}
```

**Additional errors:** `FITBIT_CREDENTIALS_MISSING` (424), `FITBIT_TOKEN_INVALID` (401), `FITBIT_SCOPE_MISSING` (403), `FITBIT_API_ERROR` (502).

---

### GET /api/v1/activity-summary

Returns daily activity data (calories burned) from Fitbit.

**Data source:** Fitbit API (30 req/min)

**Query parameters:**

| Name | Required | Format | Description |
|---|---|---|---|
| `date` | Yes | `YYYY-MM-DD` | Date to retrieve |

**Response schema:**

```typescript
interface ActivitySummary {
  caloriesOut: number;
}
```

**Additional errors:** Same Fitbit errors as `/nutrition-goals`.

---

### GET /api/v1/lumen-goals

Returns Lumen metabolic goals (macro targets) for a date. Returns `null` for the `goals` field when no data has been recorded — this is a normal 200 response, not an error.

**Data source:** PostgreSQL (60 req/min)

**Query parameters:**

| Name | Required | Format | Description |
|---|---|---|---|
| `date` | Yes | `YYYY-MM-DD` | Date to retrieve |

**Response schema:**

```typescript
interface LumenGoalsResponse {
  goals: LumenGoals | null;
}

interface LumenGoals {
  date: string;        // YYYY-MM-DD
  dayType: string;     // e.g. "low-carb", "high-carb"
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}
```

---

## Summary

| Method | Path | Rate Limit | Data Source | `date` Param |
|---|---|---|---|---|
| GET | `/api/v1/food-log` | 60/min | PostgreSQL | Required |
| GET | `/api/v1/nutrition-summary` | 60/min | PostgreSQL | Required |
| GET | `/api/v1/nutrition-goals` | 30/min | Fitbit API | None |
| GET | `/api/v1/activity-summary` | 30/min | Fitbit API | Required |
| GET | `/api/v1/lumen-goals` | 60/min | PostgreSQL | Required |
