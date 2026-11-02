import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { foundationHealth } from './health-status';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return foundationHealth();
  }

  @Get('ready')
  readiness() {
    // Safe-by-default: readiness is NOT granted until database and core services
    // are implemented/tested in issues #3–#6.
    throw new ServiceUnavailableException({
      status: 'not_ready',
      reason: 'Tenant authentication and database dependencies are not configured',
    });
  }
}
