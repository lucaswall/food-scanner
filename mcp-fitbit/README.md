# MCP Fitbit Server

Model Context Protocol (MCP) server providing read-only access to the Fitbit Web API with OAuth 2.0 authentication.

## Features

- **OAuth 2.0 Browser Flow** - Interactive authorization with file-based token storage
- **Automatic Token Refresh** - Tokens refresh transparently before expiry
- **Read-Only Access** - All tools are GET-only; no write operations
- **Pure TypeScript** - No build process, runs directly with tsx
- **Secure Token Storage** - Tokens stored at `~/.config/mcp-fitbit/tokens.json` with `0600` permissions

## Prerequisites

- Node.js 18+
- A Fitbit developer application (see step 1 below)

## Setup (Step by Step)

### 1. Create a Fitbit Developer Application

If you don't already have one:

1. Go to [https://dev.fitbit.com/apps/new](https://dev.fitbit.com/apps/new) and log in with your Fitbit account
2. Fill in the registration form:
   - **Application Name**: any name (e.g., "My MCP Server")
   - **Description**: any description
   - **Application Website URL**: `http://localhost`
   - **Organization**: your name
   - **Organization Website URL**: `http://localhost`
   - **Terms of Service URL**: `http://localhost`
   - **Privacy Policy URL**: `http://localhost`
   - **OAuth 2.0 Application Type**: **Personal** (important for full data access)
   - **Redirect URL**: `http://localhost:9876/callback`
   - **Default Access Type**: **Read-Only**
3. Click **Register** and note your **OAuth 2.0 Client ID** and **Client Secret**

If you already have a Fitbit app, add the redirect URL:

1. Go to [https://dev.fitbit.com/apps](https://dev.fitbit.com/apps)
2. Select your application
3. Under **Redirect URL**, add: `http://localhost:9876/callback`
4. Save

### 2. Configure Environment Variables

Create or edit the `.env` file in the **project root** (parent of `mcp-fitbit/`):

```env
FITBIT_CLIENT_ID=your_client_id_here
FITBIT_CLIENT_SECRET=your_client_secret_here
```

These are the Client ID and Client Secret from step 1.

### 3. Install Dependencies

```bash
cd mcp-fitbit
npm install
```

> `node_modules/` is gitignored. You must run `npm install` after cloning the repository.

### 4. MCP Configuration

The project's `.mcp.json` and `.claude/settings.json` are already configured to load the Fitbit MCP server. No manual configuration needed.

For reference, the `.mcp.json` entry is:

```json
{
  "mcpServers": {
    "fitbit": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "mcp-fitbit/index.ts"]
    }
  }
}
```

### 5. Restart Claude Code

After completing steps 1-3, **restart Claude Code** (`/exit` and relaunch) so it picks up the new MCP server from `.mcp.json`. The Fitbit MCP server starts automatically when Claude Code launches.

### 6. Authenticate with Fitbit

In Claude Code, call the `fitbit_authenticate` tool. This will:

1. Start a temporary HTTP server on `http://localhost:9876`
2. Open your browser to the Fitbit authorization page
3. After you click **Allow**, capture the OAuth callback
4. Exchange the authorization code for access + refresh tokens
5. Store tokens at `~/.config/mcp-fitbit/tokens.json` (permissions `0600`)

You only need to do this once. Subsequent sessions reuse stored tokens with automatic refresh.

### 7. Use the Tools

After authenticating, all `fitbit_*` tools are available. For example:
- "Show me my food log for today" will use `fitbit_get_food_log`
- "How many steps did I take last week?" will use `fitbit_get_time_series`

## Tools

### Authentication

#### fitbit_authenticate

Check authentication status or trigger a new OAuth flow.

- `force` (boolean, optional): Force a new OAuth flow even if already authenticated

### User

#### fitbit_get_profile

Get the authenticated user's Fitbit profile (display name, age, timezone, account settings).

#### fitbit_get_devices

Get connected Fitbit devices (device type, battery level, last sync time, firmware version).

### Nutrition

#### fitbit_get_food_log

Get food log for a specific date. Returns all logged food items with nutritional details, daily goals, and summary totals.

- `date` (string, required): `yyyy-MM-dd` or `"today"`

#### fitbit_get_water_log

Get water intake log for a specific date.

- `date` (string, required): `yyyy-MM-dd` or `"today"`

#### fitbit_get_food_units

Get all valid Fitbit food measurement units with IDs, names, and plural forms. Useful for looking up unit IDs when creating or logging foods.

#### fitbit_get_food_goals

Get the user's daily food and calorie goals.

#### fitbit_get_water_goal

Get the user's daily water intake goal.

#### fitbit_get_favorite_foods

Get the user's list of favorite foods.

#### fitbit_get_frequent_foods

Get the user's list of frequently logged foods.

#### fitbit_get_recent_foods

Get the user's list of recently logged foods.

#### fitbit_get_meals

Get the user's saved meals with food contents and nutritional info.

#### fitbit_get_food_locales

Get available food locales used to search, log, or create food.

### Body

#### fitbit_get_weight_log

Get weight log entries for a specific date.

- `date` (string, required): `yyyy-MM-dd` or `"today"`

#### fitbit_get_body_fat_log

Get body fat log entries for a specific date.

- `date` (string, required): `yyyy-MM-dd` or `"today"`

#### fitbit_get_body_goals

Get the user's body weight or body fat goal.

- `goalType` (string, required): `"weight"` or `"fat"`

### Activity

#### fitbit_get_activity_summary

Get daily activity summary (steps, calories, distance, floors, active minutes, goals).

- `date` (string, required): `yyyy-MM-dd` or `"today"`

### Sleep

#### fitbit_get_sleep_log

Get sleep log (stages, duration, efficiency, start/end times).

- `date` (string, required): `yyyy-MM-dd` or `"today"`

### Health Metrics

#### fitbit_get_breathing_rate

Get breathing rate summary (measured during sleep). Supports single date or date range (max 30 days).

- `date` (string, required): `yyyy-MM-dd` or `"today"`
- `endDate` (string, optional): End date for range query

#### fitbit_get_spo2

Get SpO2 (blood oxygen saturation) summary. Supports single date or date range.

- `date` (string, required): `yyyy-MM-dd` or `"today"`
- `endDate` (string, optional): End date for range query

#### fitbit_get_cardio_score

Get cardio fitness score (VO2 Max estimate).

- `date` (string, required): `yyyy-MM-dd` or `"today"`

#### fitbit_get_hrv

Get heart rate variability (HRV) summary (RMSSD and coverage, measured during sleep).

- `date` (string, required): `yyyy-MM-dd` or `"today"`

#### fitbit_get_temperature

Get temperature summary (core or skin readings).

- `type` (string, required): `"core"` or `"skin"`
- `date` (string, required): `yyyy-MM-dd` or `"today"`

### Time Series

#### fitbit_get_time_series

Get time series data for any supported resource over a date range.

- `resource` (string, required): Resource path (see below)
- `startDate` (string, required): `yyyy-MM-dd` or `"today"`
- `endDate` (string, optional): End date (mutually exclusive with `period`)
- `period` (string, optional): `1d`, `7d`, `30d`, `1w`, `1m`, `3m`, `6m`, `1y` (mutually exclusive with `endDate`)

**Available resources:**

| Category | Resources |
|----------|-----------|
| Activity | `activities/steps`, `activities/calories`, `activities/caloriesBMR`, `activities/distance`, `activities/floors`, `activities/elevation`, `activities/minutesSedentary`, `activities/minutesLightlyActive`, `activities/minutesFairlyActive`, `activities/minutesVeryActive`, `activities/activityCalories` |
| Nutrition | `foods/log/caloriesIn`, `foods/log/water` |
| Body | `body/weight`, `body/bmi`, `body/fat` |
| Heart Rate | `activities/heart` |

## OAuth Scopes

The server requests the following scopes (all read-only usage):

- `activity` - Steps, calories, distance, active minutes
- `nutrition` - Food and water logs
- `profile` - User profile data
- `sleep` - Sleep stages and duration
- `weight` - Body weight, BMI, body fat
- `heartrate` - Heart rate data
- `settings` - Device information

## Token Storage

Tokens are stored at `~/.config/mcp-fitbit/tokens.json` with restricted file permissions (`0600`, owner read/write only). This follows the same security pattern used by CLI tools like `gh`, `aws`, and `gcloud`.

The token file contains:
- `access_token` - Short-lived (8 hours) API access token
- `refresh_token` - Long-lived token for obtaining new access tokens
- `expires_at` - Unix timestamp (ms) when the access token expires
- `user_id` - Fitbit user ID

Tokens are refreshed automatically 5 minutes before expiry. If the refresh token is revoked, you'll need to re-authenticate with `fitbit_authenticate`.

## Project Structure

```
mcp-fitbit/
├── index.ts              # MCP server entry point
├── auth.ts               # OAuth 2.0 flow + token management
├── fitbit-client.ts      # Authenticated HTTP client
├── package.json          # Dependencies
├── .gitignore            # Ignores node_modules/ and logs
├── README.md             # This file
└── tools/
    ├── index.ts          # Tool registry
    ├── types.ts          # TypeScript type definitions
    ├── authenticate.ts   # Auth status / OAuth trigger
    ├── get_profile.ts    # User profile
    ├── get_food_log.ts   # Food log by date
    ├── get_water_log.ts  # Water log by date
    ├── get_food_units.ts # All valid food measurement units
    ├── get_food_goals.ts # Daily food/calorie goals
    ├── get_water_goal.ts # Daily water intake goal
    ├── get_favorite_foods.ts  # Favorite foods list
    ├── get_frequent_foods.ts  # Frequently logged foods
    ├── get_recent_foods.ts    # Recently logged foods
    ├── get_meals.ts      # Saved meals
    ├── get_food_locales.ts    # Food locales
    ├── get_weight_log.ts # Weight log by date
    ├── get_body_fat_log.ts    # Body fat log by date
    ├── get_body_goals.ts # Body weight/fat goals
    ├── get_activity_summary.ts  # Daily activity
    ├── get_sleep_log.ts  # Sleep data by date
    ├── get_breathing_rate.ts  # Breathing rate summary
    ├── get_spo2.ts       # Blood oxygen (SpO2)
    ├── get_cardio_score.ts    # VO2 Max estimate
    ├── get_hrv.ts        # Heart rate variability
    ├── get_temperature.ts     # Core/skin temperature
    ├── get_devices.ts    # Connected devices
    └── get_time_series.ts     # Flexible time series
```

## Error Handling

All tools return structured responses:

```typescript
{
  content: [{ type: 'text', text: 'Response or error message' }],
  isError: boolean
}
```

Common errors:
- `NOT_AUTHENTICATED` - Call `fitbit_authenticate` first
- `401` - Token expired or revoked; re-authenticate
- `429` - Rate limited (150 requests/hour per user)
- `400` - Invalid parameters (date format, resource path)

## Troubleshooting

### "FITBIT_CLIENT_ID and/or FITBIT_CLIENT_SECRET not set"

Ensure your `.env` file in the project root contains both variables with valid values. The MCP server loads `.env` from its parent directory automatically.

### "OAuth flow timed out"

The authorization must complete within 2 minutes. If the browser didn't open, check the server stderr for the auth URL and visit it manually.

### "Token refresh failed"

The refresh token may have been revoked. Run `fitbit_authenticate` with `force: true` to re-authorize.

### Port 9876 already in use

Another process is using the OAuth callback port. Stop it or wait for a previous auth flow to complete.

### Tools not appearing in Claude Code

1. Verify `.mcp.json` includes the `fitbit` entry
2. Run `npm install` inside `mcp-fitbit/`
3. Restart Claude Code

## Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `dotenv` - Environment variable loading
- `tsx` - TypeScript execution (dev dependency)

## Rate Limits

Fitbit API allows 150 requests per hour per user. The time series tool is efficient for retrieving historical data in a single call rather than querying day-by-day.
