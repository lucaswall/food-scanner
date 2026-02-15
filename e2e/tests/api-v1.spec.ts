import { test, expect } from '@playwright/test';

test.describe('v1 External API', () => {
  // Use local date (not UTC) to match how the app and seed fixture work
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let apiKey: string;
  let apiKeyId: number;

  test.beforeAll(async ({ request }) => {
    // Create an API key via the authenticated API
    // The request fixture inherits authenticated storage state
    const response = await request.post('/api/api-keys', {
      data: { name: 'E2E Test Key' }
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('rawKey');
    expect(body.data).toHaveProperty('id');

    apiKey = body.data.rawKey;
    apiKeyId = body.data.id;

    // Verify the key starts with fsk_
    expect(apiKey).toMatch(/^fsk_/);
  });

  test.afterAll(async ({ request }) => {
    // Clean up: revoke the API key
    if (apiKeyId) {
      await request.delete(`/api/api-keys/${apiKeyId}`);
    }
  });

  test('GET /api/v1/food-log returns data with valid key', async ({ request }) => {
    const response = await request.get(`/api/v1/food-log?date=${today}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('meals');
    expect(body.data).toHaveProperty('totals');
    expect(Array.isArray(body.data.meals)).toBe(true);
    expect(body.data.totals).toHaveProperty('calories');
    expect(body.data.totals).toHaveProperty('proteinG');
    expect(body.data.totals).toHaveProperty('carbsG');
    expect(body.data.totals).toHaveProperty('fatG');
  });

  test('GET /api/v1/nutrition-summary returns data with valid key', async ({ request }) => {
    const response = await request.get(`/api/v1/nutrition-summary?date=${today}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('meals');
    expect(body.data).toHaveProperty('totals');
    expect(Array.isArray(body.data.meals)).toBe(true);
    expect(body.data.totals).toHaveProperty('calories');
  });

  test('GET /api/v1/lumen-goals returns data with valid key', async ({ request }) => {
    const response = await request.get(`/api/v1/lumen-goals?date=${today}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('goals');
    // Goals will be null since no Lumen data is seeded
    expect(body.data.goals).toBeNull();
  });

  test('GET /api/v1/food-log with missing date returns 400', async ({ request }) => {
    const response = await request.get('/api/v1/food-log', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('GET /api/v1/food-log with invalid date format returns 400', async ({ request }) => {
    const response = await request.get('/api/v1/food-log?date=invalid-date', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('invalid Bearer token returns 401', async ({ request }) => {
    const response = await request.get(`/api/v1/food-log?date=${today}`, {
      headers: { 'Authorization': 'Bearer invalid_token' }
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty('code');
  });

  test('missing Bearer token returns 401', async ({ request }) => {
    const response = await request.get(`/api/v1/food-log?date=${today}`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty('code');
  });
});
