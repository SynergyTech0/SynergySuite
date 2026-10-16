import { prisma } from '../lib/db';

async function testWorkflow() {
  console.log('=== Testing Document Workflow ===\n');

  // Find a recent DRAFT document with fields
  const document = await prisma.document.findFirst({
    where: {
      status: 'DRAFT',
    },
    include: {
      fields: true,
      signers: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!document) {
    console.log('❌ No DRAFT documents found');
    await prisma.$disconnect();
    return;
  }

  console.log(`✓ Found document: ${document.title} (${document.id})`);
  console.log(`  Fields: ${document.fields.length}`);
  console.log(`  Signers: ${document.signers.length}`);

  // Check field assignments
  const unassigned = document.fields.filter(f => !f.assignedToId);
  const tempAssigned = document.fields.filter(f => f.assignedToId?.startsWith('temp-'));
  const properlyAssigned = document.fields.filter(f => f.assignedToId && !f.assignedToId.startsWith('temp-'));

  console.log(`\n  Field assignments:`);
  console.log(`    ✓ Properly assigned: ${properlyAssigned.length}`);
  console.log(`    ⚠️  Temp IDs: ${tempAssigned.length}`);
  console.log(`    ❌ Unassigned: ${unassigned.length}`);

  // Test creating a temp assignment
  if (document.fields.length > 0 && unassigned.length > 0) {
    console.log(`\n--- Testing temp ID assignment ---`);
    const testField = unassigned[0];
    console.log(`Testing with field: ${testField.id} (${testField.fieldType})`);

    try {
      await prisma.documentField.update({
        where: { id: testField.id },
        data: { assignedToId: 'temp-0' }
      });
      console.log(`✓ Successfully assigned temp-0 to field ${testField.id}`);

      // Clean up - set back to null
      await prisma.documentField.update({
        where: { id: testField.id },
        data: { assignedToId: null }
      });
      console.log(`✓ Cleaned up test assignment`);
    } catch (err: any) {
      console.error(`❌ Failed to assign temp ID:`, err.message);
    }
  }

  // Check if we can complete a signer
  if (document.signers.length > 0) {
    console.log(`\n--- Checking signer data ---`);
    const signer = document.signers[0];
    console.log(`Signer: ${signer.email} (${signer.id})`);
    console.log(`  Status: ${signer.status}`);
    console.log(`  Token: ${signer.token ? 'Present' : 'Missing'}`);

    const signerFields = document.fields.filter(f => f.assignedToId === signer.id);
    const completedFields = signerFields.filter(f => f.value);
    console.log(`  Assigned fields: ${signerFields.length}`);
    console.log(`  Completed fields: ${completedFields.length}`);
  }

  await prisma.$disconnect();
}

testWorkflow().catch(console.error);
