# Signature Flow Implementation Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Models](#database-models)
4. [Complete Flow Diagram](#complete-flow-diagram)
5. [API Endpoints](#api-endpoints)
6. [Frontend Components](#frontend-components)
7. [Key Features](#key-features)
8. [Code Examples](#code-examples)
9. [Extending the System](#extending-the-system)

---

## Overview

The signature flow implementation provides a complete end-to-end electronic signature solution with support for multiple signers, sequential/parallel signing workflows, field management, and document integrity verification.

### Key Capabilities
- **Multi-signer Support**: Handle documents with multiple signers
- **Flexible Signing Order**: Support both parallel and sequential signing workflows
- **Rich Field Types**: Signature, initials, text, date, checkbox, and dropdown fields
- **Document Integrity**: SHA-256 hashing and certificate generation
- **Email Notifications**: Automated email flow for invitations and completion
- **Drag & Drop Fields**: Visual field placement on PDF documents
- **OCR Detection**: Automatic field detection using OpenCV

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Document Upload & Setup                     │
│  1. Upload PDF → 2. Add Fields → 3. Assign Signers → 4. Send    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Signature Collection                        │
│  1. Signer receives email → 2. Opens signing link               │
│  3. Fills assigned fields → 4. Submits signature                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Document Finalization                        │
│  1. All signatures collected → 2. Generate signed PDF           │
│  3. Calculate hash → 4. Send completion emails                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Models

### Core Tables

#### Document
Represents a document that needs to be signed.

```typescript
model Document {
  id                 String           @id @default(cuid())
  title              String
  description        String?
  cloudStoragePath   String           // Path to original PDF
  cloudProvider      CloudProvider    @default(LOCAL)
  originalFileName   String
  fileType           String
  fileSize           Int
  archived           Boolean          @default(false)
  status             DocumentStatus   @default(DRAFT)  // DRAFT, SENT, COMPLETED, DECLINED, EXPIRED
  signingOrder       SigningOrder     @default(PARALLEL)  // PARALLEL or SEQUENTIAL
  deadline           DateTime?
  completedAt        DateTime?
  senderId           String
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  // Signed document data
  signedDocumentPath String?          // Path to PDF with signatures burned in
  documentHash       String?          // SHA-256 hash for integrity verification
  signedAt           DateTime?

  // Relationships
  fields             DocumentField[]
  signers            DocumentSigner[]
  sender             User             @relation("DocumentSender", fields: [senderId], references: [id])
  auditLogs          AuditLog[]
  notifications      Notification[]
}
```

#### DocumentSigner
Represents a person who needs to sign the document.

```typescript
model DocumentSigner {
  id            String       @id @default(cuid())
  documentId    String
  userId        String?                    // Link to User if they have an account
  email         String
  name          String
  token         String?      @unique       // Unique token for signing link
  order         Int          @default(0)   // Signing order (1, 2, 3...)
  status        SignerStatus @default(PENDING)  // PENDING, COMPLETED, DECLINED
  signedAt      DateTime?
  declinedAt    DateTime?
  reminderCount Int          @default(0)
  lastReminder  DateTime?
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  document      Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user          User?        @relation(fields: [userId], references: [id])
  auditLogs     AuditLog[]

  @@unique([documentId, email])
}
```

#### DocumentField
Represents a fillable field on the document.

```typescript
model DocumentField {
  id           String    @id @default(cuid())
  documentId   String
  fieldType    FieldType  // SIGNATURE, INITIALS, TEXT, DATE, CHECKBOX, DROPDOWN
  label        String
  required     Boolean   @default(true)
  pageNumber   Int?
  x            Float      // X coordinate (no snapping - exact decimal precision)
  y            Float      // Y coordinate
  width        Float      // Width in pixels
  height       Float      // Height in pixels
  value        String?    // Filled value (text or base64 image data)
  options      Json?      // For dropdown fields
  assignedToId String?    // ID of DocumentSigner this field is assigned to
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  document     Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```

### Field Types

```typescript
enum FieldType {
  SIGNATURE   // Drawn signature (stored as base64 image)
  INITIALS    // Drawn initials (stored as base64 image)
  TEXT        // Text input
  DATE        // Date picker
  CHECKBOX    // Checkbox (value: "checked" or empty)
  DROPDOWN    // Dropdown selection (options in JSON)
}
```

### Status Enums

```typescript
enum DocumentStatus {
  DRAFT      // Document created but not sent
  SENT       // Sent to signers, awaiting signatures
  COMPLETED  // All signers completed
  DECLINED   // One or more signers declined
  EXPIRED    // Past deadline
}

enum SignerStatus {
  PENDING    // Waiting for signature
  COMPLETED  // Signed
  DECLINED   // Declined to sign
}

enum SigningOrder {
  PARALLEL    // All signers can sign simultaneously
  SEQUENTIAL  // Signers must sign in order
}
```

---

## Complete Flow Diagram

### 1. Document Creation & Field Setup

```
User uploads PDF
      │
      ▼
POST /api/documents/upload
  ├─ Save PDF to storage
  ├─ Create Document record (status: DRAFT)
  └─ Return document ID
      │
      ▼
User adds fields (drag & drop or OCR)
      │
      ▼
POST /api/documents/[id]/fields/create
  ├─ For each field:
  │   ├─ fieldType (SIGNATURE, TEXT, etc.)
  │   ├─ position (x, y, width, height)
  │   ├─ pageNumber
  │   └─ assignedToId (optional - can assign later)
  └─ Save to DocumentField table
      │
      ▼
User assigns fields to signers
      │
      ▼
PATCH /api/documents/[id]/fields/[fieldId]
  └─ Update assignedToId
```

### 2. Sending Document to Signers

```
User clicks "Send"
      │
      ▼
POST /api/signers/invite
  ├─ Input: {
  │    documentId: string,
  │    signers: Array<{ name: string, email: string }>,
  │    signingOrder: "PARALLEL" | "SEQUENTIAL"
  │  }
  │
  ├─ For each signer:
  │   ├─ Generate unique token (crypto.randomBytes)
  │   ├─ Create DocumentSigner record
  │   ├─ Set order (1, 2, 3...)
  │   └─ Store token for signing link
  │
  ├─ Update Document status to SENT
  │
  └─ Send emails:
      ├─ If PARALLEL: Send to ALL signers immediately
      └─ If SEQUENTIAL: Send ONLY to first signer (order: 1)
```

### 3. Signer Receives & Opens Document

```
Signer clicks link: /sign/[token]
      │
      ▼
GET /api/signers/verify?token=[token]
  ├─ Find DocumentSigner by token
  ├─ Return signer info + document details
  └─ Check if already signed (status: COMPLETED)
      │
      ▼
Page loads: /sign/[token]/page.tsx
  ├─ Display document title and signer name
  ├─ Load PDF via PdfFieldOverlay component
  ├─ Load all fields for this document
  ├─ Filter fields assigned to this signer
  └─ Show progress: X/Y fields completed
```

### 4. Signer Fills Fields

```
Signer clicks on field
      │
      ▼
PdfFieldOverlay opens modal based on field type:
  │
  ├─ SIGNATURE/INITIALS:
  │   ├─ Shows canvas for drawing
  │   ├─ User draws signature
  │   └─ Converts to base64 image data
  │
  ├─ TEXT:
  │   └─ Shows text input
  │
  ├─ DATE:
  │   └─ Shows date picker
  │
  └─ CHECKBOX:
      └─ Shows confirmation dialog
      │
      ▼
User clicks "Confirm"
      │
      ▼
PATCH /api/documents/[id]/fields/[fieldId]
  ├─ Update field.value
  └─ Return updated field
      │
      ▼
Field displays filled value in UI
Progress updates: (X+1)/Y fields completed
```

### 5. Signer Submits Signature

```
User clicks "Submit Signature"
      │
      ▼
Validation: Check all required fields filled
      │
      ▼
POST /api/signers/complete
  ├─ Input: { token: string }
  │
  ├─ Find DocumentSigner by token
  │
  ├─ Verify all required fields completed
  │
  ├─ Update DocumentSigner:
  │   ├─ status = COMPLETED
  │   └─ signedAt = now()
  │
  ├─ Check signing order:
  │   │
  │   ├─ If SEQUENTIAL:
  │   │   ├─ Find next signer (order > current)
  │   │   └─ Send email to next signer
  │   │
  │   └─ If PARALLEL:
  │       └─ No action needed
  │
  ├─ Check if ALL signers completed:
  │   │
  │   └─ If YES → Document Finalization (see below)
  │
  └─ Create audit log entry
```

### 6. Document Finalization (All Signers Complete)

```
Last signer submits
      │
      ▼
POST /api/signers/complete (continued)
  │
  ├─ 1. Generate Signed PDF:
  │   ├─ Load original PDF
  │   ├─ Collect all filled field values
  │   ├─ For each field:
  │   │   ├─ If SIGNATURE/INITIALS: Burn base64 image into PDF
  │   │   └─ If TEXT/DATE: Burn text into PDF
  │   └─ Save as new PDF file
  │
  ├─ 2. Generate Document Hash:
  │   ├─ Calculate SHA-256 hash of signed PDF
  │   └─ Ensures document integrity/immutability
  │
  ├─ 3. Update Document:
  │   ├─ status = COMPLETED
  │   ├─ completedAt = now()
  │   ├─ signedDocumentPath = path to signed PDF
  │   └─ documentHash = SHA-256 hash
  │
  ├─ 4. Generate Certificate:
  │   ├─ Document title
  │   ├─ Document hash
  │   ├─ List of all signers with sign dates
  │   └─ Completion timestamp
  │
  └─ 5. Send Completion Emails:
      ├─ To: ALL signers
      ├─ Subject: "Document Signed: [title]"
      ├─ Attachments:
      │   ├─ Signed PDF
      │   └─ Certificate of Completion
      └─ Body includes:
          ├─ List of all signers
          └─ Document hash for verification
```

---

## API Endpoints

### Document Management

#### Upload Document
```http
POST /api/documents/upload
Content-Type: multipart/form-data

Body:
  file: PDF file
  title: string
  description?: string

Response:
  {
    documentId: string,
    cloudStoragePath: string
  }
```

#### Get Document Details
```http
GET /api/documents/[id]

Response:
  {
    id: string,
    title: string,
    status: DocumentStatus,
    signingOrder: SigningOrder,
    cloudStoragePath: string,
    sender: { id, name, email },
    signers: Array<DocumentSigner>,
    fields?: Array<DocumentField>
  }
```

#### Download Document
```http
GET /api/documents/[id]/download

Response:
  Binary PDF file with headers:
  - Content-Type: application/pdf
  - Content-Disposition: attachment; filename="..."
```

### Field Management

#### Create Field
```http
POST /api/documents/[id]/fields/create

Body:
  {
    fieldType: FieldType,
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    pageNumber: number,
    required?: boolean,
    assignedToId?: string
  }

Response:
  {
    field: DocumentField
  }
```

#### Update Field
```http
PATCH /api/documents/[id]/fields/[fieldId]

Body:
  {
    x?: number,
    y?: number,
    width?: number,
    height?: number,
    value?: string,
    assignedToId?: string,
    label?: string,
    required?: boolean
  }

Response:
  {
    success: true,
    field: DocumentField
  }
```

#### Delete Field
```http
DELETE /api/documents/[id]/fields/[fieldId]

Response:
  { success: true }
```

#### Get All Fields
```http
GET /api/documents/[id]/fields

Response:
  {
    fields: Array<DocumentField>
  }
```

#### OCR Field Detection
```http
POST /api/documents/[id]/ocr

Response:
  {
    status: "processing" | "completed",
    fieldsDetected?: number
  }
```

### Signer Management

#### Invite Signers
```http
POST /api/signers/invite

Body:
  {
    documentId: string,
    signers: Array<{
      name: string,
      email: string
    }>,
    signingOrder: "PARALLEL" | "SEQUENTIAL"
  }

Response:
  {
    success: true,
    signersInvited: number,
    signers: Array<{ id, email, name }>
  }
```

#### Verify Signer Token
```http
GET /api/signers/verify?token=[token]

Response:
  {
    id: string,
    name: string,
    email: string,
    status: SignerStatus,
    document: {
      id: string,
      title: string,
      cloudStoragePath: string
    },
    allSigners: Array<SimpleSigner>
  }
```

#### Complete Signature
```http
POST /api/signers/complete

Body:
  {
    token: string
  }

Response:
  {
    success: true,
    message: string,
    signer: {
      id: string,
      status: SignerStatus,
      signedAt: DateTime
    },
    documentCompleted: boolean
  }
```

---

## Frontend Components

### PdfFieldOverlay Component

The main component for displaying and interacting with PDF documents and fields.

**Location**: `components/documents/PdfFieldOverlay.tsx`

#### Props
```typescript
interface PdfFieldOverlayProps {
  documentId: string;           // Document ID
  pdfUrl: string;              // URL to PDF file
  signers: Signer[];           // All signers for field assignment
  mode?: 'edit' | 'sign' | 'view';  // Interaction mode
  currentSignerId?: string;    // For sign mode: which signer is signing
  onFieldsUpdate?: () => void; // Callback when fields change
  fields?: DocumentField[];    // Pre-loaded fields (optional)
}
```

#### Modes

1. **Edit Mode** (`mode="edit"`)
   - Used by document sender
   - Can drag & drop new fields from palette
   - Can move and resize existing fields
   - Can assign fields to signers
   - Can delete fields
   - Shows field assignment badges

2. **Sign Mode** (`mode="sign"`)
   - Used by signer via /sign/[token] page
   - Can only interact with fields assigned to current signer
   - Click field to open signing modal
   - Shows progress indicator
   - Cannot modify field positions

3. **View Mode** (`mode="view"`)
   - Read-only display
   - Shows completed fields
   - No interaction allowed
   - Used after document is completed

#### Key Features

**Drag & Drop Field Creation**
```typescript
// Drag field from palette, drop on PDF
const handleDrop = async (e: React.DragEvent) => {
  const fieldData = JSON.parse(e.dataTransfer.getData('application/json'));
  const dropX = e.clientX - rect.left + container.scrollLeft;
  const dropY = e.clientY - rect.top + container.scrollTop;

  // Convert to PDF coordinates (unscale)
  const pdfX = dropX / scale;
  const pdfY = dropY / scale;

  // Create field via API
  await fetch(`/api/documents/${documentId}/fields/create`, {
    method: 'POST',
    body: JSON.stringify({
      fieldType: fieldData.fieldType,
      x: pdfX,
      y: pdfY,
      width: fieldData.defaultWidth,
      height: fieldData.defaultHeight,
      pageNumber: currentPage
    })
  });
};
```

**Field Repositioning**
```typescript
// No snapping - pixel-perfect positioning
const handleFieldDrag = (e: MouseEvent) => {
  const deltaX = (e.clientX - dragStartPos.x) / scale;
  const deltaY = (e.clientY - dragStartPos.y) / scale;

  setFields(prev => prev.map(f =>
    f.id === draggedFieldId
      ? { ...f, x: f.x + deltaX, y: f.y + deltaY }
      : f
  ));
};

// Save on drag end
const handleFieldDragEnd = async () => {
  const field = fields.find(f => f.id === draggedFieldId);

  await fetch(`/api/documents/${documentId}/fields/${draggedFieldId}`, {
    method: 'PATCH',
    body: JSON.stringify({ x: field.x, y: field.y })
  });
};
```

**Signature Canvas**
```typescript
// For SIGNATURE and INITIALS fields
const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
  const canvas = signatureCanvasRef.current;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.moveTo(coords.x, coords.y);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#000';
  setIsDrawing(true);
};

const saveSignature = () => {
  const canvas = signatureCanvasRef.current;
  const imageData = canvas.toDataURL('image/png'); // Base64

  await fetch(`/api/documents/${documentId}/fields/${fieldId}`, {
    method: 'PATCH',
    body: JSON.stringify({ value: imageData })
  });
};
```

### Sign Page Component

**Location**: `app/sign/[token]/page.tsx`

```typescript
export default function SignPage() {
  const { token } = useParams();
  const [signer, setSigner] = useState<Signer | null>(null);
  const [fields, setFields] = useState<Field[]>([]);

  // 1. Verify token and load signer info
  useEffect(() => {
    const res = await fetch(`/api/signers/verify?token=${token}`);
    const data = await res.json();
    setSigner(data);
  }, [token]);

  // 2. Load document fields
  const loadFields = async () => {
    const res = await fetch(`/api/documents/${signer.document.id}/fields`);
    const data = await res.json();
    setFields(data.fields);
  };

  // 3. Calculate progress
  const myFields = fields.filter(f => f.assignedToId === signer.id);
  const completedFields = myFields.filter(f => f.value);
  const allRequiredComplete = requiredFields.every(f => f.value);

  // 4. Submit signature
  const handleSubmit = async () => {
    await fetch('/api/signers/complete', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
    setCompleted(true);
  };

  return (
    <div>
      <header>
        <h1>Sign Document</h1>
        <p>{completedFields.length}/{myFields.length} fields completed</p>
        <Button onClick={handleSubmit} disabled={!allRequiredComplete}>
          Submit Signature
        </Button>
      </header>

      <PdfFieldOverlay
        documentId={signer.document.id}
        pdfUrl={pdfUrl}
        mode={completed ? "view" : "sign"}
        currentSignerId={signer.id}
        signers={allSigners}
        onFieldsUpdate={loadFields}
      />
    </div>
  );
}
```

---

## Key Features

### 1. Sequential vs Parallel Signing

**Parallel Signing** (Default)
- All signers receive invitation emails immediately
- Signers can sign in any order
- No waiting for previous signers
- Best for simple documents with independent signers

**Sequential Signing**
- Only first signer receives email initially
- When signer N completes, signer N+1 is notified
- Enforces specific signing order
- Useful for approval workflows (e.g., employee → manager → HR)

Implementation:
```typescript
// In /api/signers/invite
if (signingOrder === "PARALLEL") {
  // Send to all signers
  for (const signer of signers) {
    await sendEmail(signer.email, signLink);
  }
} else {
  // Send only to first signer (order === 1)
  const firstSigner = signers[0];
  await sendEmail(firstSigner.email, signLink);
}

// In /api/signers/complete
if (signingOrder === "SEQUENTIAL" && !allCompleted) {
  const nextSigner = sortedSigners.find(
    s => s.order > currentOrder && s.status === 'PENDING'
  );
  if (nextSigner) {
    await sendEmail(nextSigner.email, signLink);
  }
}
```

### 2. Field Position Precision

Fields are positioned with **full decimal precision** (no snapping):

```typescript
// Database schema
x: Float       // Exact decimal, e.g., 123.456789
y: Float
width: Float
height: Float

// Calculation during drag
const pdfX = (clientX - rect.left + scrollLeft) / scale;
// Result: 123.456789 (precise)

// Saved to database as-is (no rounding)
await prisma.documentField.update({
  data: { x: pdfX, y: pdfY }
});
```

### 3. Document Integrity & Verification

**SHA-256 Hashing**
```typescript
import crypto from 'crypto';
import fs from 'fs';

export async function generateDocumentHash(pdfPath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(pdfPath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}
```

**Certificate Generation**
```typescript
export function generateCertificate(data: {
  documentTitle: string;
  documentHash: string;
  signers: Array<{ name: string; email: string; signedAt: Date }>;
  completedAt: Date;
}): string {
  return `
    CERTIFICATE OF COMPLETION
    ========================

    Document: ${data.documentTitle}
    Completed: ${data.completedAt.toISOString()}

    SHA-256 Hash:
    ${data.documentHash}

    Signers:
    ${data.signers.map(s =>
      `- ${s.name} (${s.email}) - Signed ${s.signedAt.toLocaleDateString()}`
    ).join('\n')}

    This certificate verifies that the document has been signed by all parties
    and has not been modified since completion. To verify integrity, calculate
    the SHA-256 hash of the signed PDF and compare with the hash above.
  `;
}
```

### 4. OCR Field Detection

Automatic field detection using OpenCV:

```http
POST /api/documents/[id]/ocr
```

The system:
1. Converts PDF to images
2. Applies OpenCV contour detection
3. Identifies signature boxes and text fields
4. Creates DocumentField records automatically
5. Assigns preliminary positions

Users can then refine field positions via drag & drop.

### 5. Email Notifications

**Templates Available**:
1. Signature Request (initial invite)
2. Sequential: Next Signer Notification
3. Completion Email (with attachments)
4. Reminder Email (manual trigger)

**Configuration**:
```env
GOOGLE_USER_EMAIL=your-email@gmail.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

---

## Code Examples

### Example 1: Creating a Document Programmatically

```typescript
// 1. Upload document
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('title', 'Employment Agreement');
formData.append('description', 'New hire contract');

const uploadRes = await fetch('/api/documents/upload', {
  method: 'POST',
  body: formData
});
const { documentId } = await uploadRes.json();

// 2. Add signature field
await fetch(`/api/documents/${documentId}/fields/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fieldType: 'SIGNATURE',
    label: 'Employee Signature',
    x: 100,
    y: 500,
    width: 200,
    height: 50,
    pageNumber: 1,
    required: true
  })
});

// 3. Invite signer
await fetch('/api/signers/invite', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentId,
    signers: [
      { name: 'John Doe', email: 'john@example.com' }
    ],
    signingOrder: 'PARALLEL'
  })
});
```

### Example 2: Checking Document Status

```typescript
async function checkDocumentStatus(documentId: string) {
  const res = await fetch(`/api/documents/${documentId}`);
  const doc = await res.json();

  console.log('Document Status:', doc.status);
  console.log('Signers:');

  for (const signer of doc.signers) {
    console.log(`- ${signer.name} (${signer.email}): ${signer.status}`);
    if (signer.signedAt) {
      console.log(`  Signed at: ${new Date(signer.signedAt).toLocaleString()}`);
    }
  }

  if (doc.status === 'COMPLETED') {
    console.log('Document Hash:', doc.documentHash);
    console.log('Completed At:', new Date(doc.completedAt).toLocaleString());
  }
}
```

### Example 3: Custom Field Validation

```typescript
// Before submitting signature, validate field values
function validateFields(fields: DocumentField[]): string[] {
  const errors: string[] = [];

  for (const field of fields) {
    if (field.required && !field.value) {
      errors.push(`${field.label} is required`);
      continue;
    }

    // Custom validation by type
    if (field.fieldType === 'DATE' && field.value) {
      const date = new Date(field.value);
      if (isNaN(date.getTime())) {
        errors.push(`${field.label} must be a valid date`);
      }
    }

    if (field.fieldType === 'TEXT' && field.value) {
      if (field.value.length < 2) {
        errors.push(`${field.label} must be at least 2 characters`);
      }
    }
  }

  return errors;
}
```

### Example 4: Adding Multiple Signers with Sequential Flow

```typescript
await fetch('/api/signers/invite', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    documentId: 'doc-123',
    signers: [
      { name: 'Employee', email: 'employee@company.com' },      // Order 1
      { name: 'Manager', email: 'manager@company.com' },        // Order 2
      { name: 'HR Director', email: 'hr@company.com' }          // Order 3
    ],
    signingOrder: 'SEQUENTIAL'
  })
});

// Result:
// - Employee receives email immediately
// - Manager receives email only after Employee signs
// - HR Director receives email only after Manager signs
```

---

## Extending the System

### Adding a New Field Type

1. **Update Database Enum**
```prisma
// prisma/schema.prisma
enum FieldType {
  SIGNATURE
  INITIALS
  TEXT
  DATE
  CHECKBOX
  DROPDOWN
  EMAIL     // NEW
}
```

2. **Add to PdfFieldOverlay**
```typescript
// components/documents/PdfFieldOverlay.tsx

// Add color scheme
const FIELD_COLORS = {
  // ...existing colors
  EMAIL: { bg: 'bg-teal-100/80', border: 'border-teal-500', text: 'text-teal-700' },
};

// Add icon
const FIELD_ICONS = {
  // ...existing icons
  EMAIL: <Mail className="h-3 w-3" />,
};

// Add to signing modal
{signingField?.fieldType === 'EMAIL' && (
  <Input
    type="email"
    value={inputValue}
    onChange={(e) => setInputValue(e.target.value)}
    placeholder="Enter email..."
  />
)}
```

3. **Add Validation**
```typescript
// In saveFieldValue function
if (signingField.fieldType === 'EMAIL') {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    alert('Please enter a valid email address');
    return;
  }
}
```

4. **Run Migration**
```bash
npx prisma migrate dev --name add_email_field_type
```

### Adding Custom Signing Workflows

Example: Require manager approval before sending to final signer

```typescript
// Create custom endpoint: /api/documents/[id]/approve

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { approverId } = await req.json();

  // Mark document as approved
  await prisma.document.update({
    where: { id: params.id },
    data: {
      status: 'APPROVED', // Custom status
      approvedBy: approverId,
      approvedAt: new Date()
    }
  });

  // Now send to actual signers
  const signers = await prisma.documentSigner.findMany({
    where: { documentId: params.id, role: 'SIGNER' }
  });

  for (const signer of signers) {
    await sendEmail(signer.email, signLink);
  }

  return NextResponse.json({ success: true });
}
```

### Adding Webhook Notifications

```typescript
// lib/webhooks.ts
export async function notifyWebhook(event: string, data: any) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data
    })
  });
}

// Use in /api/signers/complete
await notifyWebhook('document.signed', {
  documentId: document.id,
  signerId: signer.id,
  signerEmail: signer.email
});

await notifyWebhook('document.completed', {
  documentId: document.id,
  completedAt: new Date(),
  signerCount: allSigners.length
});
```

### Customizing Email Templates

```typescript
// lib/email-templates.ts
export const templates = {
  signatureRequest: (data: { signerName: string; documentTitle: string; signLink: string }) => `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          .button {
            background: #2563eb;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <h2>Signature Request</h2>
        <p>Hello ${data.signerName},</p>
        <p>You have been requested to sign: <strong>${data.documentTitle}</strong></p>
        <a href="${data.signLink}" class="button">Review & Sign Document</a>
        <p style="color: #666; font-size: 12px;">
          If the button doesn't work, copy this link: ${data.signLink}
        </p>
      </body>
    </html>
  `,

  documentCompleted: (data: { documentTitle: string; signers: any[]; documentHash: string }) => `
    // Custom completion template
  `
};

// Use in /api/signers/invite
await sendEmail(
  signer.email,
  `Signature Request – ${document.title}`,
  templates.signatureRequest({
    signerName: signer.name,
    documentTitle: document.title,
    signLink
  })
);
```

---

## Best Practices

### 1. Field Assignment
- Always assign fields before sending document
- Use descriptive labels for fields
- Mark required fields clearly
- Test signing flow before sending to real signers

### 2. Error Handling
- Always validate field completion before allowing submission
- Provide clear error messages to signers
- Log errors for debugging (check console in /api/signers/complete)
- Handle edge cases (expired tokens, already signed, etc.)

### 3. Security
- Tokens are unique and unguessable (crypto.randomBytes(20))
- Tokens are single-use (status changes to COMPLETED)
- Document hash prevents tampering after signing
- Store IP address and user agent for audit trail

### 4. Performance
- Load only necessary fields for current page
- Use pagination for documents with many signers
- Cache PDF rendering to avoid re-renders
- Optimize email sending with queues for large batches

### 5. Testing
```typescript
// Test complete flow
describe('Signature Flow', () => {
  it('should complete sequential signing workflow', async () => {
    // 1. Create document
    const doc = await createDocument();

    // 2. Add fields
    await addField(doc.id, { fieldType: 'SIGNATURE', assignedTo: 'signer-1' });

    // 3. Invite signers
    await inviteSigners(doc.id, [
      { email: 'signer1@test.com' },
      { email: 'signer2@test.com' }
    ], 'SEQUENTIAL');

    // 4. First signer signs
    const token1 = await getSignerToken('signer1@test.com');
    await fillField(token1, fieldId, 'signature-data');
    await completeSignature(token1);

    // 5. Verify second signer gets email
    expect(emailsSent).toContain('signer2@test.com');

    // 6. Second signer signs
    const token2 = await getSignerToken('signer2@test.com');
    await completeSignature(token2);

    // 7. Verify document completed
    const finalDoc = await getDocument(doc.id);
    expect(finalDoc.status).toBe('COMPLETED');
    expect(finalDoc.documentHash).toBeDefined();
  });
});
```

---

## Troubleshooting

### Issue: Fields not saving position
**Solution**: Check that x, y, width, height are being passed as numbers (not strings). The database stores as Float, so ensure no rounding occurs.

### Issue: Signer can't access document
**Solution**: Verify token is valid and hasn't expired. Check DocumentSigner.token matches URL parameter.

### Issue: Document not finalizing after all sign
**Solution**: Check all signers have status='COMPLETED'. Review console logs in /api/signers/complete for errors.

### Issue: Emails not sending
**Solution**: Verify environment variables are set correctly. Check Google OAuth credentials and refresh token.

### Issue: PDF not rendering
**Solution**: Ensure pdf.worker.min.js is in /public directory. Check cloudStoragePath is accessible via /api/files route.

---

## Support & Contributing

For questions or issues:
1. Check console logs in browser and server
2. Review audit logs in database
3. Test with Postman/curl to isolate frontend vs backend issues
4. Check this documentation for code examples

When reporting bugs, include:
- Document ID
- Signer email/ID
- Steps to reproduce
- Console errors (frontend + backend)
- Expected vs actual behavior

---

**Last Updated**: 2025-11-22
**Version**: 1.0
