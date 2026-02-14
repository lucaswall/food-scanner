import { test, expect } from '@playwright/test';

test.describe('API Key Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('API key section shows empty state initially', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Verify API key manager section is present with the heading
    await expect(page.getByRole('heading', { name: 'API Keys' })).toBeVisible();

    // Verify empty state message is shown (no seeded API keys)
    await expect(page.getByText('No API keys')).toBeVisible();

    // Verify Generate API Key button is visible
    await expect(page.getByRole('button', { name: 'Generate API Key' })).toBeVisible();
  });

  test('create API key with name shows full key', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Click Generate API Key button
    await page.getByRole('button', { name: 'Generate API Key' }).click();

    // Verify the form appears with name input
    const nameInput = page.getByLabel('Key Name');
    await expect(nameInput).toBeVisible();

    // Enter a key name
    await nameInput.fill('Test Key');

    // Click Create button
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for the dialog to open showing the created key
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify dialog title
    await expect(dialog.getByRole('heading', { name: 'API Key Created' })).toBeVisible();

    // Verify the full key is displayed (starts with fsk_)
    const keyElement = dialog.getByText(/^fsk_/);
    await expect(keyElement).toBeVisible();
    const keyText = await keyElement.textContent();
    expect(keyText).toBeTruthy();
    expect(keyText!).toMatch(/^fsk_/);
    expect(keyText!.length).toBeGreaterThan(10);

    // Close the dialog
    await page.getByRole('button', { name: 'Done' }).click();

    // Verify dialog is closed
    await expect(dialog).not.toBeVisible();
  });

  test('created key appears in list', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Verify "Test Key" appears in the key list
    await expect(page.getByText('Test Key')).toBeVisible();

    // Verify the key prefix is shown with the fsk_ format
    await expect(page.getByText(/fsk_.*\.\.\./)).toBeVisible();

    // Verify the Revoke button is present for this key
    const keyCard = page.getByText('Test Key').locator('..').locator('..');
    await expect(keyCard.getByRole('button', { name: 'Revoke' })).toBeVisible();
  });

  test('revoke key removes it from list', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Find the key card with "Test Key"
    const keyCard = page.getByText('Test Key').locator('..').locator('..');

    // Click revoke button
    await keyCard.getByRole('button', { name: 'Revoke' }).click();

    // Verify confirmation dialog appears
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('heading', { name: 'Revoke API Key' })).toBeVisible();

    // Confirm revocation
    await confirmDialog.getByRole('button', { name: 'Confirm' }).click();

    // Wait for the dialog to close
    await expect(confirmDialog).not.toBeVisible();

    // Verify the key is removed from the list
    await expect(page.getByText('Test Key')).not.toBeVisible();

    // Verify empty state appears again
    await expect(page.getByText('No API keys')).toBeVisible();
  });
});
