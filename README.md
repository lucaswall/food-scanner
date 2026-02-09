# Food Scanner

AI-powered food logging for Fitbit. Take a photo of your meal, let Claude analyze the nutrition, and log it directly to Fitbit.

## What It Does

1. **Photo capture** — Take a photo of your food with your phone camera
2. **AI analysis** — Claude Sonnet analyzes the image and estimates nutritional information
3. **Review & edit** — Confirm or adjust the nutrition data
4. **Log to Fitbit** — Post directly to your Fitbit food log

Multi-user application with email allowlist.

---

## Tech Stack

- **Next.js 15+** (App Router, TypeScript)
- **Tailwind CSS + shadcn/ui** for styling
- **iron-session** for encrypted cookie-based sessions
- **Google OAuth 2.0** for authentication
- **Fitbit Web API** for food logging
- **Anthropic Claude API** for nutrition analysis (tool_use)
- **PostgreSQL** via Railway (Drizzle ORM)
- **Railway** for deployment

---

## Environments

| Environment | Branch | URL | Fitbit API |
|-------------|--------|-----|------------|
| Production | `release` | `food.lucaswall.me` | Live |
| Staging | `main` | Railway-generated staging URL | Dry-run (`FITBIT_DRY_RUN=true`) |

**Branch strategy:**
- `main` — development branch, auto-deploys to staging
- `release` — stable branch, auto-deploys to production
- Feature branches → PR to `main` → merge to staging → merge `main` to `release`

Each environment has its own Railway Postgres, environment variables, and domain.

**Promotion flow:** Merge `main` → `release` to deploy to production.

---

## Deployment (Railway)

### Prerequisites

