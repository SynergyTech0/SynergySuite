import { prisma } from '../lib/db';

async function checkConstraints() {
  console.log('=== Checking Database Constraints ===\n');

  // Raw query to check foreign key constraints on document_fields table
  const constraints: any = await prisma.$queryRaw`
    SELECT
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'document_fields';
  `;

  console.log('Foreign key constraints on document_fields table:');
  if (constraints.length === 0) {
    console.log('  No foreign key constraints found');
  } else {
    constraints.forEach((c: any) => {
      console.log(`  - ${c.constraint_name}:`);
      console.log(`    Column: ${c.column_name}`);
      console.log(`    References: ${c.foreign_table_name}.${c.foreign_column_name}`);
    });
  }

  // Check if there are any temp IDs in the database
  console.log('\n=== Checking for temp IDs in document_fields ===\n');

  const fieldsWithTempIds: any = await prisma.$queryRaw`
    SELECT id, "documentId", "assignedToId", "fieldType", label
    FROM document_fields
    WHERE "assignedToId" LIKE 'temp-%'
    LIMIT 10;
  `;

  if (fieldsWithTempIds.length === 0) {
    console.log('No fields with temp IDs found ✓');
  } else {
    console.log(`Found ${fieldsWithTempIds.length} fields with temp IDs:`);
    fieldsWithTempIds.forEach((f: any) => {
      console.log(`  - Field ${f.id}: ${f.fieldType} (${f.label})`);
      console.log(`    Document: ${f.documentId}`);
      console.log(`    Assigned to: ${f.assignedToId}`);
    });
  }

  await prisma.$disconnect();
}

checkConstraints().catch(console.error);
