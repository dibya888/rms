import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

test('admin routes enforce RBAC and audit administrative changes', async ({ request }) => {
  test.setTimeout(120_000);
  const api = 'http://127.0.0.1:3000';
  const prisma = new PrismaClient();
  const unique = Date.now();

  async function csrf() {
    const response = await request.get(`${api}/auth/csrf`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).csrfToken as string;
  }

  async function register(email: string, firstName: string) {
    const response = await request.post(`${api}/auth/register`, { data: { firstName, lastName: 'AdminTest', email, phone: '1234567890', password: 'StrongPass9!', confirmPassword: 'StrongPass9!' }, headers: { 'X-CSRF-Token': await csrf() } });
    expect(response.ok()).toBeTruthy();
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const login = await request.post(`${api}/auth/login`, { data: { email, password: 'StrongPass9!' }, headers: { 'X-CSRF-Token': await csrf() } });
    expect(login.ok()).toBeTruthy();
    return { id: (await prisma.user.findUniqueOrThrow({ where: { email } })).id, token: (await login.json()).accessToken as string };
  }

  const owner = await register(`admin-owner-${unique}@example.com`, 'Owner');
  const admin = await register(`system-admin-${unique}@example.com`, 'System');
  const systemRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SYSTEM_ADMIN' } });
  await prisma.userRole.deleteMany({ where: { userId: admin.id } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: systemRole.id } });
  const adminLogin = await request.post(`${api}/auth/login`, { data: { email: `system-admin-${unique}@example.com`, password: 'StrongPass9!' }, headers: { 'X-CSRF-Token': await csrf() } });
  const adminToken = (await adminLogin.json()).accessToken as string;

  const denied = await request.get(`${api}/admin/users`, { headers: { Authorization: `Bearer ${owner.token}` } });
  expect(denied.status()).toBe(403);
  const users = await request.get(`${api}/admin/users`, { headers: { Authorization: `Bearer ${adminToken}` } });
  expect(users.ok()).toBeTruthy();
  const roles = await request.get(`${api}/admin/roles`, { headers: { Authorization: `Bearer ${adminToken}` } });
  expect(roles.ok()).toBeTruthy();

  const statusUpdate = await request.patch(`${api}/admin/users/${owner.id}/status`, { data: { status: 'SUSPENDED' }, headers: { Authorization: `Bearer ${adminToken}`, 'X-CSRF-Token': await csrf() } });
  expect(statusUpdate.ok()).toBeTruthy();
  const ownerRole = (await roles.json()).find((role: { name: string }) => role.name === 'OWNER_ADMIN');
  const roleUpdate = await request.patch(`${api}/admin/users/${owner.id}/role`, { data: { roleId: ownerRole.id, reason: 'Verified admin test' }, headers: { Authorization: `Bearer ${adminToken}`, 'X-CSRF-Token': await csrf() } });
  expect(roleUpdate.ok(), await roleUpdate.text()).toBeTruthy();
  const logs = await request.get(`${api}/admin/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const actions = (await logs.json()).map((log: { action: string }) => log.action);
  expect(actions).toEqual(expect.arrayContaining(['USER_SUSPENDED', 'ROLE_CHANGED']));
  await prisma.$disconnect();
});
