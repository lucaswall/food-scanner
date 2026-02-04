# Food Logger Application - Roadmap

## Project Overview

Single-user web application for logging food to Fitbit using AI-powered nutritional analysis. User takes photos of food, adds optional text description, Claude Sonnet analyzes nutrition information, user confirms/edits, and data is posted directly to Fitbit API.

**Single authorized user:** wall.lucas@gmail.com

**No database required (initially):** All state managed via encrypted browser cookies.

---

## Technology Stack

### Application
- **Framework:** Next.js 15+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui components
- **Deployment:** Railway (single service)

### External APIs
- **Google OAuth 2.0:** Authentication
- **Fitbit Web API:** Food logging destination
- **Anthropic Claude API:** Vision + text analysis (claude-sonnet-4-20250514)

---

## Architecture Overview

Single Next.js application deployed on Railway. API route handlers run server-side, keeping secrets off the client. Same-origin deployment eliminates CORS and cross-domain cookie issues.

```
┌─────────────────────────────────────────────────────────────┐
│                  Browser (Chrome/Safari)                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Next.js App (Railway)                         │  │
│  │  - Landing page (public)                              │  │
│  │  - /app route (protected, camera interface)           │  │
│  │  - /api/* route handlers (server-side)                │  │
│  │  - Google/Fitbit OAuth callback handlers              │  │
│  └───────────────────┬───────────────────────────────────┘  │
│                      │ Same-origin API calls (/api/...)     │
│  Encrypted Cookie ◄──┴──► Session + Fitbit Tokens           │
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

## Authentication & Authorization

### Google OAuth Flow

**Requirement:** Only allow wall.lucas@gmail.com to access the application.

**Flow:**
1. User visits landing page, clicks "Login with Google"
2. Browser redirects to Google OAuth 2.0 authorization URL
3. User authenticates with Google
4. Google redirects to `/api/auth/google/callback` route handler
5. Route handler exchanges code for user profile
6. Route handler validates: `profile.email === 'wall.lucas@gmail.com'`
   - If match: Create encrypted session cookie, redirect to `/app`
   - If no match: Return 403 error "Unauthorized email address"

**Session Cookie Structure:**
```typescript
interface SessionCookie {
  sessionId: string;        // Random UUID
  email: string;            // wall.lucas@gmail.com
  createdAt: number;        // Unix timestamp
  expiresAt: number;        // Unix timestamp (30 days from creation)
}
```

### Fitbit OAuth Flow

**Flow:**
1. User clicks "Connect Fitbit" inside protected `/app` route
2. Browser redirects to Fitbit OAuth 2.0 authorization URL
3. User authenticates with Fitbit, grants permissions
4. Fitbit redirects to `/api/auth/fitbit/callback` route handler
5. Route handler exchanges code for access token + refresh token
6. Route handler updates encrypted session cookie with Fitbit credentials
7. Redirect back to `/app`

**Updated Cookie Structure After Fitbit:**
```typescript
interface SessionCookieWithFitbit extends SessionCookie {
  fitbit: {
    accessToken: string;      // Fitbit API access token
    refreshToken: string;     // For token renewal
    userId: string;           // Fitbit user ID
    expiresAt: number;        // Token expiry timestamp
  };
}
```

---

## Cookie Encryption Specification

### Encryption Method
- **Algorithm:** AES-256-GCM
- **Key Storage:** Railway environment variable `COOKIE_ENCRYPTION_KEY` (32-byte hex string)
- **Initialization Vector:** Random 16 bytes per encryption operation
- **Authentication Tag:** 16 bytes (GCM mode provides this)

### Cookie Configuration
```typescript
const cookieOptions = {
  httpOnly: true,           // Not accessible via JavaScript
  secure: true,             // HTTPS only
  sameSite: 'strict',       // CSRF protection (works: same-origin)
  maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 days
  path: '/',
};
```

### Encryption Process
1. Serialize cookie object to JSON string
2. Generate random 16-byte IV
3. Encrypt JSON with AES-256-GCM using key + IV
4. Concatenate: `IV:authTag:encryptedData` (all hex-encoded)
5. Set as cookie value

### Decryption Process
1. Read cookie value
2. Split into IV, authTag, encryptedData
3. Decrypt using key + IV
4. Verify authentication tag
5. Parse JSON back to object
6. Validate expiry timestamps

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
1. Validate session cookie
2. Read image files as buffers, convert to base64 for Claude API
3. Construct Claude API request with vision model
4. Send images + description
5. Parse Claude JSON response
6. Return to frontend

**Claude API Integration:**

**System Prompt:**
```
You are a nutrition analyst specializing in Argentine and Latin American cuisine.
Analyze food images and descriptions to provide accurate nutritional information.
Consider typical Argentine portions and preparation methods.
```

**User Message Format:**
```
[Image 1]
[Image 2] (if multiple)
[Image 3] (if multiple)

