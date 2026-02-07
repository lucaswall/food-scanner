/**
 * Fitbit OAuth 2.0 authentication for MCP server
 * Tokens stored in ~/.config/mcp-fitbit/tokens.json (0o600 permissions)
 * Interactive browser-based OAuth flow on first use
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { exec } from 'child_process';
import { mkdir, readFile, writeFile, chmod } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const TOKEN_DIR = join(homedir(), '.config', 'mcp-fitbit');
const TOKEN_FILE = join(TOKEN_DIR, 'tokens.json');
const OAUTH_PORT = 9876;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`;
const TOKEN_ENDPOINT = 'https://api.fitbit.com/oauth2/token';
const AUTH_ENDPOINT = 'https://www.fitbit.com/oauth2/authorize';
const SCOPES = 'activity nutrition profile sleep weight heartrate settings';
const OAUTH_TIMEOUT_MS = 120_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
}

let cachedTokens: StoredTokens | null = null;

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MCP_FITBIT_CLIENT_ID;
  const clientSecret = process.env.MCP_FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'MCP_FITBIT_CLIENT_ID and MCP_FITBIT_CLIENT_SECRET environment variables must be set',
    );
  }
  return { clientId, clientSecret };
}

function getBasicAuth(): string {
  const { clientId, clientSecret } = getClientCredentials();
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function loadTokens(): Promise<StoredTokens | null> {
  try {
    const data = await readFile(TOKEN_FILE, 'utf-8');
    return JSON.parse(data) as StoredTokens;
  } catch {
    return null;
  }
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  await chmod(TOKEN_FILE, 0o600);
}

async function exchangeCode(code: string): Promise<StoredTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: Date.now() + (data.expires_in as number) * 1000,
    user_id: data.user_id as string,
  };
}

async function refreshTokens(refreshToken: string): Promise<StoredTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // If refresh fails, clear stored tokens so user can re-authenticate
    cachedTokens = null;
    throw new Error(
      `Token refresh failed (${response.status}): ${body.slice(0, 500)}. ` +
        'Use fitbit_authenticate to re-authorize.',
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const tokens: StoredTokens = {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: Date.now() + (data.expires_in as number) * 1000,
    user_id: data.user_id as string,
  };

  await saveTokens(tokens);
  cachedTokens = tokens;
  return tokens;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`, (err) => {
    if (err) {
      console.error(`Failed to open browser. Please visit: ${url}`);
    }
  });
}

/**
 * Start interactive OAuth flow: opens browser and waits for callback
 */
export async function startOAuthFlow(): Promise<StoredTokens> {
  const { clientId } = getClientCredentials();
  const state = randomUUID();

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);

  return new Promise<StoredTokens>((resolve, reject) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url!, `http://localhost:${OAUTH_PORT}`);

          if (url.pathname !== '/callback') {
            res.writeHead(404);
            res.end('Not found');
            return;
          }

          const returnedState = url.searchParams.get('state');
          if (returnedState !== state) {
            res.writeHead(400);
            res.end('State mismatch');
            server.close();
            reject(new Error('OAuth state mismatch'));
            return;
          }

          const error = url.searchParams.get('error');
          if (error) {
            res.writeHead(400);
            res.end(`Authorization denied: ${error}`);
            server.close();
            reject(new Error(`OAuth denied: ${error}`));
            return;
          }

          const code = url.searchParams.get('code');
          if (!code) {
            res.writeHead(400);
            res.end('No authorization code received');
            server.close();
            reject(new Error('No authorization code'));
            return;
          }

          const tokens = await exchangeCode(code);
          await saveTokens(tokens);
          cachedTokens = tokens;

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<html><body style="font-family:system-ui;text-align:center;padding:60px">' +
              '<h1>Fitbit MCP Authenticated</h1>' +
              '<p>You can close this window and return to your terminal.</p>' +
              '</body></html>',
          );

          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(500);
          res.end('Authentication failed');
          server.close();
          reject(err);
        }
      },
    );

    server.listen(OAUTH_PORT, () => {
      console.error(`OAuth callback server on http://localhost:${OAUTH_PORT}`);
      console.error(`Opening browser for Fitbit authorization...`);
      openBrowser(authUrl.toString());
    });

    setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out (2 minutes). Try again.'));
    }, OAUTH_TIMEOUT_MS);
  });
}

/**
 * Get a valid access token, refreshing if needed.
 * Throws if not authenticated.
 */
export async function getAccessToken(): Promise<string> {
  // Check cache
  if (cachedTokens && cachedTokens.expires_at > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return cachedTokens.access_token;
  }

  // Load from file
  const stored = await loadTokens();
  if (!stored) {
    throw new Error('NOT_AUTHENTICATED: Use the fitbit_authenticate tool first.');
  }

  // Refresh if expiring soon
  if (stored.expires_at < Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    const refreshed = await refreshTokens(stored.refresh_token);
    return refreshed.access_token;
  }

  cachedTokens = stored;
  return stored.access_token;
}

/**
 * Get current authentication status
 */
export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  userId?: string;
  expiresAt?: string;
  needsRefresh?: boolean;
}> {
  const stored = await loadTokens();
  if (!stored) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    userId: stored.user_id,
    expiresAt: new Date(stored.expires_at).toISOString(),
    needsRefresh: stored.expires_at < Date.now() + TOKEN_REFRESH_BUFFER_MS,
  };
}
