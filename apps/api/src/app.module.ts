import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { BillingModule } from './billing/billing.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';
import { RepairsModule } from './repairs/repairs.module';
import { PrismaService } from './prisma.service';

@Module({
  imports: [ScheduleModule.forRoot(), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), AuthModule, PortfolioModule, TenancyModule, BillingModule, DashboardModule, AdminModule, ReportsModule, RepairsModule],
  controllers: [AppController],
  providers: [PrismaService],
})
export class AppModule {}
