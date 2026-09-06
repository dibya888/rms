import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PrismaService } from '../prisma.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingScheduler } from './billing.scheduler';

@Module({
  imports: [JwtModule.register({})],
  controllers: [BillingController],
  providers: [BillingService, PrismaService, AccessTokenGuard, BillingScheduler],
})
export class BillingModule {}
