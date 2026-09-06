import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { JwtModule } from '@nestjs/jwt';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PortfolioController],
  providers: [PortfolioService, PrismaService, AccessTokenGuard],
})
export class PortfolioModule {}
