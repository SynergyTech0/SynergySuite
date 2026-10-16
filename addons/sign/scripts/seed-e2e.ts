/** Seed one verified sender for the end-to-end run. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@example.com";
  const password = "SynergySign-e2e-2026";
  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hash, emailVerified: new Date() },
    create: {
      email,
      name: "Shane Sipe",
      password: hash,
      emailVerified: new Date(),   // login is gated on this; unverified users bounce to /auth/verify
      role: "SENDER",
    },
  });

  console.log(`user: ${user.email} (${user.id})`);
  console.log(`password: ${password}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
