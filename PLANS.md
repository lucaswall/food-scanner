# Fix Plan: Incorrect API Endpoint URLs

**Issue:** FOO-58
**Date:** 2026-02-05
**Status:** Planning
**Branch:** fix/FOO-58-api-endpoint-urls

## Investigation

### Bug Report
Fitbit food logging fails with 404 "The API you are requesting could not be found." The investigation revealed incorrect API endpoint URLs in the codebase.

### Classification
- **Type:** API Error / Integration
- **Severity:** Critical (food logging completely broken)
- **Affected Area:** `src/lib/fitbit.ts`, `src/lib/auth.ts`

### Root Cause Analysis

Comprehensive audit of all external API endpoints revealed:

#### 1. CRITICAL: Fitbit Log Food Endpoint (Breaking Bug)
The `logFood` function uses singular `food` instead of plural `foods` in the URL path.

**Evidence from Railway Logs (2026-02-05T13:02:43.996Z):**
```json
{
  "action": "fitbit_log_food_failed",
  "status": 404,
  "errorBody": {
    "errors": [{
      "errorType": "not_found",
      "message": "The API you are requesting could not be found."
    }]
  }
}
```

**File:** `src/lib/fitbit.ts:142`
```typescript
// Current (WRONG)
`${FITBIT_API_BASE}/1/user/-/food/log.json`

// Should be (plural "foods")
`${FITBIT_API_BASE}/1/user/-/foods/log.json`
```

#### 2. MINOR: Google Userinfo Endpoint (Deprecation Risk)
The Google userinfo endpoint uses v2 which is legacy. Google recommends v3.

**File:** `src/lib/auth.ts:48`
```typescript
// Current (legacy v2)
"https://www.googleapis.com/oauth2/v2/userinfo"

// Recommended (v3)
"https://www.googleapis.com/oauth2/v3/userinfo"
```

**Note:** v2 still works but may be deprecated in the future.

### Verified Correct Endpoints

| Service | Endpoint | Code URL | Status |
|---------|----------|----------|--------|
| Google OAuth | Authorization | `https://accounts.google.com/o/oauth2/v2/auth` | Correct |
| Google OAuth | Token Exchange | `https://oauth2.googleapis.com/token` | Correct |
| Fitbit OAuth | Authorization | `https://www.fitbit.com/oauth2/authorize` | Correct |
| Fitbit OAuth | Token Exchange | `https://api.fitbit.com/oauth2/token` | Correct |
| Fitbit | Create Food | `https://api.fitbit.com/1/user/-/foods.json` | Correct |

### Impact
- All food logging attempts fail with 404
- Core app functionality is completely broken
- Users cannot log any food to Fitbit

## Fix Plan (TDD Approach)

### Step 1: Update Test to Expect Correct Endpoint

**File:** `src/lib/__tests__/fitbit.test.ts`

Update line 273 to use the correct endpoint:

```typescript
// Change from:
expect(fetch).toHaveBeenCalledWith(
  "https://api.fitbit.com/1/user/-/food/log.json",
  // ...
);

// To:
expect(fetch).toHaveBeenCalledWith(
  "https://api.fitbit.com/1/user/-/foods/log.json",
  // ...
);
```

### Step 2: Fix Fitbit Log Food Endpoint

**File:** `src/lib/fitbit.ts`

Update line 142 to use the correct endpoint:

```typescript
// Change from:
const response = await fetchWithRetry(
  `${FITBIT_API_BASE}/1/user/-/food/log.json`,
  // ...
);

// To:
const response = await fetchWithRetry(
  `${FITBIT_API_BASE}/1/user/-/foods/log.json`,
  // ...
);
```

### Step 3: Update Google Userinfo Endpoint (Optional but Recommended)

**File:** `src/lib/auth.ts`

Update line 48 to use v3:

```typescript
// Change from:
const response = await fetch(
  "https://www.googleapis.com/oauth2/v2/userinfo",
  // ...
);

// To:
const response = await fetch(
  "https://www.googleapis.com/oauth2/v3/userinfo",
  // ...
);
```

### Step 4: Verify

- [ ] Update test expectation for `logFood` endpoint
- [ ] Fix `logFood` endpoint in implementation
- [ ] Update Google userinfo endpoint to v3
- [ ] All tests pass (`npm test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Manual verification: log a food item in production

## Files Affected

| File | Line | Change |
|------|------|--------|
| `src/lib/__tests__/fitbit.test.ts` | 273 | `food/log.json` → `foods/log.json` |
| `src/lib/fitbit.ts` | 142 | `food/log.json` → `foods/log.json` |
| `src/lib/auth.ts` | 48 | `oauth2/v2/userinfo` → `oauth2/v3/userinfo` |

## Documentation Sources
- [Fitbit Create Food Log API](https://dev.fitbit.com/build/reference/web-api/nutrition/create-food-log/)
- [Google OAuth2 Userinfo](https://www.oauth.com/oauth2-servers/signing-in-with-google/verifying-the-user-info/)

## Notes
- The Fitbit endpoint typo is a single character fix (`food` → `foods`)
- Google v2 userinfo still works but v3 is the current recommended version
- No changes needed to API response handling - only the URL paths are wrong
