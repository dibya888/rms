import { expect, test } from '@playwright/test';

test('web shell and API are available', async ({ page, request }) => {
  const health = await request.get('http://localhost:3000/health');
  expect(health.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
});

test('registration entry point renders its required fields', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Sign up' })).toBeVisible();
  await expect(page.getByLabel('First name')).toBeVisible();
  await expect(page.getByLabel('Last name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Confirm password')).toBeVisible();
});
