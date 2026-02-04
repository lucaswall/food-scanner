# Food Logger Application - Roadmap

## Project Overview

Single-user web application for logging food to Fitbit using AI-powered nutritional analysis. User takes photos of food, adds optional text description, Claude Sonnet analyzes nutrition information, user confirms/edits, and data is posted directly to Fitbit API.

**Single authorized user:** wall.lucas@gmail.com

**No database required (initially):** All state managed via encrypted browser cookies (iron-session).

---

## Technology Stack

### Application
- **Framework:** Next.js 15+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui components
- **Session Management:** iron-session
- **Deployment:** Railway (single service, custom domain)

### External APIs
- **Google OAuth 2.0:** Authentication
- **Fitbit Web API:** Food logging destination
- **Anthropic Claude API:** Vision + text analysis via tool_use (claude-sonnet-4-20250514)

---

## Architecture Overview

Single Next.js application deployed on Railway behind a custom domain. API route handlers run server-side, keeping secrets off the client. Same-origin deployment eliminates CORS and cross-domain cookie issues. All routes except the landing page and health check require authentication — unauthenticated requests are rejected outright.

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

## Session Management with iron-session

### Why iron-session

Instead of rolling custom AES-256-GCM cookie encryption, use `iron-session` — a battle-tested library purpose-built for encrypted, stateless, httpOnly cookies in Next.js.

### How it works

iron-session uses the Iron protocol (from the hapi ecosystem):

1. **Sealing:** Takes a JavaScript object, serializes it to JSON, then encrypts it using AES-256-CBC and signs it with HMAC-SHA-256. The encryption key and HMAC key are both derived from a single password via PBKDF2.
2. **Unsealing:** Verifies the HMAC signature first (tamper detection), then decrypts the payload back to the original object.
3. **Cookie handling:** The sealed token is stored as a standard cookie. iron-session handles setting/reading/clearing it automatically within Next.js API routes and middleware.

