import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upgradeToAdmin(email: string) {
  console.log('🔄 Upgrading account to ADMIN...');
  console.log('📧 Email:', email);

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { email },
    include: { subscription: true }
  });

  if (!user) {
    console.log('❌ User not found!');
    process.exit(1);
  }

  console.log('Current role:', user.role);
  console.log('Current subscription:', user.subscription?.tier || 'None');

  // Update to ADMIN and verify email
  const updated = await prisma.user.update({
    where: { email },
    data: {
      role: 'ADMIN',
      emailVerified: new Date()
    },
    include: { subscription: true }
  });

  // Ensure they have a subscription
  if (!updated.subscription) {
    console.log('📦 Creating ENTERPRISE subscription...');
    await prisma.subscription.create({
      data: {
        userId: updated.id,
        tier: 'ENTERPRISE',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }
    });
  }

  console.log('\n✅ Account upgraded successfully!');
  console.log('═══════════════════════════════════════');
  console.log('Name:', updated.name);
  console.log('Email:', updated.email);
  console.log('Role:', updated.role);
  console.log('Email Verified: ✅');
  console.log('Subscription:', updated.subscription?.tier || 'ENTERPRISE');
  console.log('═══════════════════════════════════════\n');
}

const email = process.argv[2] || 'admin@example.com';
upgradeToAdmin(email)
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
