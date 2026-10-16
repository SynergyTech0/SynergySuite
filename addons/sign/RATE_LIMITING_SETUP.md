# Rate Limiting Setup Guide

**Status**: ✅ Implemented with Upstash
**Date**: November 29, 2025
**Ready for**: December 1st Launch

---

## Overview

SynergySign now includes enterprise-grade rate limiting powered by **Upstash Redis** to protect against:
- DDoS attacks
- Brute force attacks on authentication
- API abuse
- Resource exhaustion

---

## Rate Limits Configured

### General API Endpoints
- **Limit**: 100 requests per minute per IP
- **Applies to**: `/api/*`, `/dashboard/*`
- **Response**: `429 Too Many Requests` when exceeded

### Authentication Endpoints (Stricter)
- **Limit**: 10 requests per minute per IP
- **Applies to**:
  - `/api/auth/signup`
  - `/api/auth/signin`
  - `/api/auth/verify`
- **Response**: `429 Too Many Requests` with retry-after header

### Response Headers
All responses include:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1638360000
```

---

## Setup Instructions (5 minutes)

### Step 1: Create Upstash Account

1. Go to [https://console.upstash.com/](https://console.upstash.com/)
2. Sign up with GitHub or email (free tier available)
3. Verify your email

### Step 2: Create Redis Database

1. Click "Create Database"
2. Configure:
   - **Name**: `synergysign-ratelimit`
   - **Type**: Regional (cheaper) or Global (faster)
   - **Region**: Choose closest to your users (e.g., `us-east-1` for AWS)
   - **TLS**: Enabled (recommended)
3. Click "Create"

### Step 3: Get Credentials

1. On the database details page, find:
   - **REST URL**: `https://us1-xxx.upstash.io`
   - **REST Token**: `AXXXxxx...`
2. Click "Copy" buttons

### Step 4: Add to Environment Variables

Add these to your `.env` file:

```bash
# Upstash Redis for Rate Limiting
UPSTASH_REDIS_REST_URL="https://your-region.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-token-here"
```

### Step 5: Restart Application

```bash
# Development
npm run dev

# Production
npm run build
pm2 restart synergysign
```

---

## Testing Rate Limits

### Test General Endpoint (100 req/min)

```bash
# This should succeed
for i in {1..50}; do
  curl -X GET http://localhost:3000/api/dashboard/stats
  echo "Request $i"
done

# This should eventually return 429
for i in {1..150}; do
  curl -X GET http://localhost:3000/api/dashboard/stats
  echo "Request $i"
done
```

### Test Auth Endpoint (10 req/min)

```bash
# This should fail after 10 requests
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"test123"}'
  echo "Request $i"
done
```

Expected response when rate limited:
```json
{
  "error": "Too many requests",
  "message": "Please try again later",
  "retryAfter": 45
}
```

---

## Cost Estimation

### Upstash Pricing (as of Nov 2025)

**Free Tier** (Good for testing):
- 10,000 commands/day
- 256 MB storage
- TLS included
- **Cost**: $0/month

**Pay-as-you-go** (Production - 500K users):
- $0.20 per 100K commands
- Estimated daily commands: ~5M (10 req/user/day)
- Daily cost: ~$10
- **Monthly cost**: ~$300

**Pro 2K Plan** (Recommended):
- 2M commands/day included
- Additional: $0.20 per 100K
- **Cost**: $280/month base + overages
- **Total estimate**: $400-500/month

### Cost Comparison

| Users | Daily Requests | Free Tier | Pay-as-you-go | Pro 2K |
|-------|---------------|-----------|---------------|---------|
| 5,000 | 50,000 | ✅ Free | $0.10 | Included |
| 50,000 | 500,000 | ❌ | $1/day | Included |
| 500,000 | 5,000,000 | ❌ | $10/day | $6/day + base |

**Recommendation for December 1st launch**:
- **Week 1** (5K users): Free tier
- **Week 2** (50K users): Pro 2K plan ($280/month)
- **Week 3+** (500K users): Pro 2K + overages ($400-500/month)

---

## Monitoring

### Upstash Dashboard

View real-time metrics:
- Total commands/day
- Peak requests/second
- Storage usage
- Response times

