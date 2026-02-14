import { test, expect } from '@playwright/test';

// Uses default authenticated storage state from global setup

test.describe('API Data Verification', () => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  test('GET /api/food-history returns seeded entries', async ({ request }) => {
    const response = await request.get('/api/food-history');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.entries).toBeDefined();
    expect(Array.isArray(body.data.entries)).toBe(true);
    expect(body.data.entries.length).toBeGreaterThanOrEqual(2);

    // Verify seeded food names are present (skip Broccoli — may be deleted by parallel test)
    const foodNames = body.data.entries.map((e: { foodName: string }) => e.foodName);
    expect(foodNames).toContain('Grilled Chicken Breast');
    expect(foodNames).toContain('Brown Rice');

    // Verify entry structure
    const firstEntry = body.data.entries[0];
    expect(firstEntry).toHaveProperty('foodName');
    expect(firstEntry).toHaveProperty('calories');
    expect(firstEntry).toHaveProperty('mealTypeId');
    expect(firstEntry).toHaveProperty('date');
  });

  test('GET /api/nutrition-summary returns non-zero totals', async ({ request }) => {
    const response = await request.get(`/api/nutrition-summary?date=${today}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('totals');
    expect(body.data).toHaveProperty('meals');
    expect(Array.isArray(body.data.meals)).toBe(true);

    // Verify non-zero totals from seeded data
    expect(body.data.totals.calories).toBeGreaterThan(0);
    expect(body.data.totals.proteinG).toBeGreaterThan(0);
    expect(body.data.totals.carbsG).toBeGreaterThan(0);
    expect(body.data.totals.fatG).toBeGreaterThan(0);

    // Verify meals structure
    expect(body.data.meals.length).toBeGreaterThan(0);
    const firstMeal = body.data.meals[0];
    expect(firstMeal).toHaveProperty('mealTypeId');
    expect(firstMeal).toHaveProperty('entries');
  });

  test('GET /api/common-foods?tab=recent returns seeded foods', async ({ request }) => {
    const response = await request.get('/api/common-foods?tab=recent');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.foods).toBeDefined();
    expect(Array.isArray(body.data.foods)).toBe(true);
    expect(body.data.foods.length).toBeGreaterThan(0);

    // Verify seeded foods appear in recent (skip Broccoli — may be deleted by parallel test)
    const foodNames = body.data.foods.map((f: { foodName: string }) => f.foodName);
    expect(foodNames).toContain('Grilled Chicken Breast');
    expect(foodNames).toContain('Brown Rice');
  });

  test('GET /api/fasting returns fasting window from seeded meals', async ({ request }) => {
    const response = await request.get(`/api/fasting?date=${today}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('window');
    expect(body.data).toHaveProperty('live');

    // The seeded data has lunch at 12:30 and dinner at current time
    // So we expect a fasting window to be calculated
    if (body.data.window) {
      expect(body.data.window).toHaveProperty('lastMealTime');
      // firstMealTime might be null if this is the first day
    }
  });

  test('GET /api/earliest-entry returns today\'s date', async ({ request }) => {
    const response = await request.get('/api/earliest-entry');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('date');

    // The seeded data is for today, so earliest entry should be today
    expect(body.data.date).toBe(today);
  });

  test('GET /api/claude-usage returns months array', async ({ request }) => {
    const response = await request.get('/api/claude-usage');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('months');
    expect(Array.isArray(body.data.months)).toBe(true);
    // May be empty since no Claude usage is seeded
  });

  test('GET /api/fitbit-credentials returns hasCredentials true', async ({ request }) => {
    const response = await request.get('/api/fitbit-credentials');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('hasCredentials');

    // After Task 1 seeds Fitbit credentials, this should be true
    expect(body.data.hasCredentials).toBe(true);
    expect(body.data).toHaveProperty('clientId');
    expect(body.data.clientId).toBe('TEST_CLIENT_ID');
  });
});
