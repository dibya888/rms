import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', service: 'rms-api', database: 'connected' };
    } catch (error) {
      this.logger.error('Database readiness query failed', error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException({ status: 'error', service: 'rms-api', database: 'unavailable' });
    }
  }
}