### Integration

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
  password: process.env.SESSION_SECRET!,  // Min 32 characters
  cookieName: 'food-scanner-session',
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60,  // 30 days in seconds
    path: '/',
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
```

### Usage in API Route Handlers

```typescript
// In any route handler:
import { getSession } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getSession();

  if (!session.email) {
    return Response.json({ success: false, error: { code: 'AUTH_MISSING_SESSION' } }, { status: 401 });
  }

  // Use session.fitbit.accessToken, etc.
  // To update: session.fitbit = { ...newTokens }; await session.save();
  // To destroy: session.destroy();
}
```

### Advantages over custom encryption
- **No crypto code to write or maintain** — no IV generation, no auth tag handling, no hex encoding
- **Proven implementation** — used in production across thousands of Next.js apps
- **Automatic key derivation** — single password string, no manual 32-byte hex key management
- **Built-in tamper detection** — HMAC verification before decryption
- **Native Next.js integration** — works with App Router `cookies()` API directly

---

## Authentication & Authorization

### Login Flow (Google OAuth + Fitbit)

**Requirement:** Only allow wall.lucas@gmail.com to access the application.

On first login, the user completes both Google authentication and Fitbit authorization in a single flow. On subsequent visits, the session cookie handles everything. If Fitbit tokens expire and refresh fails, the user is prompted to reconnect Fitbit inline (not forced through the full login again).

**Flow:**
1. User visits landing page, clicks "Login with Google"
2. Browser redirects to Google OAuth 2.0 authorization URL
3. User authenticates with Google
4. Google redirects to `/api/auth/google/callback` route handler
5. Route handler exchanges code for user profile
6. Route handler validates: `profile.email === 'wall.lucas@gmail.com'`
   - If no match: Return 403 error "Unauthorized email address"
   - If match: Create iron-session with user data
7. Check if session already has valid Fitbit tokens
   - If yes: Redirect to `/app`
   - If no: Redirect to Fitbit OAuth authorization URL
8. User authenticates with Fitbit, grants nutrition scope
9. Fitbit redirects to `/api/auth/fitbit/callback` route handler
10. Route handler stores Fitbit tokens in session, redirects to `/app`

### Session Structure

```typescript
interface SessionData {
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
```

### On-Demand Fitbit Reconnection

If a Fitbit API call fails because tokens are invalid and refresh also fails, the API returns `FITBIT_TOKEN_INVALID`. The frontend shows an inline prompt: "Fitbit connection expired. Reconnect?" which triggers the Fitbit OAuth flow only (no Google re-auth needed).

---

## Food Logging Flow

### Step 1: Photo Capture

**Frontend Component Requirements:**
- Native file input with `accept="image/*"` and `capture="environment"`
- Support 1-3 photos (multi-select enabled)
- Client-side image compression (resize to ~1024px max dimension, 80% JPEG quality via `<canvas>`)
- Preview thumbnails of selected photos
- Text area for optional description (placeholder: "e.g., 250g pollo asado con chimichurri")
- Clear/retake functionality

**No photo persistence:** Photos kept in browser memory only until analysis complete.

### Step 2: AI Analysis

**API Route:** `POST /api/analyze-food`

**Request:** `multipart/form-data`
- `images`: Image files (1-3, compressed client-side)
- `description`: User's text description

**Route Handler Processing:**
1. Validate session (via iron-session)
2. Check Fitbit connection exists (prompt reconnect if not)
3. Read image files as buffers, convert to base64 for Claude API
4. Call Claude API using tool_use for structured output
5. Extract tool call result
6. Return to frontend

**Claude API Integration — tool_use:**

Instead of prompting Claude for raw JSON (which can include markdown fences or preamble), use the Anthropic SDK's `tool_use` feature. This guarantees structured output matching the defined schema.

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

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
        food_name: {
          type: 'string',
          description: 'Clear name of the food in Spanish or English'
        },
        portion_size_g: {
          type: 'number',
          description: 'Estimated weight in grams'
        },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        fiber_g: { type: 'number' },
        sodium_mg: { type: 'number' },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low']
        },
        notes: {
          type: 'string',
          description: 'Brief explanation of assumptions made'
        }
      },
      required: ['food_name', 'portion_size_g', 'calories', 'protein_g',
                  'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'confidence', 'notes']
    }
  }],
  tool_choice: { type: 'tool', name: 'report_nutrition' },
  messages: [{
    role: 'user',
    content: [
      // Image content blocks (base64)
      ...images.map(img => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType, data: img.base64 }
      })),
      // Text description
      { type: 'text' as const, text: description || 'Analyze this food.' }
    ]
  }]
});

// Extract structured result — guaranteed to match the schema
const toolUseBlock = response.content.find(block => block.type === 'tool_use');
const nutrition: FoodAnalysis = toolUseBlock.input;
```

**Why tool_use instead of prompting for JSON:**
- **Schema-enforced output** — Claude must return data matching the defined properties and types
- **No parsing ambiguity** — no need to strip markdown fences, handle preamble text, or regex-extract JSON
- **`tool_choice: { type: 'tool', name: 'report_nutrition' }`** forces Claude to use the tool (no "I can't analyze this" text responses)
- **Type-safe** — the `input` field maps directly to the TypeScript interface

**Response:**
```typescript
{
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
```

### Step 3: Review & Edit

**Frontend Component Requirements:**
- Display all analyzed fields in editable inputs
- Show confidence level with visual indicator (high=green, medium=yellow, low=red)
- Display Claude's notes/assumptions
- Dropdown for meal type selection:
  - Breakfast (mealTypeId: 1)
  - Morning Snack (mealTypeId: 2)
  - Lunch (mealTypeId: 3)
  - Afternoon Snack (mealTypeId: 4)
  - Dinner (mealTypeId: 5)
  - Anytime (mealTypeId: 7)
- "Regenerate Analysis" button (re-runs Claude with same inputs)
- "Edit Manually" mode toggle
- "Log to Fitbit" primary action button (disabled while request is in flight to prevent double-submits)

### Step 4: Post to Fitbit

**API Route:** `POST /api/log-food`

**Request:**
```typescript
{
  food_name: string;
  portion_size_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  mealTypeId: number;      // 1,2,3,4,5,7
  date?: string;           // YYYY-MM-DD, defaults to today
  time?: string;           // HH:mm:ss, defaults to now
}
```

**Route Handler Processing:**
1. Validate session (via iron-session)
2. Check Fitbit token expiry, refresh if needed (update session)
3. Search existing custom foods for a match (deduplication)
4. If match found: reuse existing foodId
5. If no match: create new custom food via Fitbit API
6. Log food entry using the foodId
7. Return success confirmation

**Response:**
```typescript
{
  success: boolean;
  fitbitFoodId: number;     // Created or reused food ID
  fitbitLogId: number;      // Log entry ID
  reusedFood: boolean;      // Whether an existing food was reused
  error?: string;           // If failed
}
```

---

## Fitbit API Integration

### Authentication
- **OAuth 2.0** with PKCE (Proof Key for Code Exchange)
- **Scope Required:** `nutrition`
- **Token Lifetime:** 8 hours
- **Refresh Mechanism:** Automatic before each API call if token expires within 1 hour

### Token Refresh Flow
```typescript
// Before each Fitbit API call:
if (fitbitToken.expiresAt < Date.now() + 3600000) {
  // Refresh if expiring within 1 hour
  const newTokens = await refreshFitbitToken(fitbitToken.refreshToken);
  // Update iron-session with new tokens
  session.fitbit = { ...session.fitbit, ...newTokens };
  await session.save();
}
```

If refresh fails (e.g., refresh token revoked), return `FITBIT_TOKEN_INVALID` to the frontend, which prompts the user to reconnect via `/settings`.

### Food Deduplication

Before creating a new custom food, search the user's existing custom foods:

**Search Endpoint:** `GET https://api.fitbit.com/1/user/-/foods.json?query={food_name}`

**Matching logic:**
1. Search Fitbit for foods matching the name
2. Compare name (case-insensitive) and calorie count (within 10% tolerance)
3. If a match is found, reuse its `foodId` instead of creating a duplicate
4. If no match, create a new custom food

```typescript
async function findOrCreateFood(session: SessionData, food: FoodAnalysis): Promise<number> {
  const searchResults = await fitbitGet(
    `/1/user/-/foods.json?query=${encodeURIComponent(food.food_name)}`,
    session.fitbit!.accessToken
  );

  // Check for existing match
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

### API Endpoint: Create Custom Food

**Fitbit Endpoint:** `POST https://api.fitbit.com/1/user/-/foods.json`

**Headers:**
```
Authorization: Bearer {fitbit_access_token}
Content-Type: application/x-www-form-urlencoded
```

**Request Parameters:**
```
name: string                           // Food name
defaultFoodMeasurementUnitId: 304      // 304 = "serving"
defaultServingSize: 1
calories: number
description: string                    // Optional notes
formType: LIQUID | DRY                 // Use DRY for solid foods
protein: number                        // grams
carbs: number                          // grams (total carbohydrates)
fat: number                            // grams
fiber: number                          // grams
sodium: number                         // milligrams
```

### API Endpoint: Log Food Entry

**Fitbit Endpoint:** `POST https://api.fitbit.com/1/user/-/foods/log.json`

**Headers:**
```
Authorization: Bearer {fitbit_access_token}
Content-Type: application/x-www-form-urlencoded
```

**Request Parameters:**
```
foodId: number                    // From search or create
mealTypeId: number                // 1,2,3,4,5,7
unitId: 304                       // 304 = "serving"
amount: 1
date: YYYY-MM-DD
time: HH:mm:ss                    // 24-hour format
```

### Error Handling
- **401 Unauthorized:** Token expired → Refresh token and retry once
- **429 Rate Limited:** Back off exponentially, max 3 retries
- **400 Bad Request:** Invalid data → Return error to user for correction
- **403 Forbidden:** Scope insufficient → Prompt re-authentication via settings

---

## Environment Variables

### Railway Environment
```
# Server
PORT=3000
NODE_ENV=production

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Fitbit OAuth
FITBIT_CLIENT_ID=your-fitbit-client-id
FITBIT_CLIENT_SECRET=your-fitbit-client-secret

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Session (iron-session password, min 32 characters)
SESSION_SECRET=at-least-32-characters-long-random-string

# Auth
ALLOWED_EMAIL=wall.lucas@gmail.com
```

### Local Development (.env.local)
```
# Same variables as above, with local callback URLs
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
FITBIT_REDIRECT_URI=http://localhost:3000/api/auth/fitbit/callback
```

Note: No `NEXT_PUBLIC_API_URL` or `COOKIE_DOMAIN` needed — all API calls use same-origin relative paths (`/api/...`) and cookies are same-origin.

---

## Security Requirements

### Authentication Enforcement
All routes except the landing page (`/`) and health check (`/api/health`) require a valid iron-session cookie. Unauthenticated requests receive a 401 response immediately. There is no public API surface for unauthenticated users to abuse, so no rate limiting is needed.

### Auth Middleware
Use Next.js middleware (`middleware.ts`) to enforce authentication on all protected routes in one place:

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/app/:path*', '/settings/:path*', '/api/((?!health|auth).*)'],
};

