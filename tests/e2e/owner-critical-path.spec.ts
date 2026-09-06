import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

test('owner can complete the property-to-settlement workflow', async ({ request }) => {
  test.setTimeout(120_000);
  const api = 'http://127.0.0.1:3000';
  const unique = Date.now();
  const email = `critical-${unique}@example.com`;
  const password = 'StrongPass9!';
  const prisma = new PrismaClient();

  async function csrf() {
    const response = await request.get(`${api}/auth/csrf`);
    expect(response.ok(), `CSRF request returned ${response.status()}: ${await response.text()}`).toBeTruthy();
    return (await response.json()).csrfToken as string;
  }

  async function post(path: string, body: unknown, accessToken?: string) {
    const response = await request.post(`${api}${path}`, {
      data: body,
      headers: {
        'X-CSRF-Token': await csrf(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  }

  await post('/auth/register', { firstName: 'Critical', middleName: 'Path', lastName: 'Owner', email, phone: '1234567890', password, confirmPassword: password });
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const login = await post('/auth/login', { email, password });
  const accessToken = login.accessToken as string;

  const property = await post('/portfolio/properties', { name: `Critical Property ${unique}`, address: '1 Acceptance Street', phone: '1234567890', propertyType: 'RESIDENTIAL' }, accessToken);
  const unit = await post(`/portfolio/properties/${property.id}/units`, { unitNo: `C-${unique}`, unitType: 'FLAT', rent: 1000, unitAttributes: { bedrooms: 2, bathrooms: 1 } }, accessToken);
  const tenant = await post('/tenants', { unitId: unit.id, name: 'Critical Tenant', phone: '1234567890', address: '1 Acceptance Street', moveInDate: '2026-09-01', monthlyRent: 1000, securityDeposit: 1000 }, accessToken);

  await post('/billing/generate', { billMonth: '2026-09-01' }, accessToken);
  const billsResponse = await request.get(`${api}/billing/bills`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(billsResponse.ok()).toBeTruthy();
  const bills = await billsResponse.json();
  const bill = bills.find((candidate: { lease: { tenantId: string } }) => candidate.lease.tenantId === tenant.id);
  expect(bill).toBeDefined();

  const partial = await post(`/billing/bills/${bill.id}/payments`, { amount: 500, paidOn: '2026-09-05', method: 'CASH' }, accessToken);
  expect(partial.bill.status).toBe('PARTIAL');
  const paid = await post(`/billing/bills/${bill.id}/payments`, { amount: 500, paidOn: '2026-09-05', method: 'CASH' }, accessToken);
  expect(paid.bill.status).toBe('PAID');
  expect(paid.bill.receiptNo).toMatch(/^RCP-2026-\d{6}$/);

  const preview = await request.get(`${api}/tenants/${tenant.id}/settlement-preview`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(preview.ok()).toBeTruthy();
  expect((await preview.json()).result).toBe('REFUND');

  const movedOut = await post(`/tenants/${tenant.id}/move-out`, { moveOutDate: '2026-09-15', moveOutReason: 'Acceptance flow complete' }, accessToken);
  expect(movedOut.status).toBe('MOVED_OUT');
  expect(movedOut.settlement.result).toBe('REFUND');

  const settled = await post(`/tenants/settlements/${movedOut.settlementId}/settle`, { result: 'SETTLED', refundAmount: 0, payableAmount: 0, reason: 'Refund processed' }, accessToken);
  expect(settled.result).toBe('SETTLED');
  await prisma.$disconnect();
});
