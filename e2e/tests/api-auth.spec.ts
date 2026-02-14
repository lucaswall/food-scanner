import { test, expect, type APIResponse } from '@playwright/test';

// Use empty storage state to simulate unauthenticated requests
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Helper to verify a response is a 401 with standardized error format
 */
async function expectUnauthorized(response: APIResponse) {
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.error).toHaveProperty('code', 'AUTH_MISSING_SESSION');
  expect(body.error).toHaveProperty('message');
  expect(body).toHaveProperty('timestamp');
}

test.describe('API Authentication', () => {
  test('GET /api/food-history returns 401 when unauthenticated', async ({ request }) => {
    const response = await request.get('/api/food-history');
    await expectUnauthorized(response);
  });

  test('GET /api/common-foods returns 401 when unauthenticated', async ({ request }) => {
    const response = await request.get('/api/common-foods');
    await expectUnauthorized(response);
  });

  test('POST /api/log-food returns 401 when unauthenticated', async ({ request }) => {
    const response = await request.post('/api/log-food', {
      data: { foodName: 'test', calories: 100 }
    });
    await expectUnauthorized(response);
  });

  test('POST /api/analyze-food returns 401 when unauthenticated', async ({ request }) => {
    const response = await request.post('/api/analyze-food', {
      data: { images: [] }
    });
    await expectUnauthorized(response);
  });

  test('GET /api/auth/session returns 401 when unauthenticated', async ({ request }) => {
    const response = await request.get('/api/auth/session');
    await expectUnauthorized(response);
  });

  test('GET /api/nutrition-summary returns 401 when unauthenticated', async ({ request }) => {
    const response = await request.get('/api/nutrition-summary');
    await expectUnauthorized(response);
  });

  test('GET /api/v1/food-log returns 401 without Bearer token', async ({ request }) => {
    const response = await request.get('/api/v1/food-log');
    await expectUnauthorized(response);
  });

  test('GET /api/health returns 200 (public route control)', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('status', 'ok');
  });
});