- [Railway](https://railway.app) account
- [Railway CLI](https://docs.railway.com/guides/cli) installed and authenticated (`railway login`)
- GitHub repository pushed to origin

### Step 1: Create Railway Project

1. Go to [railway.com/new](https://railway.com/new)
2. Choose **"Deploy from GitHub Repo"**
3. Select the `food-scanner` repository
4. Railway creates the project and auto-deploys

Do **not** use `railway init` — that's for manual deploys, not GitHub-linked projects.

### Step 2: Link CLI to Project

From the project directory:

```bash
railway link
```

Select the food-scanner project and environment when prompted. This stores the link in `~/.railway/config.json` (global, not in the repo).

### Step 3: Obtain OAuth Credentials

Follow the **OAuth Setup** section below to create Google and Fitbit OAuth credentials before setting environment variables.

### Step 4: Set Environment Variables

```bash
railway variables set \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  ALLOWED_EMAILS=wall.lucas@gmail.com \
  APP_URL=https://food.lucaswall.me \
  GOOGLE_CLIENT_ID=your-google-client-id \
  GOOGLE_CLIENT_SECRET=your-google-client-secret \
  ANTHROPIC_API_KEY=your-anthropic-api-key \
  LOG_LEVEL=info
```

For staging, also set:
```bash
railway variables set FITBIT_DRY_RUN=true
```

Set real values for all credentials.

**Do not set `NODE_ENV`** — Railway handles this automatically. Setting `NODE_ENV=development` breaks the Next.js production build.

### Step 5: Generate Public Domain

```bash
railway domain
```

This creates a public URL like `https://food-scanner-production-XXXX.up.railway.app`.

### Step 6: Update OAuth Redirect URIs

Once you have your Railway domain, go back to both Google Cloud Console and Fitbit Developer portal and add the production redirect URIs:

- Google: `https://<your-railway-domain>/api/auth/google/callback`
- Fitbit: `https://<your-railway-domain>/api/auth/fitbit/callback`

### Step 7: Verify

```bash
curl https://food-scanner-production-XXXX.up.railway.app/api/health
```

Should return `{ "success": true, "data": { "status": "ok" }, "timestamp": ... }`.

### Step 8: Add PostgreSQL Database

1. Open your project in the [Railway dashboard](https://railway.com/dashboard)
2. Click **"+ New"** on the Project Canvas
3. Select **"Database"** → **"PostgreSQL"**
4. Railway creates a Postgres service with auto-generated credentials

#### Connect the database to your app service

1. Click on the **food-scanner** service in the canvas
2. Go to the **Variables** tab
3. Click **"+ New Variable"**
4. Add `DATABASE_URL` with value `${{Postgres.DATABASE_URL}}`
   — This uses Railway's [reference variable syntax](https://docs.railway.com/guides/variables#referencing-another-services-variable) to dynamically resolve the Postgres connection string
5. Railway will redeploy automatically after saving

#### Verify the connection

After the redeploy completes:

```bash
railway logs
```

Look for successful startup with no database connection errors. The app runs migrations automatically on startup — no manual migration step is needed.

### Build & Start

Railway auto-detects Next.js:
- **Build:** `npm run build` (runs `next build`)
- **Start:** `npm start` (runs `next start`)
- **Health check:** `GET /api/health` returns 200

### Monitoring

```bash
railway logs            # Stream deploy logs
railway logs --build    # Stream build logs
```

Or use the Railway MCP from Claude Code to query logs and deployment status.

### Custom Domain (Optional)

1. Add custom domain in Railway dashboard → Settings → Networking
2. Configure DNS (CNAME record pointing to Railway)
3. Update OAuth redirect URIs in both Google and Fitbit portals to use the custom domain

---

## External Services Setup

### Anthropic API

Claude Sonnet powers the AI food analysis feature.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Navigate to **API Keys** in the sidebar
4. Click **Create Key** and copy the API key
5. Add to Railway: `ANTHROPIC_API_KEY=sk-ant-api03-...`

**Note:** The API key is included in Step 4 (Set Environment Variables) above.

---

## OAuth Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Select application type: **Web application**
6. Under **Authorized redirect URIs**, add your environment URLs:
   - Production: `https://food.lucaswall.me/api/auth/google/callback`
   - Staging: `https://<staging-railway-domain>/api/auth/google/callback`
   - Local: `http://localhost:3000/api/auth/google/callback`
7. Copy the **Client ID** and **Client Secret**

### Fitbit OAuth

**Note:** Fitbit credentials are configured per-user through the application UI, not via environment variables.

Each user must register their own Fitbit OAuth application and enter credentials through the setup flow:

1. Go to [dev.fitbit.com](https://dev.fitbit.com) → **Manage → Register an App**
2. Set OAuth 2.0 Application Type: **Personal**
3. Under **Redirect URIs**, add your environment URL:
   - Production: `https://food.lucaswall.me/api/auth/fitbit/callback`
   - Staging: `https://<staging-railway-domain>/api/auth/fitbit/callback`
   - Local: `http://localhost:3000/api/auth/fitbit/callback`
4. Under **Default Access Type**, select **Read & Write**
5. After signing in to Food Scanner, visit `/app/setup-fitbit` to enter your Fitbit **Client ID** and **Client Secret**
6. Complete the Fitbit OAuth flow to authorize the app

Credentials are stored securely in the database on a per-user basis.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| POST | `/api/auth/google` | No | Initiate Google OAuth |
| GET | `/api/auth/google/callback` | No | Google OAuth callback |
| POST | `/api/auth/fitbit` | Yes | Initiate Fitbit OAuth |
| GET | `/api/auth/fitbit/callback` | Yes | Fitbit OAuth callback |
| GET | `/api/auth/session` | Yes | Validate session |
| POST | `/api/auth/logout` | Yes | Destroy session |
| POST | `/api/analyze-food` | Yes | AI nutrition analysis |
| POST | `/api/log-food` | Yes | Log food to Fitbit |

---

## Local Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for complete local setup instructions.

---

## PWA (Add to Home Screen)

The app supports "Add to Home Screen" on mobile devices for a native-like experience.

**Features:**
- Standalone display mode (no browser chrome)
- Custom app icon on home screen
- Portrait orientation lock

**To install:**
1. Open the app in Safari (iOS) or Chrome (Android)
2. Tap the Share button → "Add to Home Screen"
3. The app launches in standalone mode

**Customizing icons:**
Replace the placeholder icons in `public/`:
- `icon-192.png` — 192x192 PNG
- `icon-512.png` — 512x512 PNG

No service worker or offline support — the app requires an internet connection.

---

## Documentation

| File | Description |
|------|-------------|
| [ROADMAP.md](ROADMAP.md) | Full project specification and architecture |
| [CLAUDE.md](CLAUDE.md) | Technical reference for Claude Code |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local development setup |
| [README.md](README.md) | This file — deployment and operations |

