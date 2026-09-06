import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PrismaService } from '../prisma.service';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';
import { StorageService } from '../storage.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [TenancyController],
  providers: [TenancyService, PrismaService, AccessTokenGuard, StorageService],
})
export class TenancyModule {}
