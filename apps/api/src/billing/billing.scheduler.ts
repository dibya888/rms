import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { BillingService } from './billing.service';

@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(BillingService) private readonly billing: BillingService) {}

  @Cron('0 2 1 * *')
  async generateCurrentMonthBills() {
    const billMonth = new Date().toISOString().slice(0, 10);
    const owners = await this.prisma.user.findMany({ where: { status: 'ACTIVE', userRoles: { some: { role: { name: 'OWNER_ADMIN' } } } }, select: { id: true } });
    for (const owner of owners) {
      try {
        await this.billing.generateBills(owner.id, { billMonth });
      } catch (error) {
        this.logger.error(`Monthly bill generation failed for owner ${owner.id}`, error instanceof Error ? error.stack : String(error));
      }
    }
  }
}
