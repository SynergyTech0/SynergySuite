import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { LoggerService } from '../logger/logger.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(@Inject(LoggerService) private logger: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Generate request ID
    (req as any).id = uuidv4();

    const startTime = Date.now();

    // Intercept response end
    const logger = this.logger;
    const originalEnd = res.end.bind(res) as (...endArgs: unknown[]) => Response;
    res.end = function (...args: unknown[]) {
      const duration = Date.now() - startTime;

      logger.log(
        `[${req.method}] ${req.path}`,
        {
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          userId: (req as any).user?.id,
          organizationId: (req as any).user?.organizationId,
          requestId: (req as any).id,
        },
      );

      return originalEnd(...args);
    } as Response['end'];

    next();
  }
}
