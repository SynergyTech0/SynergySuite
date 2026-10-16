import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Health Check Endpoint
 * Used by AWS Application Load Balancer to verify instance health
 *
 * Returns 200 OK if:
 * - Application is running
 * - Database connection is healthy
 *
 * Returns 503 Service Unavailable if:
 * - Database cannot be reached
 * - Critical services are down
 */
export async function GET() {
  try {
    // Quick database health check - just verify we can connect
    // Using a simple query that should complete quickly
    if (prisma && prisma.$queryRaw) {
      await prisma.$queryRaw`SELECT 1 as health`
    }

    // All checks passed
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: prisma ? 'connected' : 'unavailable',
      uptime: process.uptime(),
      memory: {
        used: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
        total: Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100,
        external: Math.round((process.memoryUsage().external / 1024 / 1024) * 100) / 100,
      },
      nodeVersion: process.version,
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': 'application/json',
      }
    })

  } catch (error) {
    console.error('Health check failed:', error)

    // Health check failed - return 503
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': 'application/json',
      }
    })
  }
}

// Simple HEAD request support for minimal health checks
export async function HEAD() {
  try {
    if (prisma && prisma.$queryRaw) {
      await prisma.$queryRaw`SELECT 1 as health`
    }
    return new NextResponse(null, { status: 200 })
  } catch {
    return new NextResponse(null, { status: 503 })
  }
}
