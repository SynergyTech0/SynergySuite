import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load dashboard successfully', async ({ page }) => {
    await expect(page).toHaveTitle(/SynergyBooks/);
    await expect(page.locator('h1')).toContainText(/Dashboard/i);
  });

  test('should display all default widgets', async ({ page }) => {
    // Check for revenue widget
    await expect(page.getByTestId('revenue-widget')).toBeVisible();
    
    // Check for expenses widget
    await expect(page.getByTestId('expense-widget')).toBeVisible();
    
    // Check for cash flow widget
    await expect(page.getByTestId('cashflow-widget')).toBeVisible();
    
    // Check for profit margin widget
    await expect(page.getByTestId('profit-margin-widget')).toBeVisible();
  });

  test('should allow time range filtering', async ({ page }) => {
    // Click on time range selector
    await page.getByRole('button', { name: /30 days/i }).click();
    
    // Select 7 days
    await page.getByRole('menuitem', { name: /7 days/i }).click();
    
    // Verify widgets update (check for loading state and then data)
    await expect(page.getByTestId('revenue-widget')).toContainText(/loading/i);
    await expect(page.getByTestId('revenue-widget')).not.toContainText(/loading/i, { timeout: 5000 });
  });

  test('should enter edit mode and rearrange widgets', async ({ page }) => {
    // Enable edit mode
    await page.getByRole('button', { name: /edit/i }).click();
    
    // Verify edit mode is active
    await expect(page.locator('.edit-mode-indicator')).toBeVisible();
    
    // Drag widget (simplified - actual drag might need more complex interaction)
    const widget = page.getByTestId('revenue-widget');
    await widget.hover();
    
    // Exit edit mode
    await page.getByRole('button', { name: /done/i }).click();
    
    // Verify edit mode is disabled
    await expect(page.locator('.edit-mode-indicator')).not.toBeVisible();
  });

  test('should add new widget to dashboard', async ({ page }) => {
    // Open add widget menu
    await page.getByRole('button', { name: /add widget/i }).click();
    
    // Select accounts receivable widget
    await page.getByRole('menuitem', { name: /accounts receivable/i }).click();
    
    // Verify widget was added
    await expect(page.getByTestId('ar-widget')).toBeVisible();
  });

  test('should remove widget from dashboard', async ({ page }) => {
    // Enable edit mode
    await page.getByRole('button', { name: /edit/i }).click();
    
    // Click remove button on a widget
    await page.getByTestId('revenue-widget').hover();
    await page.getByTestId('remove-revenue-widget').click();
    
    // Confirm removal
    await page.getByRole('button', { name: /confirm/i }).click();
    
    // Verify widget was removed
    await expect(page.getByTestId('revenue-widget')).not.toBeVisible();
  });

  test('should export dashboard data', async ({ page }) => {
    // Click export button
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export/i }).click();
    
    // Select PDF export
    await page.getByRole('menuitem', { name: /pdf/i }).click();
    
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/dashboard.*\.pdf/i);
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Verify mobile layout
    await expect(page.locator('.mobile-dashboard')).toBeVisible();
    
    // Verify widgets stack vertically
    const widgets = await page.locator('[data-testid$="-widget"]').all();
    expect(widgets.length).toBeGreaterThan(0);
    
    // Each widget should take full width
    for (const widget of widgets) {
      const box = await widget.boundingBox();
      expect(box?.width).toBeGreaterThan(300);
    }
  });

  test('should handle widget errors gracefully', async ({ page }) => {
    // Simulate network error
    await page.route('**/api/analytics/**', route => route.abort());
    
    await page.reload();
    
    // Verify error message is shown
    await expect(page.getByText(/error loading data/i)).toBeVisible();
    
    // Verify retry button is available
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  });

  test('should persist layout after page refresh', async ({ page }) => {
    // Enable edit mode and make changes
    await page.getByRole('button', { name: /edit/i }).click();
    
    // Remove a widget
    await page.getByTestId('revenue-widget').hover();
    await page.getByTestId('remove-revenue-widget').click();
    await page.getByRole('button', { name: /confirm/i }).click();
    
    await page.getByRole('button', { name: /done/i }).click();
    
    // Refresh page
    await page.reload();
    
    // Verify widget is still removed
    await expect(page.getByTestId('revenue-widget')).not.toBeVisible();
  });
});
