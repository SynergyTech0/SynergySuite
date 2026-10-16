import { Public } from '../auth/guards/suite-auth.guard';
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  async check() {
    const dbHealthy = await this.checkDatabase();

    return {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'books',
      version: '0.1.0',
      checks: {
        database: dbHealthy ? 'connected' : 'disconnected',
      },
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check endpoint' })
  async ready() {
    const dbHealthy = await this.checkDatabase();

    if (!dbHealthy) {
      return {
        status: 'not_ready',
        reason: 'Database connection failed',
      };
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
