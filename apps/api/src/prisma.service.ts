import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async withOwner<T>(ownerId: string, callback: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.current_owner_id', ${ownerId}, true)`;
      return callback(transaction);
    }, { timeout: 30_000 });
  }

  async withSystemAdmin<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.is_system_admin', 'true', true)`;
      return callback(transaction);
    }, { timeout: 30_000 });
  }

  async onModuleInit() {
    await Promise.race([
      this.$connect(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PostgreSQL connection timed out after 15 seconds. Check Neon availability and DATABASE_URL locally.')), 15_000)),
    ]);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
