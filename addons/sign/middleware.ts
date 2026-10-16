import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Create rate limiter instance only if Redis env vars are present
let ratelimit: Ratelimit | null = null

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
    analytics: true,
    prefix: 'synergysign',
  })
}

// Stricter rate limits for sensitive endpoints
let authRatelimit: Ratelimit | null = null

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  authRatelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute for auth
    analytics: true,
    prefix: 'synergysign:auth',
  })
}

export async function middleware(request: NextRequest) {
  // Skip rate limiting if not configured
  if (!ratelimit || !authRatelimit) {
    console.warn('Rate limiting not configured - Upstash Redis env vars missing')
    return NextResponse.next()
  }

  // Get IP address
  const ip = request.ip ?? request.headers.get('x-forwarded-for') ?? '127.0.0.1'

  // Check if this is an auth endpoint
  const isAuthEndpoint =
    request.nextUrl.pathname.startsWith('/api/auth/signup') ||
    request.nextUrl.pathname.startsWith('/api/auth/signin') ||
    request.nextUrl.pathname.startsWith('/api/auth/verify')

  // Apply stricter rate limit for auth endpoints
  const limiter = isAuthEndpoint ? authRatelimit : ratelimit

  try {
    const { success, limit, reset, remaining } = await limiter.limit(ip)

    // Add rate limit headers to response
    const response = success
      ? NextResponse.next()
      : new NextResponse(JSON.stringify({
          error: 'Too many requests',
          message: 'Please try again later',
          retryAfter: Math.floor((reset - Date.now()) / 1000)
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
          }
        })

    response.headers.set('X-RateLimit-Limit', limit.toString())
    response.headers.set('X-RateLimit-Remaining', remaining.toString())
    response.headers.set('X-RateLimit-Reset', reset.toString())

    return response
  } catch (error) {
    // If rate limiting fails, allow the request through (fail open)
    console.error('Rate limiting error:', error)
    return NextResponse.next()
  }
}

// Configure which paths to apply middleware to
export const config = {
  matcher: [
    '/api/:path*',
    '/dashboard/:path*',
    '/auth/:path*',
  ],
}
