import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

test('owner can sign up, sign in, and create a property', async ({ page, request }) => {
  test.setTimeout(120_000);
  await expect.poll(async () => (await request.get('http://localhost:3000/health')).status(), { timeout: 30_000 }).toBe(200);
  const email = `owner-${Date.now()}@example.com`;
  const prisma = new PrismaClient();
  await page.goto('/register');
  await page.getByLabel('First name').fill('E2E');
  await page.getByLabel('Last name').fill('Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone').fill('1234567890');
  await page.getByLabel('Password', { exact: true }).fill('StrongPass9!');
  await page.getByLabel('Confirm password').fill('StrongPass9!');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email', { timeout: 30_000 });
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('StrongPass9!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Good evening, E2E.' })).toBeVisible({ timeout: 15_000 });

  await page.goto('/properties/new');
  await page.getByLabel('Name').fill('E2E Residence');
  await page.getByLabel('Address').fill('1 Test Street');
  await page.getByLabel('Phone').fill('1234567890');
  await page.getByLabel('Property type').selectOption('RESIDENTIAL');
  await page.getByRole('button', { name: 'Add property' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Good evening, E2E.' })).toBeVisible({ timeout: 15_000 });
  await prisma.$disconnect();
});
