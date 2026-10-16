
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create test admin user (required for testing)
  const adminPasswordHash = await bcrypt.hash('johndoe123', 12);
  const testAdmin = await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      password: adminPasswordHash,
      firstName: 'John',
      lastName: 'Doe',
      name: 'John Doe',
      role: 'ADMIN',
      companyName: 'Test Company',
      subscription: {
        create: {
          tier: 'ENTERPRISE',
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        }
      }
    },
    include: {
      subscription: true
    }
  });

  // Create additional admin user as requested
  const adminPasswordHash2 = await bcrypt.hash('admin123', 12);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@docusign.com' },
    update: {},
    create: {
      email: 'admin@docusign.com',
      password: adminPasswordHash2,
      firstName: 'Admin',
      lastName: 'User',
      name: 'Admin User',
      role: 'ADMIN',
      companyName: 'DocuSign Inc',
      subscription: {
        create: {
          tier: 'ENTERPRISE',
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        }
      }
    },
    include: {
      subscription: true
    }
  });

  // Create sample sender user
  const senderPasswordHash = await bcrypt.hash('sender123', 12);
  const senderUser = await prisma.user.upsert({
    where: { email: 'sender@example.com' },
    update: {},
    create: {
      email: 'sender@example.com',
      password: senderPasswordHash,
      firstName: 'Sarah',
      lastName: 'Sender',
      name: 'Sarah Sender',
      role: 'SENDER',
      companyName: 'Business Corp',
      subscription: {
        create: {
          tier: 'PRO',
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        }
      }
    },
    include: {
      subscription: true
    }
  });

  // Create sample signer user
  const signerPasswordHash = await bcrypt.hash('signer123', 12);
  const signerUser = await prisma.user.upsert({
    where: { email: 'signer@example.com' },
    update: {},
    create: {
      email: 'signer@example.com',
      password: signerPasswordHash,
      firstName: 'Mike',
      lastName: 'Signer',
      name: 'Mike Signer',
      role: 'SIGNER',
      subscription: {
        create: {
          tier: 'FREE',
          status: 'TRIAL',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days trial
        }
      }
    },
    include: {
      subscription: true
    }
  });

  console.log('✅ Database seeded successfully!');
  console.log('Created users:');
  console.log('- Test Admin (john@doe.com) - ENTERPRISE');
  console.log('- Admin User (admin@docusign.com) - ENTERPRISE');  
  console.log('- Sarah Sender (sender@example.com) - PRO');
  console.log('- Mike Signer (signer@example.com) - FREE/TRIAL');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

