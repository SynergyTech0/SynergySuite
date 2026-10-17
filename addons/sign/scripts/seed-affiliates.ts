
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding affiliate system...');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@synergysign.com' },
    update: {},
    create: {
      email: 'admin@synergysign.com',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      name: 'Admin User',
      role: 'ADMIN',
      referralCode: 'ADMIN_SYNERGY',
      subscription: {
        create: {
          tier: 'ENTERPRISE',
          status: 'ACTIVE',
        }
      }
    }
  });

  console.log('✓ Created admin user:', admin.email);

  // Create a test affiliate user with payment info
  const affiliatePassword = await bcrypt.hash('affiliate123', 12);
  const affiliate = await prisma.user.upsert({
    where: { email: 'affiliate@synergysign.com' },
    update: {},
    create: {
      email: 'affiliate@synergysign.com',
      password: affiliatePassword,
      firstName: 'Test',
      lastName: 'Affiliate',
      name: 'Test Affiliate',
      role: 'SENDER',
      referralCode: 'TESTAFFILIATE',
      payoutMethod: 'stripe',
      payoutEmail: 'affiliate@synergysign.com',
      // Note: In production, this would be a real Stripe Connect account ID
      stripeAccountId: 'acct_test_example',
      subscription: {
        create: {
          tier: 'PRO',
          status: 'ACTIVE',
        }
      }
    }
  });

  console.log('✓ Created affiliate user:', affiliate.email);

  // Create some test referrals
  for (let i = 1; i <= 3; i++) {
    const userPassword = await bcrypt.hash('password123', 12);
    const referral = await prisma.user.upsert({
      where: { email: `referral${i}@synergysign.com` },
      update: {},
      create: {
        email: `referral${i}@synergysign.com`,
        password: userPassword,
        firstName: `Referral ${i}`,
        lastName: 'User',
        name: `Referral ${i} User`,
        role: 'SENDER',
        referredById: affiliate.id,
        referralCode: `REF${i}_${Math.random().toString(36).substring(2, 8)}`.toUpperCase(),
        subscription: {
          create: {
            tier: 'BASIC',
            status: 'ACTIVE',
          }
        }
      }
    });

    console.log(`✓ Created referral user ${i}:`, referral.email);
  }

  console.log('\n✅ Affiliate system seeded successfully!\n');
  console.log('Login credentials:');
  console.log('Admin: admin@synergysign.com / Admin@123');
  console.log('Affiliate: affiliate@synergysign.com / affiliate123');
  console.log('\nThe affiliate user has 3 active paid referrals, earning $6/week.');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
