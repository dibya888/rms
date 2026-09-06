import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PrismaService } from '../prisma.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [JwtModule.register({})], controllers: [ReportsController], providers: [ReportsService, PrismaService, AccessTokenGuard] })
export class ReportsModule {}