Access: [https://console.upstash.com/redis](https://console.upstash.com/redis)

### Custom Monitoring

Add to your monitoring dashboard:

```typescript
// In your analytics service
fetch('/api/internal/rate-limit-stats')
  .then(res => res.json())
  .then(data => {
    console.log('Rate limit hits:', data.limitedRequests)
    console.log('Total requests:', data.totalRequests)
    console.log('Block rate:', data.blockRate + '%')
  })
```

---

## Adjusting Rate Limits

### Increase Limits for Authenticated Users

Edit `middleware.ts`:

```typescript
// Get user from session
const session = await getToken({ req: request })

if (session?.user) {
  // Authenticated users get 1000 req/min
  const authenticatedLimiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(1000, '1 m'),
  })
  const result = await authenticatedLimiter.limit(session.user.email)
  // ...
}
```

### Different Limits for Enterprise Users

```typescript
if (session?.user?.role === 'ENTERPRISE') {
  // Enterprise users get unlimited
  return NextResponse.next()
}
```

### API Key-based Limits

```typescript
const apiKey = request.headers.get('x-api-key')
if (apiKey) {
  // 10,000 req/min for API keys
  const apiLimiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10000, '1 m'),
    prefix: 'api-key',
  })
  const result = await apiLimiter.limit(apiKey)
  // ...
}
```

---

## Fallback Strategy

If Upstash is down or credentials are missing:

1. **Fail Open**: Requests are allowed through
2. **Warning Logged**: Check console for errors
3. **No Breaking**: Application continues to work

This is configured in `middleware.ts`:

```typescript
if (!ratelimit) {
  console.warn('Rate limiting not configured')
  return NextResponse.next() // Allow request through
}
```

---

## Alternative Solutions

### If Upstash doesn't work for you

**Option 1: CloudFlare** (Easiest, zero-code)
- Point DNS to CloudFlare
- Enable rate limiting rules
- Cost: $0-20/month
- Setup time: 30 minutes

**Option 2: AWS WAF** (Best for enterprise)
- Configure WAF rules on API Gateway
- DDoS protection included
- Cost: $150-300/month
- Setup time: 2-3 hours

**Option 3: Redis on AWS ElastiCache**
- Use same Upstash code
- Self-hosted Redis
- Cost: $50-100/month (t3.micro)
- More control, more maintenance

---

## Troubleshooting

### Issue: "Rate limiting not configured"

**Cause**: Missing Upstash credentials
**Fix**: Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to `.env`

### Issue: Rate limits too strict

**Cause**: Low default limits
**Fix**: Edit `middleware.ts` and increase from `100` to `500` or `1000`

### Issue: Legitimate users blocked

**Cause**: Shared IP (corporate network, VPN)
**Fix**: Implement authenticated user exemptions (see above)

### Issue: High Upstash costs

**Cause**: Too many Redis commands
**Fix**: Increase window size (e.g., `10 m` instead of `1 m`) to reduce commands

---

## Security Best Practices

✅ **Implemented**:
- Per-IP rate limiting
- Stricter limits for auth endpoints
- Graceful degradation (fail open)
- Rate limit headers in responses

⚠️ **Recommended Additions**:
- [ ] CAPTCHA after 3 failed login attempts
- [ ] IP allowlist for internal services
- [ ] Geofencing (block certain countries)
- [ ] Device fingerprinting

---

## Production Checklist

Before December 1st launch:

- [ ] Upstash account created
- [ ] Redis database created
- [ ] Credentials added to production `.env`
- [ ] Rate limiting tested (see Testing section)
- [ ] Monitoring dashboard configured
- [ ] Team trained on adjusting limits
- [ ] Fallback plan documented

---

## Next Steps

1. **TONIGHT**: Create Upstash account and add credentials
2. **SATURDAY**: Test rate limiting with load tests
3. **SUNDAY**: Monitor during first 5K user rollout
4. **WEEK 2**: Adjust limits based on real usage patterns

---

**Questions?**
- Upstash Docs: https://docs.upstash.com/redis
- Rate Limit Examples: https://upstash.com/docs/redis/features/ratelimiting

---

*Rate limiting implemented: November 29, 2025*
*Ready for production deployment*
