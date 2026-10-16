# SynergySign - Technical Guidelines & Developer Reference

**Project:** SynergySign (AI-Powered E-Signature Platform)  
**Repository:** git@github.com:SynergyTechnologiesInc/ai_docusign_clone.git  
**Last Updated:** November 23, 2025

---

## TABLE OF CONTENTS

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Development Setup](#development-setup)
4. [Git Workflow](#git-workflow)
5. [Coding Standards](#coding-standards)
6. [Database Guidelines](#database-guidelines)
7. [API Development](#api-development)
8. [Component Development](#component-development)
9. [Testing Guidelines](#testing-guidelines)
10. [Common Commands](#common-commands)
11. [Troubleshooting](#troubleshooting)
---

## PROJECT OVERVIEW

**SynergySign** is a DocuSign clone with AI-powered document processing, multi-party signing workflows, enterprise support, and an affiliate marketing system.

### Key Features
- Multi-party document signing (sequential/parallel)
- AI/OCR field detection (Tesseract)
- Template management
- Enterprise accounts with user management
- Affiliate marketing ($2/month per referral)
- Role-based access control (5 roles)
- Stripe subscriptions (FREE, BASIC, PRO, ENTERPRISE)
- AWS S3 + local hybrid storage
- Email notifications (Nodemailer)
- Complete audit trails

---

## TECH STACK

### Frontend
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5.2
- **UI Library:** React 18.3
- **Styling:** Tailwind CSS 3.3
- **Components:** shadcn/ui (51 components) + Radix UI
- **State Management:** Context API, React Query
- **Forms:** React Hook Form, Formik
- **Validation:** Zod, Yup
- **PDF Rendering:** PDF.js, pdfjs-dist, react-pdf

### Backend
- **Runtime:** Node.js (Next.js API Routes)
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma 6.7
- **Authentication:** NextAuth.js 4.24
- **File Storage:** AWS S3 + Local filesystem
- **Email:** Nodemailer
- **PDF Processing:** pdf-lib, pdf-parse
- **OCR:** Tesseract, node-tesseract-ocr

### DevOps & Deployment
- **Deployment:** PM2 + GitHub Actions
- **Build:** Standalone Next.js
- **Server:** Ubuntu/Linux (SSH deployment)
- **Process Manager:** PM2 (ecosystem.config.js)

### Third-party Integrations
- **Payments:** Stripe (subscriptions, webhooks)
- **Cloud Storage:** AWS S3
- **Email SMTP:** Configured via SMTP_* env vars
- **AI/OCR:** Tesseract, OpenCV (experimental)

---

## DEVELOPMENT SETUP

### Prerequisites
```bash
Node.js >= 18.x
PostgreSQL >= 14.x
Yarn or npm
Git
AWS CLI (optional, for S3)
Tesseract OCR (for field detection)
```

### Initial Setup
```bash
# Clone repository
git clone git@github.com:SynergyTechnologiesInc/ai_docusign_clone.git
cd ai_docusign_clone

# Install dependencies
npm install --legacy-peer-deps
# or
yarn install

# Copy environment variables
cp .env.example .env
# Edit .env with your credentials

# Setup database
npx prisma generate
npx prisma db push
# or
npx prisma migrate dev

# Start development server
npm run dev
# or
yarn dev

# Access at: http://localhost:3000
```

### Environment Variables Required
```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/synergysign?schema=public"

# Authentication
NEXTAUTH_SECRET="your-secret-key-min-32-chars"
NEXTAUTH_URL="http://localhost:3000"

LOCAL_STORAGE_PATH=./uploads
STORAGE_MODE=local

DOCUMENT_JWT_SECRET="document-secret-key-007"



# AWS S3 (optional for local dev)
AWS_PROFILE=hosted_storage
AWS_REGION=us-west-2
AWS_BUCKET_NAME=your-bucket-name
AWS_FOLDER_PREFIX=your-folder-prefix/

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Price IDs (from Stripe Dashboard)
STRIPE_BASIC_MONTHLY_PRICE_ID="price_..."
STRIPE_PRO_MONTHLY_PRICE_ID="price_..."

# Email (Nodemailer)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
EMAIL_FROM="noreply@synergysign.com"

# Google OAuth2 (Empty = fallback to simple SMTP)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_REFRESH_TOKEN=""
GOOGLE_USER_EMAIL="noreply@synergysign.com"

```

### Default Admin Account
- **Email:** admin@synergysign.com
- **Password:** Admin@123
- **Change password immediately after first login!**

---

## GIT WORKFLOW

### Branch Structure
```
main (production)
  ↑
dev (staging/QA)
  ↑
feature/SSK-XXX-description (your work)
```

### Branch Rules
- **main:** Production only, protected, requires PR + approval
- **dev:** Staging/integration, requires PR + review
- **feature/SSK-XXX-desc:** Individual ticket work
- **hotfix/desc:** Emergency production fixes

### Starting New Work
```bash
# Always start from dev
git checkout dev
git pull origin dev

# Create feature branch (Jira ticket-based)
git checkout -b feature/SSK-XXX-brief-description

# Example:
git checkout -b feature/SSK-200-add-document-expiry
```

### Commit Message Convention
```bash
# Format: <type>(ticket): <description>

feat(SSK-200): add document expiry feature
fix(SSK-200): resolve date validation bug
docs(SSK-200): update API documentation
refactor(SSK-200): optimize PDF rendering
chore(SSK-200): upgrade dependencies
test(SSK-200): add unit tests for expiry
style(SSK-200): format code with prettier
```

### Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code restructure
- `chore` - Maintenance
- `test` - Tests
- `style` - Formatting
- `perf` - Performance

### Committing Changes
```bash
# Stage changes
git add .
# or specific files
git add path/to/file.ts

# Commit with conventional format
git commit -m "feat(SSK-200): add document expiry feature"

# Push to remote
git push origin feature/SSK-200-add-document-expiry
```

### Opening Pull Request
1. Push your feature branch to GitHub
2. Open PR on GitHub: `feature/SSK-XXX` → `dev`
3. Fill PR template with (Suggestion):
   - Jira ticket link
   - Summary of changes
   - Testing done
   - Screenshots (if UI)
4. Assign reviewers
5. Wait for approval

### After PR Merged
```bash
# Switch back to dev
git checkout dev

# Pull latest (includes your merged work)
git pull origin dev

# Delete local feature branch
git branch -d feature/SSK-XXX-description

# Delete remote feature branch (optional)
git push origin --delete feature/SSK-XXX-description
```

---

## CODING STANDARDS

### TypeScript Guidelines
```typescript
// DO: Use explicit types
interface User {
  id: string;
  email: string;
  role: UserRole;
}

function getUser(userId: string): Promise<User> {
  // ...
}

// ❌ DON'T: Use 'any'
function processData(data: any) { // Avoid
  // ...
}

// DO: Use proper error handling
try {
  await riskyOperation();
} catch (error) {
  console.error('Operation failed:', error);
  throw new Error('User-friendly message');
}

// DO: Use environment variables for config
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('API_KEY not configured');

// ❌ DON'T: Hardcode secrets
const apiKey = 'sk_live_abc123'; // Never do this
```

### Component Structure
```typescript
// Recommended structure for components
'use client'; // If using client-side features

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface MyComponentProps {
  userId: string;
  onComplete?: () => void;
}

export function MyComponent({ userId, onComplete }: MyComponentProps) {
  // State
  const [loading, setLoading] = useState(false);
  
  // Effects
  useEffect(() => {
    // ...
  }, [userId]);
  
  // Handlers
  const handleClick = async () => {
    // ...
  };
  
  // Render
  return (
    <div>
      <Button onClick={handleClick}>Action</Button>
    </div>
  );
}
```

### File Naming
- **Components:** PascalCase - `DocumentViewer.tsx`
- **Utilities:** camelCase - `formatDate.ts`
- **API Routes:** lowercase - `route.ts`
- **Types:** PascalCase - `UserTypes.ts` or in file as `types.ts`

### Import Order
```typescript
// 1. External libraries
import { useState } from 'react';
import { Button } from '@radix-ui/react-button';

// 2. Internal absolute imports
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth';

// 3. Components
import { UserCard } from '@/components/user-card';

// 4. Types
import type { User } from '@prisma/client';

// 5. Relative imports
import { helperFunction } from './utils';
```

### Code Formatting
```bash
# Project uses ESLint + Prettier (configured)

# Format code
npm run lint
# or
npx eslint . --fix

# Check types
npx tsc --noEmit
```

---

## DATABASE GUIDELINES

### Schema Location
- **File:** `prisma/schema.prisma`
- **Migrations:** `prisma/migrations/`

### Making Schema Changes
```bash
# 1. Edit prisma/schema.prisma

# 2. Generate migration
npx prisma migrate dev --name descriptive_migration_name

# Example:
npx prisma migrate dev --name add_document_expiry_field

# 3. This will:
#    - Create SQL migration file
#    - Run migration on local DB
#    - Regenerate Prisma Client

# 4. Commit both schema.prisma and migration files
git add prisma/schema.prisma
git add prisma/migrations/
git commit -m "feat(SSK-200): add document expiry field to schema"
```

### Production Migrations
```bash
# On deployment, GitHub Actions runs:
npx prisma migrate deploy

# This applies pending migrations without prompts
```

### Prisma Client Usage
```typescript
import { prisma } from '@/lib/db';

// Querying
const users = await prisma.user.findMany({
  where: { role: 'SENDER' },
  include: { subscription: true },
});

// Creating
const doc = await prisma.document.create({
  data: {
    title: 'Contract',
    senderId: userId,
    status: 'DRAFT',
  },
});

// Updating
await prisma.user.update({
  where: { id: userId },
  data: { emailVerified: new Date() },
});

// Transactions
await prisma.$transaction([
  prisma.document.update({ ... }),
  prisma.auditLog.create({ ... }),
]);
```

### Naming Conventions
- **Tables:** snake_case (via `@@map("table_name")`)
- **Fields:** camelCase in Prisma, snake_case in DB
- **Relations:** Clear names (`user`, `sender`, `creator`)
- **Enums:** UPPERCASE (`UserRole`, `DocumentStatus`)

---

## API DEVELOPMENT

### API Route Structure
```
app/api/
  └── [feature]/
      └── [resource]/
          └── [action]/
              └── route.ts
```

### Creating New API Endpoint
```typescript
// app/api/documents/[id]/expire/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Get params
    const { id } = await context.params;

    // 3. Parse body
    const body = await request.json();
    
    // 4. Validate input
    if (!body.expiryDate) {
      return NextResponse.json(
        { error: 'expiryDate is required' },
        { status: 400 }
      );
    }

    // 5. Authorization check
    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    if (document.senderId !== session.user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // 6. Business logic
    const updated = await prisma.document.update({
      where: { id },
      data: { deadline: new Date(body.expiryDate) },
    });

    // 7. Audit log
    await prisma.auditLog.create({
      data: {
        documentId: id,
        userId: session.user.id,
        action: 'DOCUMENT_UPDATED',
        details: { expiryDate: body.expiryDate },
      },
    });

    // 8. Success response
    return NextResponse.json({ success: true, document: updated });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### API Best Practices
-  Always authenticate with `getServerSession()`
-  Validate all inputs
-  Check authorization (user owns resource)
-  Use proper HTTP status codes
-  Log errors with `console.error()`
-  Create audit logs for sensitive operations
-  Return consistent JSON structure
- x Never expose internal errors to client
- x Never log sensitive data (passwords, tokens)

### HTTP Status Codes
- `200` - Success (GET, PATCH, DELETE)
- `201` - Created (POST)
- `400` - Bad Request (validation failed)
- `401` - Unauthorized (not authenticated)
- `403` - Forbidden (authenticated but not authorized)
- `404` - Not Found
- `500` - Internal Server Error

---

## COMPONENT DEVELOPMENT

### Using shadcn/ui Components
```bash
# Add new component
npx shadcn-ui@latest add [component-name]

# Example:
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add table
```

### Component Location
```
components/
  ├── ui/              # shadcn/ui components (don't edit)
  ├── dashboard/       # Dashboard-specific
  ├── documents/       # Document handling
  ├── auth/            # Auth forms
  └── [feature]/       # Feature-specific
```

### Creating New Component
```typescript
// components/documents/ExpiryPicker.tsx
'use client';

import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';

interface ExpiryPickerProps {
  initialDate?: Date;
  onSave: (date: Date) => void;
}

export function ExpiryPicker({ initialDate, onSave }: ExpiryPickerProps) {
  const [date, setDate] = useState<Date | undefined>(initialDate);

  return (
    <div className="space-y-4">
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
      />
      <Button onClick={() => date && onSave(date)}>
        Save Expiry Date
      </Button>
    </div>
  );
}
```

### Styling with Tailwind
```typescript
//  DO: Use Tailwind classes
<div className="flex items-center justify-between p-4 bg-white rounded-lg shadow">
  <h2 className="text-xl font-semibold text-gray-900">Title</h2>
</div>

//  DO: Use conditional classes with cn() utility
import { cn } from '@/lib/utils';

<div className={cn(
  "p-4 rounded-lg",
  isActive && "bg-blue-100 border-blue-500",
  isError && "bg-red-100 border-red-500"
)}>
  Content
</div>

// ❌ DON'T: Use inline styles (unless absolutely necessary)
<div style={{ padding: '16px' }}> {/* Avoid */}
```

---

## TESTING GUIDELINES

### Test Structure (Future)
```
__tests__/
  ├── unit/
  ├── integration/
  └── e2e/
```

### Manual Testing Checklist
Before committing:
- [ ] Feature works in browser
- [ ] No console errors
- [ ] Mobile responsive (test with browser DevTools)
- [ ] Works for all relevant user roles
- [ ] Database changes persist correctly
- [ ] Error states handled gracefully
- [ ] Loading states show properly

### Testing User Roles
```typescript
// Test as different roles:
// 1. SIGNER - Can only sign documents
// 2. SENDER - Can upload & send documents
// 3. ADMIN - Full system access
// 4. SYSTEM_ADMIN - Platform super admin
// 5. CORPORATE - Enterprise user

// Use different accounts or switch roles in admin panel
```

---

## COMMON COMMANDS

### Development
```bash
# Start dev server
npm run dev
yarn dev

# Build for production
npm run build
yarn build

# Start production server
npm start
yarn start

# Lint code
npm run lint
yarn lint

# Type check
npx tsc --noEmit
```

### Database
```bash
# Generate Prisma Client
npx prisma generate

# Create migration (dev)
npx prisma migrate dev --name migration_name

# Apply migrations (production)
npx prisma migrate deploy

# Reset database ( deletes all data)
npx prisma migrate reset

# Open Prisma Studio (DB GUI)
npx prisma studio

# Seed database
npx prisma db seed
```

### Git Operations
```bash
# Check status
git status

# Create feature branch
git checkout -b feature/SSK-XXX-description

# Stage changes
git add .
git add specific-file.ts

# Commit
git commit -m "feat(SSK-XXX): description"

# Push to remote
git push origin feature/SSK-XXX-description

# Pull latest
git pull origin dev

# Switch branches
git checkout dev
git checkout main

# View commit history
git log --oneline -10
git log --graph --all --decorate

# Discard local changes
git checkout -- file.ts
git reset --hard  # Careful, loses all changes

# Stash changes temporarily
git stash
git stash pop
git stash list
```

### Dependency Management
```bash
# Install package
npm install package-name
yarn add package-name

# Install dev dependency
npm install -D package-name
yarn add -D package-name

# Remove package
npm uninstall package-name
yarn remove package-name

# Update dependencies
npm update
yarn upgrade

# Check outdated packages
npm outdated
yarn outdated
```

### PM2 (Production)
```bash
# Start app
pm2 start npm --name synergysign -- start

# Restart
pm2 restart synergysign

# Stop
pm2 stop synergysign

# View logs
pm2 logs synergysign

# Monitor
pm2 monit

# List processes
pm2 list

# Delete process
pm2 delete synergysign
```

### Useful One-Liners
```bash
# Count TypeScript files
find . -name "*.ts" -o -name "*.tsx" | wc -l

# Find TODO comments
grep -r "TODO" --include="*.ts" --include="*.tsx"

# Check for console.log (before commit)
grep -r "console.log" app/ components/ lib/

# Database backup
pg_dump synergysign > backup.sql

# Database restore
psql synergysign < backup.sql

# Clear Next.js cache
rm -rf .next

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

## TROUBLESHOOTING

### Build Errors

**Error: "Module not found"**
```bash
# Solution 1: Clear cache and rebuild
rm -rf .next
npm run build

# Solution 2: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

**Error: "prisma client not generated"**
```bash
# Solution:
npx prisma generate
npm run build
```

### Database Issues

**Error: "Can't reach database server"**
```bash
# Check if PostgreSQL is running
psql -U postgres -c "SELECT 1"

# Check DATABASE_URL in .env
cat .env | grep DATABASE_URL

# Test connection
npx prisma db pull
```

**Error: "Migration failed"**
```bash
# Reset database (dev only, deletes data)
npx prisma migrate reset

# Or manually fix:
# 1. Connect to DB
psql synergysign

# 2. Check _prisma_migrations table
SELECT * FROM _prisma_migrations;

# 3. Delete failed migration
DELETE FROM _prisma_migrations WHERE migration_name = 'xxx';

# 4. Re-run
npx prisma migrate dev
```

### Authentication Issues

**Error: "Session not found"**
```bash
# Check NEXTAUTH_SECRET is set
echo $NEXTAUTH_SECRET

# Clear cookies in browser
# Chrome: DevTools → Application → Cookies → Delete

# Check session table in DB
psql synergysign
SELECT * FROM sessions;
```

### File Upload Issues

**Error: "File upload fails"**
```bash
# Check AWS credentials
aws s3 ls s3://your-bucket-name

# Check folder permissions
ls -la uploads/documents/

# Create folder if missing
mkdir -p uploads/documents
chmod 755 uploads/documents
```

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
PORT=3001 npm run dev
```


## QUICK REFERENCE

### Project Paths
```bash
# API Routes
app/api/documents/route.ts

# Components
components/documents/PdfFieldOverlay.tsx

# Database Schema
prisma/schema.prisma

# Library Functions
lib/auth.ts
lib/db.ts
lib/s3.ts
lib/stripe.ts
lib/ocr-utils.ts

# Environment
.env

# Config
next.config.js
tailwind.config.ts
tsconfig.json
```

### Important URLs
- **Local Dev:** http://localhost:3000
- **Admin Panel:** http://localhost:3000/admin
- **Prisma Studio:** http://localhost:5555 (after `npx prisma studio`)
- **GitHub Repo:** https://github.com/SynergyTechnologiesInc/ai_docusign_clone

### Key Models
- `User` - User accounts
- `Document` - Documents to be signed
- `DocumentField` - Form fields on documents
- `DocumentSigner` - Signers for documents
- `Subscription` - User subscriptions
- `EnterpriseAccount` - B2B accounts
- `AffiliateEarning` - Referral earnings
- `Notification` - Email/in-app notifications
- `AuditLog` - Compliance audit trail

### User Roles
- `SIGNER` - Can sign documents
- `SENDER` - Can upload & send documents
- `ADMIN` - Full system access
- `SYSTEM_ADMIN` - Platform super admin
- `CORPORATE` - Enterprise user

---

## SUPPORT

### Resources
- **Documentation:** This file + `/docs` folder
- **Jira:** Ticket tracking system
- **GitHub:** Code repository + PRs
- **Project Manager:** Bhargavi (QA coordination)

### Getting Help
1. Check this document first
2. Search codebase for examples
3. Consult team members
4. Check official docs (Next.js, Prisma, etc.)

---

**Last Updated:** November 23, 2025  
**Maintained By:** Development Team  
**Version:** 1.0.0

---

## Suggestions

1. **Always work from `dev` branch**
2. **Use conventional commit messages**
3. **Test thoroughly before committing**
4. **Review everything before committing**
5. **Follow the workflow, stay organized**
6. **Document as you go**
7. **Ask questions when unsure**
8. **Keep production stable**

---
