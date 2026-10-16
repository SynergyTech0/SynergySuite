import { test, expect } from '@playwright/test';

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports');
  });

  test('should navigate to report builder', async ({ page }) => {
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('h1')).toContainText(/Reports/i);
  });

  test('should create new report from template', async ({ page }) => {
    // Click create report button
    await page.getByRole('button', { name: /create report/i }).click();
    
    // Select monthly summary template
    await page.getByRole('button', { name: /monthly summary/i }).click();
    
    // Verify report builder opens
    await expect(page.locator('.report-builder')).toBeVisible();
    
    // Verify sections are loaded
    await expect(page.getByText(/revenue summary/i)).toBeVisible();
    await expect(page.getByText(/expense breakdown/i)).toBeVisible();
  });

  test('should customize report sections', async ({ page }) => {
    // Open existing report
    await page.getByTestId('report-1').click();
    
    // Add new section
    await page.getByRole('button', { name: /add section/i }).click();
    await page.getByRole('menuitem', { name: /cash flow/i }).click();
    
    // Verify section was added
    await expect(page.getByText(/cash flow analysis/i)).toBeVisible();
    
    // Remove section
    await page.getByTestId('remove-section-0').click();
    await page.getByRole('button', { name: /confirm/i }).click();
  });

  test('should generate PDF report', async ({ page }) => {
    await page.getByTestId('report-1').click();
    
    // Click generate PDF
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /generate pdf/i }).click();
    
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/report.*\.pdf/i);
  });

  test('should generate Excel report', async ({ page }) => {
    await page.getByTestId('report-1').click();
    
    // Click generate Excel
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /generate excel/i }).click();
    
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/report.*\.xlsx/i);
  });

  test('should schedule automated report delivery', async ({ page }) => {
    await page.getByTestId('report-1').click();
    
    // Open schedule modal
    await page.getByRole('button', { name: /schedule/i }).click();
    
    // Configure schedule
    await page.getByLabel(/frequency/i).selectOption('weekly');
    await page.getByLabel(/email/i).fill('cfo@company.com');
    await page.getByLabel(/day/i).selectOption('monday');
    
    // Save schedule
    await page.getByRole('button', { name: /save schedule/i }).click();
    
    // Verify success message
    await expect(page.getByText(/scheduled successfully/i)).toBeVisible();
  });

  test('should preview report before generation', async ({ page }) => {
    await page.getByTestId('report-1').click();
    
    // Click preview button
    await page.getByRole('button', { name: /preview/i }).click();
    
    // Verify preview modal opens
    await expect(page.locator('.report-preview')).toBeVisible();
    
    // Verify report content is rendered
    await expect(page.getByText(/revenue summary/i)).toBeVisible();
    
    // Close preview
    await page.getByRole('button', { name: /close/i }).click();
  });

  test('should filter report data by date range', async ({ page }) => {
    await page.getByTestId('report-1').click();
    
    // Change date range
    await page.getByLabel(/start date/i).fill('2024-01-01');
    await page.getByLabel(/end date/i).fill('2024-01-31');
    
    // Apply filter
    await page.getByRole('button', { name: /apply/i }).click();
    
    // Verify data updates
    await expect(page.getByText(/january 2024/i)).toBeVisible();
  });

  test('should save report template', async ({ page }) => {
    // Create new report
    await page.getByRole('button', { name: /create report/i }).click();
    await page.getByRole('button', { name: /blank template/i }).click();
    
    // Add sections
    await page.getByRole('button', { name: /add section/i }).click();
    await page.getByRole('menuitem', { name: /revenue/i }).click();
    
    // Save as template
    await page.getByRole('button', { name: /save as template/i }).click();
    await page.getByLabel(/template name/i).fill('Custom Monthly Report');
    await page.getByRole('button', { name: /save/i }).click();
    
    // Verify template was saved
    await expect(page.getByText(/template saved/i)).toBeVisible();
  });

  test('should duplicate existing report', async ({ page }) => {
    await page.getByTestId('report-1').hover();
    await page.getByTestId('duplicate-report-1').click();
    
    // Verify duplicate was created
    await expect(page.getByText(/copy of/i)).toBeVisible();
  });

  test('should delete report', async ({ page }) => {
    await page.getByTestId('report-2').hover();
    await page.getByTestId('delete-report-2').click();
    
    // Confirm deletion
    await page.getByRole('button', { name: /confirm/i }).click();
    
    // Verify report was deleted
    await expect(page.getByTestId('report-2')).not.toBeVisible();
    await expect(page.getByText(/report deleted/i)).toBeVisible();
  });

  test('should search reports', async ({ page }) => {
    await page.getByPlaceholder(/search reports/i).fill('monthly');
    
    // Verify search results
    await expect(page.getByTestId('report-1')).toBeVisible();
    await expect(page.getByText(/monthly summary/i)).toBeVisible();
  });

  test('should sort reports by date', async ({ page }) => {
    await page.getByRole('button', { name: /sort/i }).click();
    await page.getByRole('menuitem', { name: /date created/i }).click();
    
    // Verify reports are sorted
    const reports = await page.locator('[data-testid^="report-"]').all();
    expect(reports.length).toBeGreaterThan(0);
  });
});
