# Food Scanner

AI-powered food logging for Fitbit. Take a photo of your meal, let Claude analyze the nutrition, and log it directly to Fitbit.

## What It Does

1. **Photo capture** — Take a photo of your food with your phone camera
2. **AI analysis** — Claude Sonnet analyzes the image and estimates nutritional information
3. **Review & edit** — Confirm or adjust the nutrition data
4. **Log to Fitbit** — Post directly to your Fitbit food log

Single-user application for wall.lucas@gmail.com.

---

## Tech Stack

- **Next.js 15+** (App Router, TypeScript)
- **Tailwind CSS + shadcn/ui** for styling
- **iron-session** for encrypted cookie-based sessions
- **Google OAuth 2.0** for authentication
- **Fitbit Web API** for food logging
- **Anthropic Claude API** for nutrition analysis (tool_use)
- **Railway** for deployment

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
4. Railway creates the project and auto-deploys on every push to main

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
  ALLOWED_EMAIL=wall.lucas@gmail.com \
  APP_URL=https://food.lucaswall.me \
  GOOGLE_CLIENT_ID=your-google-client-id \
  GOOGLE_CLIENT_SECRET=your-google-client-secret \
  FITBIT_CLIENT_ID=your-fitbit-client-id \
  FITBIT_CLIENT_SECRET=your-fitbit-client-secret \
  ANTHROPIC_API_KEY=your-anthropic-api-key
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

## OAuth Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Select application type: **Web application**
6. Under **Authorized redirect URIs**, add your production URL:
   - `https://<your-railway-domain>/api/auth/google/callback`
7. Copy the **Client ID** and **Client Secret**

### Fitbit OAuth

1. Go to [dev.fitbit.com](https://dev.fitbit.com) → **Manage → Register an App**
2. Set OAuth 2.0 Application Type: **Personal**
3. Under **Redirect URIs**, add your production URL:
   - `https://<your-railway-domain>/api/auth/fitbit/callback`
4. Under **Default Access Type**, select **Read & Write**
5. Copy the **Client ID** and **Client Secret**

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

## Documentation

| File | Description |
|------|-------------|
| [ROADMAP.md](ROADMAP.md) | Full project specification and architecture |
| [CLAUDE.md](CLAUDE.md) | Technical reference for Claude Code |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local development setup |
| [README.md](README.md) | This file — deployment and operations |

---

## Cost Estimates

| Service | Monthly Cost |
|---------|-------------|
| Railway (Hobby) | ~$5 |
| Claude API (~300 req/mo) | ~$0.60 |
| Fitbit API | Free |
| Custom domain | ~$1/mo |
| **Total** | **~$7/mo** |
