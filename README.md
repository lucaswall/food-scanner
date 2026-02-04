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

- Railway account ([railway.app](https://railway.app))
- GitHub repository connected to Railway
- Custom domain (optional)

### Setup

1. **Create Railway project** from GitHub repo (auto-deploys on push to main)

2. **Set environment variables** in Railway dashboard → Variables:

   ```
   NODE_ENV=production
   GOOGLE_CLIENT_ID=<your-google-client-id>
   GOOGLE_CLIENT_SECRET=<your-google-client-secret>
   FITBIT_CLIENT_ID=<your-fitbit-client-id>
   FITBIT_CLIENT_SECRET=<your-fitbit-client-secret>
   ANTHROPIC_API_KEY=<your-anthropic-api-key>
   SESSION_SECRET=<min-32-character-random-string>
   ALLOWED_EMAIL=wall.lucas@gmail.com
   ```

3. **Generate domain** in Railway dashboard → Settings → Networking → Generate Domain

4. **Update OAuth redirect URIs** to use Railway domain:
   - Google: `https://your-app.up.railway.app/api/auth/google/callback`
   - Fitbit: `https://your-app.up.railway.app/api/auth/fitbit/callback`

### Build & Start

Railway auto-detects Next.js:
- **Build:** `npm run build` (runs `next build`)
- **Start:** `npm start` (runs `next start`)
- **Health check:** `GET /api/health` returns 200

### Custom Domain

1. Add custom domain in Railway dashboard → Settings → Networking
2. Configure DNS (CNAME record pointing to Railway)
3. Update OAuth redirect URIs to use custom domain

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

## Monitoring

- **Health check:** `GET /api/health` — returns `{ status: "ok", timestamp: <unix> }`
- **Railway dashboard:** View logs, deployments, resource usage
- **Railway MCP:** Query logs and deployment status from Claude Code

---

## Local Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for complete local setup instructions.

Quick start:
```bash
npm install
cp .env.example .env.local  # Edit with your credentials
npm run dev
```

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
