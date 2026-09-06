import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PrismaService } from '../prisma.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [DashboardController],
  providers: [DashboardService, PrismaService, AccessTokenGuard],
})
export class DashboardModule {}
