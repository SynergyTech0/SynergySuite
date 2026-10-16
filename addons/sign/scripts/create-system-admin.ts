import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createSystemAdmin(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  companyName: string = 'System Administration'
) {
  try {
    console.log('🔐 Creating SYSTEM_ADMIN user...');
    console.log(`📧 Email: ${email}`);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      console.log('⚠️  User with this email already exists!');
      console.log(`Current role: ${existingUser.role}`);

      // Ask if we should update the role
      console.log('\n🔄 Updating existing user to SYSTEM_ADMIN role and verifying email...');
      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          role: 'SYSTEM_ADMIN',
          emailVerified: new Date(), // Auto-verify admin accounts
        },
        include: {
          subscription: true
        }
      });

      console.log('✅ User updated successfully!');
      console.log(`Name: ${updatedUser.name}`);
      console.log(`Email: ${updatedUser.email}`);
      console.log(`Role: ${updatedUser.role}`);
      return updatedUser;
    }

    // Hash password
    console.log('🔒 Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create SYSTEM_ADMIN user
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        role: 'SYSTEM_ADMIN',
        companyName,
        emailVerified: new Date(), // Auto-verify admin accounts
        subscription: {
          create: {
            tier: 'ENTERPRISE',
            status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          }
        }
      },
      include: {
        subscription: true
      }
    });

    console.log('\n✅ SYSTEM_ADMIN user created successfully!');
    console.log('═══════════════════════════════════════');
    console.log(`Name: ${admin.name}`);
    console.log(`Email: ${admin.email}`);
    console.log(`Role: ${admin.role}`);
    console.log(`Company: ${admin.companyName}`);
    console.log(`Subscription Tier: ${admin.subscription?.tier}`);
    console.log(`Subscription Status: ${admin.subscription?.status}`);
    console.log('═══════════════════════════════════════\n');

    return admin;
  } catch (error) {
    console.error('❌ Error creating SYSTEM_ADMIN user:', error);
    throw error;
  }
}

async function main() {
  // Get arguments from command line or use defaults
  const args = process.argv.slice(2);

  const email = args[0] || 'sysadmin@example.com';
  const password = args[1] || 'SysAdmin123!';
  const firstName = args[2] || 'System';
  const lastName = args[3] || 'Administrator';
  const companyName = args[4] || 'System Administration';

  if (!args[0]) {
    console.log('ℹ️  No arguments provided. Using default values.');
    console.log('💡 Usage: npx tsx scripts/create-system-admin.ts <email> <password> <firstName> <lastName> [companyName]\n');
    console.log('📝 Example: npx tsx scripts/create-system-admin.ts admin@company.com SecurePass123! John Doe "My Company"\n');
  }

  await createSystemAdmin(email, password, firstName, lastName, companyName);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('✨ Done!');
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
