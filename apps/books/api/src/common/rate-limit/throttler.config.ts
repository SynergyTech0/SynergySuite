import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Use user ID if authenticated, otherwise use IP
    if (req.user && req.user.id) {
      return `user_${req.user.id}`;
    }
    return req.ip;
  }
}

// Rate limit configurations
export const RATE_LIMIT_CONFIG = {
  // Global default limit: 100 requests per 60 seconds
  global: {
    limit: 100,
    ttl: 60,
  },

  // Authentication endpoints: 10 requests per 60 seconds
  auth: {
    limit: 10,
    ttl: 60,
  },

  // Bulk import: 5 requests per 60 seconds
  bulkImport: {
    limit: 5,
    ttl: 60,
  },

  // Invoice creation: 50 requests per 60 seconds
  invoice: {
    limit: 50,
    ttl: 60,
  },

  // Report generation: 10 requests per 60 seconds (expensive operation)
  reporting: {
    limit: 10,
    ttl: 60,
  },

  // API documentation: 200 requests per 60 seconds (usually static)
  docs: {
    limit: 200,
    ttl: 60,
  },
};

// Transform rate limit config to Throttler format
export function createThrottlerOptions(limit: number, ttl: number): ThrottlerOptions[] {
  return [
    {
      name: 'short',
      ttl,
      limit,
    },
  ];
}
