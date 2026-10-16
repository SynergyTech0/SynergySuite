import { prisma } from '../lib/db';

async function checkTempFields() {
  console.log('Checking for fields with temp IDs...\n');

  const fieldsWithTempIds = await prisma.documentField.findMany({
    where: {
      assignedToId: {
        startsWith: 'temp-',
      },
    },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          signers: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      },
    },
  });

  console.log(`Found ${fieldsWithTempIds.length} fields with temp IDs\n`);

  if (fieldsWithTempIds.length > 0) {
    console.log('Details:');
    for (const field of fieldsWithTempIds) {
      console.log(`\nField ID: ${field.id}`);
      console.log(`  Document: ${field.document.title} (${field.documentId})`);
      console.log(`  Field Type: ${field.fieldType}`);
      console.log(`  Assigned To: ${field.assignedToId}`);
      console.log(`  Document Signers (${field.document.signers.length}):`);
      field.document.signers.forEach((s, idx) => {
        console.log(`    [${idx}] ${s.email} (ID: ${s.id})`);
      });
    }
  } else {
    console.log('No fields with temp IDs found. ✓');
  }

  await prisma.$disconnect();
}

checkTempFields().catch(console.error);