export async function middleware(request: NextRequest) {
  // Check for session cookie existence
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

Note: The middleware checks cookie existence as a fast-path. Route handlers still validate the session contents via iron-session (unsealing + expiry check).

### Input Validation
- **Images:** Max 10MB per image, max 3 images, only JPEG/PNG
- **Client-side compression:** Resize to ~1024px max dimension, 80% JPEG quality before upload
- **Text descriptions:** Max 500 characters
- **Nutritional values:** Positive numbers only, reasonable ranges (calories 0-5000, protein 0-300g, etc.)

### Cookie Security (handled by iron-session)
- httpOnly, secure, sameSite: strict — configured in session options
- Auto-expire sessions after 30 days
- Clear cookie on explicit logout (`session.destroy()`)
- Rotate `SESSION_SECRET` if compromised (invalidates all sessions)

---

## API Response Standards

### Success Response
```typescript
{
  success: true,
  data: any,            // The actual response payload
  timestamp: number     // Unix timestamp
}
```

### Error Response
```typescript
{
  success: false,
  error: {
    code: string,       // Machine-readable error code
    message: string,    // Human-readable message
    details?: any       // Optional additional context
  },
  timestamp: number
}
```

### Error Codes
- `AUTH_INVALID_EMAIL` - Email not in whitelist
- `AUTH_SESSION_EXPIRED` - Session cookie expired
- `AUTH_MISSING_SESSION` - No session cookie present
- `FITBIT_NOT_CONNECTED` - User hasn't linked Fitbit
- `FITBIT_TOKEN_INVALID` - Token refresh failed, user must reconnect
- `CLAUDE_API_ERROR` - Claude API returned error
- `FITBIT_API_ERROR` - Fitbit API returned error
- `VALIDATION_ERROR` - Invalid input data

---

## Route Structure

### Pages (App Router)
```
/                           # Public landing page
  - Hero section
  - "Login with Google" button
  - Brief feature explanation

/app                        # Protected route (requires valid session)
  - Camera interface
  - Food logging workflow

/settings                   # Protected route
  - Reconnect Fitbit account
  - Logout (wipe session cookie)
```

### API Route Handlers (Server-side)
```
GET  /api/health                     # Health check (public)
POST /api/auth/google                # Initiate Google OAuth (public)
GET  /api/auth/google/callback       # Google OAuth callback (public)
POST /api/auth/fitbit                # Initiate Fitbit OAuth (protected)
GET  /api/auth/fitbit/callback       # Fitbit OAuth callback (protected)
GET  /api/auth/session               # Validate current session (protected)
POST /api/auth/logout                # Destroy session cookie (protected)
POST /api/analyze-food               # Claude analysis (protected, multipart/form-data)
POST /api/log-food                   # Post to Fitbit (protected)
```

---

## User Experience Flow

### First-Time Login
1. User navigates to application URL (custom domain)
2. Sees landing page with "Login with Google" button
3. Clicks button → Google OAuth
4. Selects wall.lucas@gmail.com account → grants permissions
5. Backend validates email, creates session
6. No Fitbit tokens in session → automatically redirects to Fitbit OAuth
7. User authenticates with Fitbit → grants nutrition scope
8. Backend stores Fitbit tokens in session → redirects to `/app`
9. User sees camera interface, ready to log food

### Returning User (Session Valid)
1. User navigates to application (session cookie present)
2. Middleware allows access → `/app` loads directly
3. Camera interface ready

### Returning User (Fitbit Token Expired)
1. User tries to log food
2. Backend attempts Fitbit token refresh
3. If refresh succeeds: transparent, user doesn't notice
4. If refresh fails: API returns `FITBIT_TOKEN_INVALID`
5. Frontend shows inline prompt: "Fitbit connection expired. Reconnect?"
6. User clicks → Fitbit OAuth only (no Google re-auth)
7. Returns to `/app` with fresh tokens

### Daily Food Logging
1. Taps "Take Photo" button → camera opens
2. Takes photo of meal
3. Optionally adds text: "milanesa napolitana"
4. Taps "Analyze" button
5. Waits for loading indicator
6. Sees results with confidence indicator
7. Reviews/edits values
8. Selects meal type from dropdown
9. Taps "Log to Fitbit" (button disabled while in flight)
10. Sees success confirmation (notes if existing food was reused)
11. Can immediately take another photo or close app

---

## Data Flow Diagram

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

## TypeScript Type Definitions

### Shared Types

```typescript
// Food analysis from Claude (matches tool_use schema)
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

// Food log request
interface FoodLogRequest extends FoodAnalysis {
  mealTypeId: number;  // 1,2,3,4,5,7
  date?: string;       // YYYY-MM-DD
  time?: string;       // HH:mm:ss
}

// Food log response
interface FoodLogResponse {
  success: boolean;
  fitbitFoodId: number;
  fitbitLogId: number;
  reusedFood: boolean;
  error?: string;
}

// Fitbit meal types
enum FitbitMealType {
  Breakfast = 1,
  MorningSnack = 2,
  Lunch = 3,
  AfternoonSnack = 4,
  Dinner = 5,
  Anytime = 7
}

// Session data structure (stored in iron-session cookie)
interface SessionData {
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

// API standard responses
interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: number;
}

interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: number;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
```

---

## Mobile Responsiveness Requirements

### Critical Mobile Features
- **Camera Access:** Native camera integration via `<input capture>`
- **Touch-Friendly:** All buttons minimum 44px x 44px
- **Viewport:** Responsive design, mobile-first approach
- **Add to Home Screen:** PWA manifest for home screen shortcut (bookmark-style, no service worker)

### PWA Manifest
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
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

Note: No service worker or offline support. The app requires network connectivity for Claude analysis and Fitbit API calls. The manifest exists solely for the "Add to Home Screen" shortcut on mobile.

---

## Settings Page

### `/settings` Route (Protected)

Simple page with account management actions:

- **Fitbit Connection Status** — shows whether Fitbit is connected, token expiry info
  - "Reconnect Fitbit" button — triggers Fitbit OAuth flow, returns to `/settings`
- **Logout** — destroys iron-session cookie, redirects to landing page

This page is the fallback for managing Fitbit connectivity outside the main food logging flow.

---

## Error Handling Strategy

### Frontend Error Handling
- **Network Errors:** Show retry button with clear message
- **Validation Errors:** Inline field-level error messages
- **Session Expired:** Auto-redirect to landing page with message
- **Fitbit Token Invalid:** Inline prompt to reconnect (link to settings or direct OAuth)
- **Claude Low Confidence:** Show warning, allow proceeding or regenerating
- **Image Too Large:** Compress before upload or reject with size message

### Backend Error Handling
- **All Errors:** Log to console with request context
- **Critical Errors:** (Token refresh failures, Claude API down) Return 503 Service Unavailable
- **User Errors:** (Invalid input) Return 400 with specific error code
- **Auth Errors:** Return 401/403 with clear instructions

---

## Logging Requirements

### Log Format
```typescript
{
  timestamp: ISO8601,
  level: 'info' | 'warn' | 'error',
  method: string,
  path: string,
  statusCode: number,
  duration: number,  // milliseconds
  userId?: string,   // If authenticated
  error?: string     // If error occurred
}
```

### What to Log
- All API requests (method, path, status, duration)
- Authentication events (login, logout, token refresh)
- External API calls (Claude, Fitbit) with status codes
- Food deduplication events (reused vs. created)
- Errors with full stack traces
- DO NOT LOG: Cookie values, access tokens, images, user descriptions

---

## Performance Requirements

### Frontend
- **Initial Page Load:** < 2 seconds
- **Camera Open:** < 500ms
- **API Response Display:** < 100ms after receiving data

### API Route Handlers
- **`/api/analyze-food`:** < 5 seconds (depends on Claude API)
- **`/api/log-food`:** < 3 seconds (includes food search + create/log)
- **`/api/auth/session`:** < 100ms
- **Token Refresh:** < 1 second

### Claude API
- **Timeout:** 30 seconds max
- **Retry Logic:** 1 retry on timeout, then fail

### Fitbit API
- **Timeout:** 10 seconds max per request
- **Retry Logic:** 2 retries with exponential backoff on 5xx errors

---

## Cost Estimates

### Railway (Application)
- **Tier:** Hobby ($5/month credit)
- **Resources:** 512MB RAM, shared CPU
- **Expected Usage:** ~$2-3/month
- **Cost:** $5/month (with unused credits)

### Claude API
- **Model:** claude-sonnet-4-20250514
- **Usage:** ~10 food logs/day x 30 days = 300 requests/month
- **Cost per request:** ~$0.002 (with images)
- **Monthly:** ~$0.60

### Fitbit API
- **Cost:** Free (no usage charges)

### Custom Domain
- **Cost:** Varies (~$10-15/year)

### Total Monthly Cost: ~$6-7/month

---

## Development Setup

### Prerequisites
- Node.js 20+
- npm or pnpm
- Git
- Railway CLI (for deployment)

### Local Development
```bash
npm run dev    # Runs on localhost:3000
```

### Environment Files
```
.env.local     # All secrets for local development
```

---

## Deployment Configuration

### Railway
- **Build Command:** `npm run build` (runs `next build`)
- **Start Command:** `npm start` (runs `next start`)
- **Node Version:** 20.x
- **Health Check:** `GET /api/health` returns 200
- **Framework:** Next.js (auto-detected by Railway)
- **Custom Domain:** Configured in Railway dashboard, DNS pointed to Railway

---

## Project Structure

```
food-scanner/
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Landing page (public)
│   ├── app/
│   │   └── page.tsx                  # Protected food logging page
│   ├── settings/
│   │   └── page.tsx                  # Settings (reconnect Fitbit, logout)
│   └── api/
│       ├── health/route.ts           # Health check
│       ├── auth/
│       │   ├── google/route.ts       # Initiate Google OAuth
│       │   ├── google/callback/route.ts
│       │   ├── fitbit/route.ts       # Initiate Fitbit OAuth
│       │   ├── fitbit/callback/route.ts
│       │   ├── session/route.ts      # Validate session
│       │   └── logout/route.ts       # Destroy session
│       ├── analyze-food/route.ts     # Claude tool_use analysis
│       └── log-food/route.ts         # Fitbit search + create + log
├── components/                       # React components
├── lib/
│   ├── session.ts                    # iron-session config + getSession()
│   ├── claude.ts                     # Claude API client (tool_use)
│   ├── fitbit.ts                     # Fitbit API client (search, create, log, refresh)
│   └── auth.ts                       # OAuth helpers (Google, Fitbit)
├── middleware.ts                     # Auth enforcement for protected routes
├── types/                            # Shared TypeScript types
├── public/
│   ├── manifest.json                 # PWA manifest (home screen shortcut only)
│   ├── icon-192.png
│   └── icon-512.png
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── ROADMAP.md
```

---

## Testing Requirements

### Frontend Testing
- **Manual Testing:** Camera capture on real mobile device
- **Edge Cases:** Large images, no text description, slow network
- **Browser Compatibility:** Chrome Mobile, Safari iOS

### Backend Testing
- **Unit Tests:** iron-session integration, Fitbit food deduplication logic
- **Integration Tests:** OAuth flows (with mock services)
- **Manual Testing:** Full food logging flow, food reuse verification
- **Error Scenarios:** Invalid tokens, Claude API failures, Fitbit reconnect flow

---

## Critical Success Criteria

Application is considered functional when:

1. wall.lucas@gmail.com can successfully login with Google + Fitbit in one flow
2. Any other email is rejected with clear error
3. Fitbit tokens are stored securely in iron-session cookie
4. User can take photo with mobile camera
5. Photo + description are sent to Claude via tool_use and structured JSON is returned
6. Nutrition data is displayed and editable
7. "Log to Fitbit" reuses existing food when possible, creates new only when needed
8. Food appears in Fitbit app within 1 minute
9. Session persists across browser restarts (cookie valid)
10. Application works on mobile Chrome and Safari via custom domain
11. Settings page allows Fitbit reconnection and logout

---

## Non-Functional Requirements

### Reliability
- **Uptime Target:** 99% (Railway hobby tier limitations accepted)
- **Data Loss Prevention:** No data stored = no data to lose
- **Graceful Degradation:** If Fitbit is down, show clear error (don't crash)

### Scalability
- **Current:** Single user (wall.lucas@gmail.com)
- **Not Required:** Horizontal scaling, load balancing, caching
- **Future:** Railway supports adding PostgreSQL/Redis when needed

### Maintainability
- **Code Quality:** TypeScript strict mode, ESLint, Prettier
- **Documentation:** Inline comments for complex logic only
- **Dependency Updates:** Review monthly for security patches

### Accessibility
- **Minimum:** WCAG 2.1 Level A
- **Focus:** Keyboard navigation, screen reader labels on buttons
- **Not Priority:** Full AA compliance (single user app)

---

## Out of Scope

The following are explicitly NOT part of this initial build:

- Multi-user support (only wall.lucas@gmail.com)
- Database integration
- Food logging history view
- Export functionality
- Offline support (requires Claude API)
- Manual Lumen reading entry
- Analytics/dashboard
- Meal planning features
- Nutritional goal tracking
- Barcode scanning
- Recipe database
- Social features
- Admin panel
- Email notifications
- Mobile native apps (iOS/Android)

---

End of Roadmap.
