# Food Scanner - Roadmap

Single-user web application for logging food to Fitbit using AI-powered nutritional analysis. User takes photos of food, adds optional text description, Claude Sonnet analyzes nutrition via tool_use, user confirms/edits, and data is posted to Fitbit API.

**Single authorized user:** wall.lucas@gmail.com
**No database:** All state in encrypted browser cookies (iron-session).

For tech stack, project structure, and deployment: see [CLAUDE.md](CLAUDE.md), [README.md](README.md), [DEVELOPMENT.md](DEVELOPMENT.md).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Browser (Chrome/Safari)                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Next.js App (Railway + custom domain)         │  │
│  │  - Landing page (public)                              │  │
│  │  - /app route (protected, camera interface)           │  │
│  │  - /settings route (protected)                        │  │
│  │  - /api/* route handlers (server-side)                │  │
│  └───────────────────┬───────────────────────────────────┘  │
│                      │ Same-origin API calls (/api/...)     │
│  iron-session Cookie ┴── Session + Fitbit Tokens            │
└──────────────────────┼───────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
┌──────────────┐ ┌──────────┐ ┌─────────────┐
│ Google OAuth │ │  Claude  │ │ Fitbit API  │
│     API      │ │   API    │ │             │
└──────────────┘ └──────────┘ └─────────────┘
```

---

## Implementation Iterations

### Iteration 1: Foundation & Auth

Build the session layer, authentication flows, and route protection. After this iteration, the app has a working login flow with Google + Fitbit, protected routes, and a settings page.

#### 1A: Session & Middleware

**iron-session setup:**

```typescript
// lib/session.ts
import { getIronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  sessionId: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  fitbit?: {
    accessToken: string;
    refreshToken: string;
    userId: string;
    expiresAt: number;
  };
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'food-scanner-session',
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60,  // 30 days
    path: '/',
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
```

**Auth middleware** (`middleware.ts`):

```typescript
export const config = {
  matcher: ['/app/:path*', '/settings/:path*', '/api/((?!health|auth).*)'],
};

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('food-scanner-session');
  if (!sessionCookie) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: { code: 'AUTH_MISSING_SESSION', message: 'Not authenticated' } },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}
```

Middleware checks cookie existence as a fast-path. Route handlers still validate session contents via iron-session (unsealing + expiry check).

**API response standards:**

```typescript
// Success
{ success: true, data: T, timestamp: number }

// Error
{ success: false, error: { code: string, message: string, details?: any }, timestamp: number }
```

**Error codes:** AUTH_INVALID_EMAIL, AUTH_SESSION_EXPIRED, AUTH_MISSING_SESSION, FITBIT_NOT_CONNECTED, FITBIT_TOKEN_INVALID, CLAUDE_API_ERROR, FITBIT_API_ERROR, VALIDATION_ERROR

**TypeScript types** — define in `src/types/`:

```typescript
interface FoodAnalysis {
  food_name: string;
  portion_size_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

interface FoodLogRequest extends FoodAnalysis {
  mealTypeId: number;  // 1,2,3,4,5,7
  date?: string;       // YYYY-MM-DD
  time?: string;       // HH:mm:ss
}

interface FoodLogResponse {
  success: boolean;
  fitbitFoodId: number;
  fitbitLogId: number;
  reusedFood: boolean;
  error?: string;
}

enum FitbitMealType {
  Breakfast = 1,
  MorningSnack = 2,
  Lunch = 3,
  AfternoonSnack = 4,
  Dinner = 5,
  Anytime = 7,
}

interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: number;
}

interface ApiErrorResponse {
  success: false;
  error: { code: string; message: string; details?: any };
  timestamp: number;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
```

#### 1B: Google OAuth

**Flow:**
1. User visits landing page, clicks "Login with Google"
2. Browser redirects to Google OAuth 2.0 authorization URL
3. User authenticates with Google
4. Google redirects to `/api/auth/google/callback`
5. Route handler exchanges code for user profile
6. Validates: `profile.email === 'wall.lucas@gmail.com'`
   - No match: Return 403 "Unauthorized email address"
   - Match: Create iron-session with user data
7. Check if session has valid Fitbit tokens
   - Yes: Redirect to `/app`
   - No: Redirect to Fitbit OAuth

**Routes:**
- `POST /api/auth/google` — Initiate Google OAuth
- `GET /api/auth/google/callback` — Handle callback, create session

**Landing page** (`/`): Hero section, "Login with Google" button, brief feature explanation.

#### 1C: Fitbit OAuth & Token Management

**Flow:**
1. After Google auth (or from Settings reconnect), redirect to Fitbit OAuth
2. User authenticates with Fitbit, grants `nutrition` scope
3. Fitbit redirects to `/api/auth/fitbit/callback`
4. Route handler stores tokens in session, redirects to `/app`

**Token refresh** — before each Fitbit API call:
```typescript
if (fitbitToken.expiresAt < Date.now() + 3600000) {
  const newTokens = await refreshFitbitToken(fitbitToken.refreshToken);
  session.fitbit = { ...session.fitbit, ...newTokens };
  await session.save();
}
```

If refresh fails (refresh token revoked), return `FITBIT_TOKEN_INVALID`. Frontend shows inline prompt: "Fitbit connection expired. Reconnect?" — triggers Fitbit OAuth only (no Google re-auth).

**Routes:**
- `POST /api/auth/fitbit` — Initiate Fitbit OAuth
- `GET /api/auth/fitbit/callback` — Handle callback, store tokens
- `GET /api/auth/session` — Validate current session
- `POST /api/auth/logout` — Destroy session cookie

**Settings page** (`/settings`):
- Fitbit connection status (connected/expired, token expiry info)
- "Reconnect Fitbit" button — triggers Fitbit OAuth, returns to `/settings`
- "Logout" button — destroys session, redirects to landing page

---

### Iteration 2: AI Food Analysis

Build the Claude API integration and the photo capture UI. After this iteration, the user can take photos, add descriptions, and receive structured nutritional analysis.

#### 2A: Claude API Client

**Route:** `POST /api/analyze-food` (multipart/form-data)

**Request fields:**
- `images`: 1-3 image files (compressed client-side)
- `description`: Optional text description

**Route handler processing:**
1. Validate session
2. Check Fitbit connection exists (prompt reconnect if not)
3. Read image files as buffers, convert to base64
4. Call Claude API using tool_use
5. Extract tool call result, return to frontend

**Claude API call:**

```typescript
const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system: `You are a nutrition analyst specializing in Argentine and Latin American cuisine.
Analyze food images and descriptions to provide accurate nutritional information.
Consider typical Argentine portions and preparation methods.`,
  tools: [{
    name: 'report_nutrition',
    description: 'Report the nutritional analysis of the food shown in the images',
    input_schema: {
      type: 'object',
      properties: {
        food_name: { type: 'string', description: 'Clear name of the food in Spanish or English' },
        portion_size_g: { type: 'number', description: 'Estimated weight in grams' },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        fiber_g: { type: 'number' },
        sodium_mg: { type: 'number' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        notes: { type: 'string', description: 'Brief explanation of assumptions made' },
      },
      required: ['food_name', 'portion_size_g', 'calories', 'protein_g',
                  'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'confidence', 'notes'],
    },
  }],
  tool_choice: { type: 'tool', name: 'report_nutrition' },
  messages: [{
    role: 'user',
    content: [
      ...images.map(img => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType, data: img.base64 },
      })),
      { type: 'text' as const, text: description || 'Analyze this food.' },
    ],
  }],
});

const toolUseBlock = response.content.find(block => block.type === 'tool_use');
const nutrition: FoodAnalysis = toolUseBlock.input;
```

**Why tool_use:** Schema-enforced output, no parsing ambiguity, `tool_choice` forces the tool call (no refusal text), type-safe input field.

**Timeouts:** 30 seconds max, 1 retry on timeout then fail.

#### 2B: Photo Capture UI

**Camera interface** (`/app` page):
- Native file input: `accept="image/*"` with `capture="environment"`
- Support 1-3 photos (multi-select)
- Client-side compression: resize to ~1024px max dimension, 80% JPEG quality via `<canvas>`
- Preview thumbnails of selected photos
- Text area for optional description (placeholder: "e.g., 250g pollo asado con chimichurri", max 500 chars)
- Clear/retake functionality
- "Analyze" button

**Image validation:** Max 10MB per image, max 3 images, JPEG/PNG only.

**No photo persistence:** Photos kept in browser memory only until analysis complete.

---

### Iteration 3: Fitbit Logging & Review UI

Build the Fitbit food logging backend and the review/edit UI. After this iteration, the full food logging flow works end-to-end.

#### 3A: Fitbit API Client

**Route:** `POST /api/log-food`

**Processing:**
1. Validate session
2. Check Fitbit token expiry, refresh if needed
3. Search existing custom foods for a match (deduplication)
4. If match found: reuse existing foodId
5. If no match: create new custom food
6. Log food entry using foodId
7. Return success confirmation

**Food deduplication:**
```typescript
async function findOrCreateFood(session: SessionData, food: FoodAnalysis): Promise<number> {
  // Search: GET https://api.fitbit.com/1/user/-/foods.json?query={food_name}
  const searchResults = await fitbitGet(
    `/1/user/-/foods.json?query=${encodeURIComponent(food.food_name)}`,
    session.fitbit!.accessToken
  );

  // Match: same name (case-insensitive) and calories within 10% tolerance
  const match = searchResults.foods?.find((f: any) =>
    f.name.toLowerCase() === food.food_name.toLowerCase() &&
    Math.abs(f.calories - food.calories) / food.calories <= 0.10
  );

  if (match) return match.foodId;

  // No match — create new custom food
  const created = await fitbitCreateFood(session.fitbit!.accessToken, food);
  return created.food.foodId;
}
```

**Create custom food:** `POST https://api.fitbit.com/1/user/-/foods.json`
- Content-Type: `application/x-www-form-urlencoded`
- Parameters: name, defaultFoodMeasurementUnitId (304 = "serving"), defaultServingSize (1), calories, protein, carbs, fat, fiber, sodium, formType (DRY for solid foods)

**Log food entry:** `POST https://api.fitbit.com/1/user/-/foods/log.json`
- Parameters: foodId, mealTypeId (1,2,3,4,5,7), unitId (304), amount (1), date (YYYY-MM-DD), time (HH:mm:ss)

**Fitbit error handling:**
- 401 Unauthorized: Refresh token and retry once
- 429 Rate Limited: Exponential backoff, max 3 retries
- 400 Bad Request: Return error to user for correction
- 403 Forbidden: Scope insufficient, prompt re-auth via settings

**Timeouts:** 10 seconds max per Fitbit request, 2 retries with exponential backoff on 5xx.

#### 3B: Review & Edit UI

**Analysis results display:**
- All analyzed fields in editable inputs
- Confidence indicator (high=green, medium=yellow, low=red)
- Claude's notes/assumptions
- "Edit Manually" mode toggle
- "Regenerate Analysis" button (re-runs Claude with same inputs)

**Meal type dropdown:**
- Breakfast (1), Morning Snack (2), Lunch (3), Afternoon Snack (4), Dinner (5), Anytime (7)

**"Log to Fitbit" button:** Primary action, disabled while request is in flight to prevent double-submits.

**Success confirmation:** Shows fitbitLogId and whether existing food was reused. User can immediately take another photo or close app.

---

### Iteration 4: Polish & PWA

Final iteration for error handling, mobile optimization, logging, and PWA setup.

#### Error Handling

**Frontend:**
- Network errors: Show retry button with clear message
- Validation errors: Inline field-level messages
- Session expired: Auto-redirect to landing page
- Fitbit token invalid: Inline prompt to reconnect
- Claude low confidence: Warning, allow proceeding or regenerating
- Image too large: Reject with size message

**Backend:**
- All errors: Log to console with request context
- Critical (token refresh failure, Claude API down): 503 Service Unavailable
- User errors (invalid input): 400 with specific error code
- Auth errors: 401/403 with clear instructions

#### Logging

```typescript
{
  timestamp: ISO8601,
  level: 'info' | 'warn' | 'error',
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  userId?: string,
  error?: string,
}
```

Log: All API requests, auth events, external API calls with status codes, food dedup events, errors with stack traces.
**Never log:** Cookie values, access tokens, images, user descriptions.

#### Mobile & PWA

- Touch-friendly: All buttons minimum 44px x 44px
- Mobile-first responsive design
- PWA manifest for "Add to Home Screen" (no service worker, no offline support):

```json
{
  "name": "Food Logger",
  "short_name": "FoodLog",
  "description": "AI-powered food logging for Fitbit",
  "start_url": "/app",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "orientation": "portrait",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

#### Performance Targets

| Metric | Target |
|--------|--------|
| Initial page load | < 2s |
| Camera open | < 500ms |
| `/api/analyze-food` | < 5s (Claude dependent) |
| `/api/log-food` | < 3s (search + create + log) |
| `/api/auth/session` | < 100ms |
| Token refresh | < 1s |

---

## Data Flow

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │ 1. User takes photo, adds description
       │    (client-side image compression)
       ▼
┌─────────────────────────┐
│  Next.js /app page      │
│  - Camera interface     │
│  - FormData upload      │
└──────┬──────────────────┘
       │ 2. POST /api/analyze-food (multipart/form-data)
       ▼
┌─────────────────────────┐
│  API Route Handler      │
│  - iron-session check   │
│  - Read image buffers   │
└──────┬──────────────────┘
       │ 3. Claude API tool_use call (images as base64)
       ▼
┌─────────────────────────┐
│  Claude Sonnet API      │
│  - Analyze images       │
│  - Return tool_use      │
│    structured result    │
└──────┬──────────────────┘
       │ 4. Extracted FoodAnalysis object
       ▼
┌─────────────────────────┐
│  Next.js /app page      │
│  - Display results      │
│  - Allow editing        │
└──────┬──────────────────┘
       │ 5. User confirms → POST /api/log-food
       ▼
┌─────────────────────────┐
│  API Route Handler      │
│  - iron-session check   │
│  - Refresh Fitbit token │
│    if needed            │
└──────┬──────────────────┘
       │ 6. Search existing foods (dedup)
       ▼
┌─────────────────────────┐
│  Fitbit API             │
│  - GET /foods.json      │
│    (search by name)     │
│  - POST /foods.json     │
│    (only if no match)   │
│  - POST /foods/log.json │
└──────┬──────────────────┘
       │ 7. { foodId, logId, reusedFood }
       ▼
┌─────────────────────────┐
│  Next.js /app page      │
│  - Show confirmation    │
└─────────────────────────┘
```

---

## Success Criteria

Application is functional when:

1. wall.lucas@gmail.com can login with Google + Fitbit in one flow
2. Any other email is rejected with clear error
3. Fitbit tokens stored securely in iron-session cookie
4. User can take photo with mobile camera
5. Photo + description sent to Claude via tool_use, structured JSON returned
6. Nutrition data displayed and editable
7. "Log to Fitbit" reuses existing food when possible, creates new only when needed
8. Food appears in Fitbit app within 1 minute
9. Session persists across browser restarts
10. Works on mobile Chrome and Safari
11. Settings page allows Fitbit reconnection and logout

---

## Out of Scope

- Multi-user support
- Database integration
- Food logging history view
- Export functionality
- Offline support
- Analytics/dashboard
- Meal planning
- Nutritional goal tracking
- Barcode scanning
- Recipe database
- Native mobile apps

---

End of Roadmap.
