import { prisma } from '../lib/db';

async function fixTempAssignments() {
  console.log('=== Fixing Temp ID Assignments ===\n');

  // Find all fields with temp IDs
  const fieldsWithTempIds: any = await prisma.$queryRaw`
    SELECT df.id, df."documentId", df."assignedToId", df."fieldType", df.label
    FROM document_fields df
    WHERE df."assignedToId" LIKE 'temp-%';
  `;

  if (fieldsWithTempIds.length === 0) {
    console.log('✓ No fields with temp IDs found - all good!');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${fieldsWithTempIds.length} fields with temp IDs\n`);

  // Group by document
  const byDocument = new Map<string, any[]>();
  for (const field of fieldsWithTempIds) {
    if (!byDocument.has(field.documentId)) {
      byDocument.set(field.documentId, []);
    }
    byDocument.get(field.documentId)!.push(field);
  }

  console.log(`Affected documents: ${byDocument.size}\n`);

  let fixedCount = 0;
  let failedCount = 0;

  // Process each document
  for (const [docId, fields] of byDocument) {
    console.log(`\nProcessing document ${docId}...`);

    // Get signers for this document
    const signers = await prisma.documentSigner.findMany({
      where: { documentId: docId },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`  Found ${signers.length} signer(s)`);

    if (signers.length === 0) {
      console.log(`  ⚠️  No signers found - cannot remap. Setting fields to null.`);

      for (const field of fields) {
        try {
          await prisma.documentField.update({
            where: { id: field.id },
            data: { assignedToId: null }
          });
          fixedCount++;
          console.log(`  ✓ Unassigned field ${field.id}`);
        } catch (err) {
          console.error(`  ✗ Failed to unassign field ${field.id}:`, err);
          failedCount++;
        }
      }
      continue;
    }

    // Try to remap temp IDs to real signer IDs
    for (const field of fields) {
      const tempIdMatch = field.assignedToId.match(/^temp-(\d+)$/);
      if (!tempIdMatch) {
        console.log(`  ⚠️  Invalid temp ID format: ${field.assignedToId}`);
        failedCount++;
        continue;
      }

      const tempIndex = parseInt(tempIdMatch[1]);
      const matchedSigner = signers[tempIndex];

      if (matchedSigner) {
        try {
          await prisma.documentField.update({
            where: { id: field.id },
            data: { assignedToId: matchedSigner.id }
          });
          fixedCount++;
          console.log(`  ✓ Remapped field ${field.id}: temp-${tempIndex} → ${matchedSigner.email}`);
        } catch (err) {
          console.error(`  ✗ Failed to remap field ${field.id}:`, err);
          failedCount++;
        }
      } else {
        console.log(`  ⚠️  No signer at index ${tempIndex} (have ${signers.length} signer(s))`);
        // Set to null if no matching signer
        try {
          await prisma.documentField.update({
            where: { id: field.id },
            data: { assignedToId: null }
          });
          fixedCount++;
          console.log(`  ✓ Unassigned field ${field.id} (no matching signer)`);
        } catch (err) {
          console.error(`  ✗ Failed to unassign field ${field.id}:`, err);
          failedCount++;
        }
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Fixed: ${fixedCount}`);
  console.log(`Failed: ${failedCount}`);

  await prisma.$disconnect();
}

fixTempAssignments().catch(console.error);
