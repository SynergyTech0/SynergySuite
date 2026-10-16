import { prisma } from '../lib/db';

async function dropConstraint() {
  console.log('=== Dropping Foreign Key Constraint ===\n');

  try {
    // Drop the foreign key constraint
    await prisma.$executeRaw`
      ALTER TABLE document_fields
      DROP CONSTRAINT IF EXISTS document_fields_assignedToId_fkey;
    `;

    console.log('✓ Successfully dropped constraint: document_fields_assignedToId_fkey');

    // Verify it's gone
    const constraints: any = await prisma.$queryRaw`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'document_fields'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'document_fields_assignedToId_fkey';
    `;

    if (constraints.length === 0) {
      console.log('✓ Verified: Constraint no longer exists');
    } else {
      console.log('⚠️  Warning: Constraint still exists');
    }

  } catch (err) {
    console.error('Error dropping constraint:', err);
  }

  await prisma.$disconnect();
}

dropConstraint().catch(console.error);
