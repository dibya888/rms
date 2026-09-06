import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const permissions = ['portfolio:read', 'portfolio:write', 'admin:read', 'admin:write'];
  for (const name of permissions) {
    await prisma.permission.upsert({ where: { name }, update: {}, create: { name } });
  }

  await prisma.role.upsert({
    where: { name: 'OWNER_ADMIN' },
    update: {},
    create: {
      name: 'OWNER_ADMIN',
      description: 'Landlord managing their own portfolio',
      permissions: {
        create: permissions.slice(0, 2).map((name) => ({ permission: { connect: { name } } })),
      },
    },
  });
  await prisma.role.upsert({
    where: { name: 'SYSTEM_ADMIN' },
    update: {},
    create: {
      name: 'SYSTEM_ADMIN',
      description: 'Platform staff administrator',
      permissions: {
        create: permissions.map((name) => ({ permission: { connect: { name } } })),
      },
    },
  });
}

main().finally(() => prisma.$disconnect());
