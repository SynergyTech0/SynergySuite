import { prisma } from '../lib/db';

async function diagnoseFields() {
  console.log('=== Field Assignment Diagnosis ===\n');

  // Get all documents with fields
  const documents = await prisma.document.findMany({
    include: {
      fields: true,
      signers: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 5, // Last 5 documents
  });

  for (const doc of documents) {
    console.log(`\n📄 Document: ${doc.title} (${doc.id})`);
    console.log(`   Status: ${doc.status}`);
    console.log(`   Signers: ${doc.signers.length}`);
    doc.signers.forEach((s, idx) => {
      console.log(`     [${idx}] ${s.email} (ID: ${s.id})`);
    });

    console.log(`   Fields: ${doc.fields.length}`);

    const unassigned = doc.fields.filter(f => !f.assignedToId);
    const tempAssigned = doc.fields.filter(f => f.assignedToId?.startsWith('temp-'));
    const properlyAssigned = doc.fields.filter(f => f.assignedToId && !f.assignedToId.startsWith('temp-'));

    console.log(`     ✅ Properly assigned: ${properlyAssigned.length}`);
    console.log(`     ⚠️  Temp IDs: ${tempAssigned.length}`);
    console.log(`     ❌ Unassigned: ${unassigned.length}`);

    if (unassigned.length > 0) {
      console.log(`\n     Unassigned fields:`);
      unassigned.forEach(f => {
        console.log(`       - ${f.fieldType} (${f.label}) - ID: ${f.id} - assignedToId: ${f.assignedToId}`);
      });
    }

    if (tempAssigned.length > 0) {
      console.log(`\n     Fields with temp IDs:`);
      tempAssigned.forEach(f => {
        console.log(`       - ${f.fieldType} (${f.label}) - ID: ${f.id} - assignedToId: ${f.assignedToId}`);
      });
    }
  }

  await prisma.$disconnect();
}

diagnoseFields().catch(console.error);
