import { Catch, ArgumentsHost, ExceptionFilter, HttpStatus, Inject } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LoggerService) private logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = (exceptionResponse as any).message || exception.message;
      details = exceptionResponse as any;
    } else if (exception instanceof Error) {
      message = exception.message;
      details = {
        name: exception.name,
        stack: process.env.NODE_ENV === 'production' ? undefined : exception.stack,
      };
    }

    // Log error
    this.logger.error(
      `[${request.method}] ${request.path}`,
      {
        status,
        message,
        details,
        userId: (request as any).user?.id,
        organizationId: (request as any).user?.organizationId,
      },
    );

    // Send response
    response.status(status).json({
      statusCode: status,
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
      requestId: (request as any).id,
      ...(process.env.NODE_ENV !== 'production' && { details }),
    });
  }
}
