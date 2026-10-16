
# SynergySign Affiliate Marketing Platform

## Overview

The SynergySign affiliate marketing platform allows users to earn $2/month for each person they refer who subscribes to a paid plan. This creates a powerful incentive for users to promote the platform.

## Features

### For All Users

#### 1. **Personal Affiliate Dashboard** (`/dashboard/affiliates`)
- **Referral Link**: Each user gets a unique referral link with their referral code
- **Stats Overview**:
  - Total referrals count
  - Active referrals (on paid plans)
  - Total earnings (lifetime)
  - Pending earnings (awaiting payout)
  - Monthly earnings estimate
- **Referrals Table**: View all users who signed up using their referral link
- **Earnings History**: Detailed breakdown of monthly earnings from each referral

#### 2. **Referral Tracking**
- Referral codes are automatically generated for each user
- When someone signs up with a referral link (`/auth/signup?ref=CODE`), the system:
  - Tracks the referrer-referee relationship
  - Shows a confirmation message during signup
  - Automatically calculates earnings when referrals subscribe to paid plans

### For Admins

#### 1. **Admin Affiliate Management** (`/admin/affiliates`)
- **Overview Stats**:
  - Active affiliates count
  - Total earnings paid out
  - Pending payouts amount
- **Pending Payouts Table**: Process payments for affiliates
- **All Affiliates Table**: View complete affiliate statistics

#### 2. **Payout Processing**
- Manual payout processing with:
  - Payment method selection (Stripe, PayPal, Bank Transfer)
  - Transaction ID tracking
  - Optional notes
- Automatic update of earnings status
- Complete payout history tracking

## How It Works

### 1. User Signs Up with Referral Link
```
https://your-domain.com/auth/signup?ref=REFERRAL_CODE
```

### 2. Referral Relationship Created
- New user's `referredById` field is set to the referrer's ID
- Referrer can now see this user in their affiliate dashboard

### 3. Referred User Subscribes to Paid Plan
- When the referred user upgrades from FREE to BASIC, PRO, or ENTERPRISE
- The subscription status is tracked

### 4. Monthly Earnings Calculation
- A cron job runs monthly (first day of each month)
- For each active referral on a paid plan, creates an earning record:
  - Amount: $2.00
  - Month: Current month
  - Status: Unpaid
- Updates user's `pendingEarnings` and `totalEarnings`

### 5. Payout Processing
- Admin reviews pending payouts in `/admin/affiliates`
- Processes payout with payment details
- System marks all unpaid earnings as paid
- Resets user's `pendingEarnings` to 0
- Creates payout record for tracking

## Database Schema

### User Fields
```typescript
referralCode: String @unique @default(cuid())  // Unique referral code
referredById: String?                           // ID of who referred this user
totalEarnings: Float @default(0)                // Lifetime earnings
pendingEarnings: Float @default(0)              // Awaiting payout
```

### AffiliateEarning
```typescript
id: String @id
affiliateId: String           // The referrer
referredUserId: String        // The person referred
amount: Float                 // $2 per month
month: DateTime               // Which month
isPaid: Boolean @default(false)
payoutId: String?
```

### AffiliatePayout
```typescript
id: String @id
userId: String                // Affiliate receiving payout
amount: Float                 // Total payout amount
status: PayoutStatus          // PENDING, PROCESSING, COMPLETED, FAILED
paymentMethod: String?        // stripe, paypal, bank_transfer
transactionId: String?        // External transaction ID
notes: String?
processedAt: DateTime?
```

## API Endpoints

### User Endpoints
- `GET /api/affiliates/stats` - Get affiliate statistics
- `GET /api/affiliates/referrals` - Get list of referrals
- `GET /api/affiliates/earnings` - Get earnings history

### Admin Endpoints
- `GET /api/admin/affiliates/overview` - Get complete affiliate overview
- `POST /api/admin/affiliates/process-payout` - Process affiliate payout

