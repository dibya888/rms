import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

test('owner JWT cannot access another owner portfolio through API endpoints', async ({ request }) => {
  test.setTimeout(120_000);
  const api = 'http://127.0.0.1:3000';
  const prisma = new PrismaClient();
  const unique = Date.now();

  async function csrf() {
    const response = await request.get(`${api}/auth/csrf`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).csrfToken as string;
  }

  async function post(path: string, body: unknown, token?: string) {
    const response = await request.post(`${api}${path}`, { data: body, headers: { 'X-CSRF-Token': await csrf(), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  }

  async function patch(path: string, body: unknown, token: string) {
    return request.patch(`${api}${path}`, { data: body, headers: { 'X-CSRF-Token': await csrf(), Authorization: `Bearer ${token}` } });
  }

  async function postRaw(path: string, body: unknown, token: string) {
    return request.post(`${api}${path}`, { data: body, headers: { 'X-CSRF-Token': await csrf(), Authorization: `Bearer ${token}` } });
  }

  async function remove(path: string, token: string) {
    return request.delete(`${api}${path}`, { headers: { 'X-CSRF-Token': await csrf(), Authorization: `Bearer ${token}` } });
  }

  async function register(email: string, firstName: string) {
    await post('/auth/register', { firstName, lastName: 'Isolation', email, phone: '1234567890', password: 'StrongPass9!', confirmPassword: 'StrongPass9!' });
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    return (await post('/auth/login', { email, password: 'StrongPass9!' })).accessToken as string;
  }

  const tokenA = await register(`endpoint-a-${unique}@example.com`, 'OwnerA');
  const tokenB = await register(`endpoint-b-${unique}@example.com`, 'OwnerB');
  const propertyA = await post('/portfolio/properties', { name: 'Owner A', address: 'A Street', phone: '1234567890', propertyType: 'RESIDENTIAL' }, tokenA);
  const propertyB = await post('/portfolio/properties', { name: 'Owner B', address: 'B Street', phone: '1234567890', propertyType: 'RESIDENTIAL' }, tokenB);
  const unitB = await post(`/portfolio/properties/${propertyB.id}/units`, { unitNo: `B-${unique}`, unitType: 'FLAT', rent: 1000, unitAttributes: { bedrooms: 2, bathrooms: 1 } }, tokenB);
  const tenantB = await post('/tenants', { unitId: unitB.id, name: 'Tenant B', phone: '1234567890', address: 'B Street', moveInDate: '2026-09-01', monthlyRent: 1000, securityDeposit: 1000 }, tokenB);
  await post('/billing/generate', { billMonth: '2026-09-01' }, tokenB);
  const billsB = await (await request.get(`${api}/billing/bills`, { headers: { Authorization: `Bearer ${tokenB}` } })).json();
  const billB = billsB[0];
  const repairB = await post('/repairs', { unitId: unitB.id, repairDate: '2026-09-02', category: 'Plumbing', description: 'B repair', cost: 50, paidBy: 'OWNER' }, tokenB);

  const updateProperty = await patch(`/portfolio/properties/${propertyB.id}`, { name: 'IDOR attempt' }, tokenA);
  expect(updateProperty.status()).toBe(404);
  const deleteProperty = await remove(`/portfolio/properties/${propertyB.id}`, tokenA);
  expect(deleteProperty.status()).toBe(404);
  const updateUnit = await patch(`/portfolio/units/${unitB.id}`, { rent: 1 }, tokenA);
  expect(updateUnit.status()).toBe(404);
  const deleteUnit = await remove(`/portfolio/units/${unitB.id}`, tokenA);
  expect(deleteUnit.status()).toBe(404);
  const tenantPreview = await request.get(`${api}/tenants/${tenantB.id}/settlement-preview`, { headers: { Authorization: `Bearer ${tokenA}` } });
  expect(tenantPreview.status()).toBe(404);
  const tenantMoveOut = await postRaw(`/tenants/${tenantB.id}/move-out`, { moveOutDate: '2026-09-15', moveOutReason: 'IDOR attempt' }, tokenA);
  expect(tenantMoveOut.status()).toBe(404);
  const paymentAttempt = await postRaw(`/billing/bills/${billB.id}/payments`, { amount: 1, paidOn: '2026-09-05', method: 'CASH' }, tokenA);
  expect(paymentAttempt.status()).toBe(404);
  const repairUpdate = await patch(`/repairs/${repairB.id}`, { description: 'IDOR attempt' }, tokenA);
  expect(repairUpdate.status()).toBe(404);
  const repairDelete = await remove(`/repairs/${repairB.id}`, tokenA);
  expect(repairDelete.status()).toBe(404);
  const ownerATransactions = await request.get(`${api}/reports/transactions`, { headers: { Authorization: `Bearer ${tokenA}` } });
  expect(ownerATransactions.ok()).toBeTruthy();
  expect((await ownerATransactions.json()).rows).toHaveLength(0);

  await prisma.$disconnect();
});
