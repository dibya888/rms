import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { PrismaService } from '../prisma.service';
import { RepairsController } from './repairs.controller';
import { RepairsService } from './repairs.service';

@Module({ imports: [JwtModule.register({})], controllers: [RepairsController], providers: [RepairsService, PrismaService, AccessTokenGuard] })
export class RepairsModule {}