### Cron Endpoint
- `GET /api/cron/calculate-earnings` - Calculate monthly earnings (requires CRON_SECRET)
- `POST /api/cron/calculate-earnings` - Manual trigger (requires ADMIN_SECRET)

## Setup Instructions

### 1. Environment Variables
Add these to your `.env` file:
```bash
CRON_SECRET=your_secure_random_string
ADMIN_SECRET=your_secure_random_string
```

### 2. Database Migration
The affiliate system tables are already included in the Prisma schema. Run:
```bash
npx prisma migrate dev
```

### 3. Create Admin User
An admin user is automatically created when you run the seed script:
```bash
npx tsx scripts/seed.ts
```

**Admin Credentials:**
- Email: `admin@synergysign.com`
- Password: `Admin@123`
- ⚠️ **Change this password after first login!**

### 4. Set Up Cron Job
To automatically calculate monthly earnings, set up a cron job to hit:
```bash
GET https://your-domain.com/api/cron/calculate-earnings
Authorization: Bearer YOUR_CRON_SECRET
```

Run this on the 1st of each month at midnight:
```bash
0 0 1 * * curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-domain.com/api/cron/calculate-earnings
```

## Testing the Affiliate System

### 1. Create Test Users
1. Sign up as User A
2. Copy User A's referral link from `/dashboard/affiliates`
3. Open referral link in incognito mode
4. Sign up as User B

### 2. Verify Tracking
- User A should see User B in their referrals table
- User B's status should show as "FREE" initially

### 3. Upgrade User B
- Log in as admin (`admin@synergysign.com`)
- Go to `/admin/users`
- Upgrade User B to a paid plan (BASIC, PRO, or ENTERPRISE)

### 4. Calculate Earnings
- Manually trigger earnings calculation:
```bash
curl -X POST https://your-domain.com/api/cron/calculate-earnings \
  -H "Content-Type: application/json" \
  -d '{"adminSecret": "YOUR_ADMIN_SECRET"}'
```

### 5. Process Payout
- Log in as admin
- Go to `/admin/affiliates`
- Click "Process Payout" for User A
- Enter payment details
- Confirm payout

## Customization

### Changing Commission Amount
To change from $2/month, update:
1. `/app/api/cron/calculate-earnings/route.ts` - Line with `amount: 2.0`
2. Update documentation and UI text accordingly

### Changing Payout Threshold
Add a minimum payout threshold:
```typescript
// In /app/api/admin/affiliates/overview/route.ts
const pendingPayouts = affiliates
  .filter((a) => a.pendingEarnings >= 10) // Minimum $10 payout
  .map(...)
```

### Adding Tiered Commissions
Implement different rates based on subscription tier:
```typescript
// In /app/api/cron/calculate-earnings/route.ts
const commissionRates = {
  BASIC: 2.0,
  PRO: 4.0,
  ENTERPRISE: 10.0,
};
const amount = commissionRates[referral.subscription.tier];
```

## Best Practices

1. **Regular Payouts**: Process payouts monthly to keep affiliates motivated
2. **Communication**: Email affiliates when they earn commissions
3. **Terms & Conditions**: Add affiliate program terms to your site
4. **Fraud Prevention**: Monitor for suspicious referral patterns
5. **Reporting**: Generate monthly affiliate reports for transparency

## Troubleshooting

### Referrals Not Tracking
- Check that referral code is being passed in URL
- Verify signup route is saving `referredById`

### Earnings Not Calculating
- Ensure cron job is running
- Check that referred users have active paid subscriptions
- Verify CRON_SECRET is correct

### Payouts Failing
- Check admin permissions
- Verify AffiliatePayout model is properly set up
- Ensure pending earnings exist before processing

## Future Enhancements

- [ ] Automatic payout via Stripe Connect
- [ ] Email notifications for new referrals and earnings
- [ ] Affiliate marketing materials and banners
- [ ] Performance leaderboard
- [ ] Bonus for milestone achievements
- [ ] Second-tier commissions (referrals of referrals)