Description: {user's text input}

Provide nutritional analysis in the following JSON format ONLY (no markdown, no explanation):
{
  "food_name": "Clear name in Spanish or English",
  "portion_size_g": estimated_weight_in_grams,
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "fiber_g": number,
  "sodium_mg": number,
  "confidence": "high" | "medium" | "low",
  "notes": "Brief explanation of assumptions made"
}
```

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
- "Log to Fitbit" primary action button

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
1. Validate session cookie
2. Check Fitbit token expiry, refresh if needed
3. Call Fitbit Create Food API
4. Call Fitbit Log Food API
5. Return success confirmation

**Response:**
```typescript
{
  success: boolean;
  fitbitFoodId: number;     // Created food ID
  fitbitLogId: number;      // Log entry ID
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
  // Update encrypted cookie with new tokens
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

**Response:**
```json
{
  "food": {
    "foodId": 123456789,
    "name": "Pollo Asado",
    "calories": 420,
    ...
  }
}
```

**Extract:** `food.foodId` for next step

### API Endpoint: Log Food Entry

**Fitbit Endpoint:** `POST https://api.fitbit.com/1/user/-/foods/log.json`

**Headers:**
```
Authorization: Bearer {fitbit_access_token}
Content-Type: application/x-www-form-urlencoded
```

**Request Parameters:**
```
foodId: number                    // From create food response
mealTypeId: number                // 1,2,3,4,5,7
unitId: 304                       // 304 = "serving"
amount: 1
date: YYYY-MM-DD
time: HH:mm:ss                    // 24-hour format
```

**Response:**
```json
{
  "foodLog": {
    "logId": 987654321,
    "logDate": "2026-02-03",
    "nutritionalValues": {
      "calories": 420,
      ...
    }
  }
}
```

### Error Handling
- **401 Unauthorized:** Token expired → Refresh token and retry
- **429 Rate Limited:** Back off exponentially, max 3 retries
- **400 Bad Request:** Invalid data → Return error to user for correction
- **403 Forbidden:** Scope insufficient → Prompt re-authentication

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

# Security
COOKIE_ENCRYPTION_KEY=64-character-hex-string-generated-once
ALLOWED_EMAIL=wall.lucas@gmail.com
```

### Local Development (.env.local)
```
# Same variables as above, with local callback URLs
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
FITBIT_REDIRECT_URI=http://localhost:3000/api/auth/fitbit/callback
```

Note: `NEXT_PUBLIC_API_URL` is not needed — all API calls use same-origin relative paths (`/api/...`).

---

## Security Requirements

### Input Validation
- **Images:** Max 10MB per image, max 3 images, only JPEG/PNG
- **Client-side compression:** Resize to ~1024px max dimension, 80% JPEG quality before upload
- **Text descriptions:** Max 500 characters
- **Nutritional values:** Positive numbers only, reasonable ranges (calories 0-5000, protein 0-300g, etc.)

### Rate Limiting
- **Per IP:** 100 requests/hour for unauthenticated routes
- **Per Session:** 50 food logs/day (prevents accidental loops)

### Auth Middleware
Use Next.js middleware (`middleware.ts`) to protect `/app` and `/api/*` routes (except auth callbacks and health check) in one place, rather than checking the session in every route handler.

### Cookie Security
- Never log cookie contents
- Rotate encryption key if compromised (requires re-login)
- Auto-expire sessions after 30 days
- Clear cookie on explicit logout

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
- `FITBIT_TOKEN_INVALID` - Token refresh failed
- `CLAUDE_API_ERROR` - Claude API returned error
- `CLAUDE_PARSE_ERROR` - Could not parse Claude JSON response
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
  - Privacy notice

/app                        # Protected route (requires valid session)
  - Redirect to / if not authenticated
  - Camera interface
  - Food logging workflow
  - Logout button
```

### API Route Handlers (Server-side)
```
GET  /api/health                     # Health check endpoint
POST /api/auth/google                # Initiate Google OAuth
GET  /api/auth/google/callback       # Google OAuth callback
POST /api/auth/fitbit                # Initiate Fitbit OAuth
GET  /api/auth/fitbit/callback       # Fitbit OAuth callback
GET  /api/auth/session               # Validate current session
POST /api/auth/logout                # Clear session cookie
POST /api/analyze-food               # Claude analysis (multipart/form-data)
POST /api/log-food                   # Post to Fitbit
```

---

## User Experience Flow

### First-Time User Journey
1. User navigates to application URL
2. Sees landing page with "Login with Google" button
3. Clicks button → Google OAuth popup
4. Selects wall.lucas@gmail.com account → grants permissions
5. Redirected to `/app` route
6. Sees prompt: "Connect your Fitbit account to start logging food"
7. Clicks "Connect Fitbit" → Fitbit OAuth popup
8. Logs into Fitbit → grants nutrition scope
9. Redirected back to `/app`
10. Sees camera interface, ready to log food

### Daily Food Logging Journey
1. User navigates to application (already logged in via cookie)
2. Automatically directed to `/app`
3. Taps "Take Photo" button → camera opens
4. Takes photo of meal
5. Optionally adds text: "milanesa napolitana"
6. Taps "Analyze" button
7. Waits for loading indicator
8. Sees results:
   - Food name: "Milanesa Napolitana"
   - Calories: 850
   - Protein: 45g
   - Carbs: 65g
   - Fat: 48g
   - Fiber: 4g
   - Sodium: 920mg
   - Confidence: High
9. Reviews values, edits carbs from 65g to 70g
10. Selects "Lunch" from meal type dropdown
11. Taps "Log to Fitbit" button
12. Sees success confirmation
13. Can immediately take another photo or close app

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
│  - Decrypt cookie       │
│  - Validate session     │
│  - Read image buffers   │
└──────┬──────────────────┘
       │ 3. Call Claude API (images as base64)
       ▼
┌─────────────────────────┐
│  Claude Sonnet API      │
│  - Analyze images       │
│  - Return nutrition     │
└──────┬──────────────────┘
       │ 4. Return JSON
       ▼
┌─────────────────────────┐
│  API Route Handler      │
│  - Parse response       │
│  - Return to client     │
└──────┬──────────────────┘
       │ 5. Display results
       ▼
┌─────────────────────────┐
│  Next.js /app page      │
│  - Display results      │
│  - Allow editing        │
└──────┬──────────────────┘
       │ 6. User confirms → POST /api/log-food
       ▼
┌─────────────────────────┐
│  API Route Handler      │
│  - Decrypt cookie       │
│  - Get Fitbit tokens    │
│  - Refresh if needed    │
└──────┬──────────────────┘
       │ 7. Create custom food + log entry
       ▼
┌─────────────────────────┐
│  Fitbit API             │
│  - POST /foods.json     │
│  - POST /foods/log.json │
└──────┬──────────────────┘
       │ 8. { foodId, logId }
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
// Food analysis from Claude
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

// Fitbit meal types
enum FitbitMealType {
  Breakfast = 1,
  MorningSnack = 2,
  Lunch = 3,
  AfternoonSnack = 4,
  Dinner = 5,
  Anytime = 7
}

// Session data structure
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
- **PWA Manifest:** Allow "Add to Home Screen" functionality
- **Offline Warning:** Show clear message if network unavailable

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

---

## Error Handling Strategy

### Frontend Error Handling
- **Network Errors:** Show retry button with clear message
- **Validation Errors:** Inline field-level error messages
- **Session Expired:** Auto-redirect to landing page with message
- **Claude Low Confidence:** Show warning, allow proceeding or regenerating
- **Image Too Large:** Compress before upload or reject with size message

### Backend Error Handling
- **All Errors:** Log to console with request context
- **Critical Errors:** (Token refresh failures, Claude API down) Return 503 Service Unavailable
- **User Errors:** (Invalid input) Return 400 with specific error code
- **Auth Errors:** Return 401/403 with clear instructions
- **Rate Limiting:** Return 429 with retry-after header

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
- **`/api/log-food`:** < 2 seconds
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

### Total Monthly Cost: ~$5.60

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

---

## Project Structure

```
food-scanner/
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Landing page (public)
│   ├── app/
│   │   └── page.tsx                  # Protected food logging page
│   └── api/
│       ├── health/route.ts           # Health check
│       ├── auth/
│       │   ├── google/route.ts       # Initiate Google OAuth
│       │   ├── google/callback/route.ts
│       │   ├── fitbit/route.ts       # Initiate Fitbit OAuth
│       │   ├── fitbit/callback/route.ts
│       │   ├── session/route.ts      # Validate session
│       │   └── logout/route.ts       # Clear session
│       ├── analyze-food/route.ts     # Claude analysis
│       └── log-food/route.ts         # Fitbit logging
├── components/                       # React components
├── lib/
│   ├── cookies.ts                    # AES-256-GCM encrypt/decrypt
│   ├── claude.ts                     # Claude API client
│   ├── fitbit.ts                     # Fitbit API client
│   └── auth.ts                       # OAuth helpers
├── middleware.ts                     # Auth middleware for protected routes
├── types/                            # Shared TypeScript types
├── public/
│   ├── manifest.json                 # PWA manifest
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
- **Unit Tests:** Cookie encryption/decryption
- **Integration Tests:** OAuth flows (with mock services)
- **Manual Testing:** Full food logging flow
- **Error Scenarios:** Invalid tokens, Claude API failures, network timeouts

---

## Critical Success Criteria

Application is considered functional when:

1. wall.lucas@gmail.com can successfully login with Google
2. Any other email is rejected with clear error
3. User can complete Fitbit OAuth and tokens are encrypted in cookie
4. User can take photo with mobile camera
5. Photo + description are sent to Claude and valid JSON is returned
6. Nutrition data is displayed and editable
7. "Log to Fitbit" successfully creates food + logs entry
8. Food appears in Fitbit app within 1 minute
9. Session persists across browser restarts (cookie valid)
10. Application works on mobile Chrome and Safari

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
