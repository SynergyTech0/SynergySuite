# SynergySign - Project Structure Overview

## 📁 Directory Structure

All application files have been moved from `nextjs_space/` to the root level for easier access and deployment.

```
/home/ubuntu/ai_docusign_clone/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── auth/                 # NextAuth endpoints
│   │   ├── dashboard/            # Dashboard stats
│   │   ├── documents/            # Document management
│   │   │   ├── upload/           # Document upload
│   │   │   └── [id]/             # Document operations
│   │   ├── files/                # File serving (local storage)
│   │   └── signup/               # User registration
│   ├── auth/                     # Authentication pages
│   │   ├── login/                # Login page
│   │   └── signup/               # Signup page
│   ├── dashboard/                # Main dashboard pages
│   │   ├── analytics/            # Analytics page
│   │   ├── billing/              # Billing & subscriptions
│   │   ├── documents/            # Document management
│   │   │   ├── [id]/             # Document detail view
│   │   │   └── upload/           # Upload new document
│   │   ├── profile/              # User profile
│   │   ├── settings/             # Account settings
│   │   ├── sign/                 # Documents to sign
│   │   ├── signers/              # Signer management
│   │   ├── templates/            # Template management
│   │   │   └── create/           # Create new template
│   │   └── page.tsx              # Dashboard home
│   ├── globals.css               # Global styles
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Landing page
│
├── components/                   # React components
│   ├── dashboard/                # Dashboard components
│   │   ├── sidebar.tsx           # Navigation sidebar
│   │   ├── dashboard-header.tsx  # Header component
│   │   ├── dashboard-content.tsx # Main content area
│   │   ├── recent-documents.tsx  # Document list
│   │   └── quick-actions.tsx     # Quick action buttons
│   ├── landing/                  # Landing page components
│   │   └── landing-page.tsx      # Landing page layout
│   ├── ui/                       # Shadcn UI components
│   └── providers.tsx             # Context providers
│
├── lib/                          # Utility libraries
│   ├── auth.ts                   # NextAuth configuration
│   ├── db.ts                     # Prisma client
│   ├── storage.ts                # 🌟 Hybrid storage system
│   ├── subscription-limits.ts    # Subscription tier logic
│   ├── types.ts                  # TypeScript types
│   └── utils.ts                  # Utility functions
│
├── prisma/                       # Database
│   └── schema.prisma             # Database schema (AI-ready)
│
├── public/                       # Static assets
│   └── favicon.svg               # Site icon
│
├── scripts/                      # Utility scripts
│   └── seed.ts                   # Database seeding
│
├── uploads/                      # 🌟 Local file storage
│   ├── documents/                # Uploaded documents
│   └── templates/                # Template files
│
├── types/                        # TypeScript type definitions
│
├── .env                          # Environment variables
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── tailwind.config.ts            # Tailwind CSS config
├── next.config.js                # Next.js config
│
├── AI_FEATURES_GUIDE.md          # 🤖 AI integration guide
├── HYBRID_STORAGE_SETUP.md       # 💾 Storage configuration guide
└── PROJECT_STRUCTURE.md          # 📄 This file

Note: nextjs_space/ folder still exists but is no longer used
```

---

## 🗂️ Key Files & Their Purpose

### Core Application Files

| File | Purpose |
|------|---------|
| `app/page.tsx` | Landing page with features, pricing, testimonials |
| `app/layout.tsx` | Root layout with metadata and providers |
| `app/globals.css` | Global styles and Tailwind imports |

### Authentication

| File | Purpose |
|------|---------|
| `lib/auth.ts` | NextAuth configuration with credentials provider |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth API handler |
| `app/auth/login/page.tsx` | Login form |
| `app/auth/signup/page.tsx` | Registration form |
| `app/api/signup/route.ts` | User registration API |

### Storage System 🌟

| File | Purpose |
|------|---------|
| `lib/storage.ts` | **Hybrid storage system** - local + S3 |
| `app/api/files/[...path]/route.ts` | Serves files from local storage |
| `uploads/` | Local file storage directory |

**Storage Modes:**
- `hybrid` (default): Local storage + S3 backup
- `local`: Local storage only
- `s3`: S3 storage only

### Document Management

| File | Purpose |
|------|---------|
| `app/api/documents/upload/route.ts` | Upload new documents |
| `app/api/documents/[id]/route.ts` | Get/update/delete document |
| `app/api/documents/[id]/download/route.ts` | Generate download URLs |
| `app/dashboard/documents/page.tsx` | Document list view |
| `app/dashboard/documents/[id]/page.tsx` | Document detail view |
| `app/dashboard/documents/upload/page.tsx` | Upload interface |

### Database

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database schema (AI-ready fields included) |
| `lib/db.ts` | Prisma client singleton |

**Key Models:**
- `User` - User accounts
- `Subscription` - Subscription tiers (FREE, BASIC, PRO, ENTERPRISE)
- `Document` - Documents with AI fields (summary, suggestedFields)
- `DocumentSigner` - Signer information
- `DocumentField` - Signature/form fields
- `Template` - Reusable templates
- `AuditLog` - Activity tracking
- `Notification` - Email notifications

### Subscription & Billing

| File | Purpose |
|------|---------|
| `lib/subscription-limits.ts` | Tier limits and validation |
| `app/dashboard/billing/page.tsx` | Billing dashboard |
| `components/landing/landing-page.tsx` | Pricing section |

**Pricing Tiers:**
- **Basic**: $19.99/mo (7-day free trial)
- **Pro**: $29.99/mo
- **Enterprise**: Custom pricing

### UI Components

| Directory | Purpose |
|-----------|---------|
| `components/ui/` | Shadcn UI components (Button, Card, Dialog, etc.) |
| `components/dashboard/` | Dashboard-specific components |
| `components/landing/` | Landing page components |

---

## 🤖 Where is the AI?

### Current State: **AI-Ready Infrastructure** ✅

The application has been designed with AI capabilities in mind, but the actual AI logic needs to be implemented.

### AI-Ready Database Fields

In `prisma/schema.prisma`:
```prisma
model Document {
  summary           String?   @db.Text        // 🤖 AI-generated summary
  suggestedFields   Json?                     // 🤖 AI field suggestions
}
```

### AI Integration Points

1. **Document Upload** (`app/api/documents/upload/route.ts`)
   - 🔨 Add AI analysis after upload
   - Generate summary
   - Suggest field placements
   - Extract key information

2. **Document Analysis** (Create: `lib/ai/document-analyzer.ts`)
   - 🔨 Text extraction from PDFs
   - 🔨 Content summarization
   - 🔨 Field position detection
   - 🔨 Document classification

3. **Template Suggestions** (Create: `app/api/templates/suggest/route.ts`)
   - 🔨 Match documents to templates
   - 🔨 Auto-apply template fields

4. **Smart Reminders**
   - 🔨 Optimize reminder timing
   - 🔨 Personalize messages

### How to Implement AI

See `AI_FEATURES_GUIDE.md` for detailed implementation instructions.

**Quick Start:**
```bash
# 1. Create AI module directory
mkdir -p lib/ai

# 3. Create document analyzer
# lib/ai/document-analyzer.ts - analyzes uploaded documents

# 4. Integrate with upload API
# Modify app/api/documents/upload/route.ts
```

## 🔐 Environment Variables

Located in: `.env`

### Database
```
DATABASE_URL=postgresql://...
```

### Authentication
```
NEXTAUTH_SECRET=...
```

### Storage Configuration 🌟
```
STORAGE_MODE=hybrid                           # local, s3, or hybrid
LOCAL_STORAGE_PATH=/home/ubuntu/ai_docusign_clone/uploads
ENABLE_S3_BACKUP=true                         # Enable/disable S3 backup
```

### S3 Configuration (Optional)
```
AWS_PROFILE=hosted_storage
AWS_REGION=us-west-2
AWS_BUCKET_NAME=...
AWS_FOLDER_PREFIX=6188/
```

### Stripe Configuration
```
secret_key=sk_live_...
publishable_key=pk_live_...
webhook_secret=whsec_...
```

---

## 🚀 Running the Application

### Development Mode
```bash
cd /home/ubuntu/ai_docusign_clone
yarn dev
```

### Production Build
```bash
cd /home/ubuntu/ai_docusign_clone
yarn build
yarn start
```

### Database Operations
```bash
# Generate Prisma client
yarn prisma generate

# Run migrations
yarn prisma migrate dev

# Open Prisma Studio
yarn prisma studio
```

---

## 📦 Key Dependencies

### Core Framework
- `next` (14.2.28) - React framework
- `react` (18.2.0) - UI library
- `typescript` (5.2.2) - Type safety

### UI Components
- `@radix-ui/*` - Accessible component primitives
- `tailwindcss` (3.3.3) - Utility-first CSS
- `lucide-react` (0.446.0) - Icons

### Authentication
- `next-auth` (4.24.11) - Authentication
- `bcryptjs` (2.4.3) - Password hashing

### Database
- `@prisma/client` (6.7.0) - Database ORM
- `prisma` (6.7.0) - Database toolkit

### Storage
- `@aws-sdk/client-s3` (3.x) - S3 integration
- `@aws-sdk/s3-request-presigner` - Signed URLs

### Forms & Validation
- `react-hook-form` (7.53.0) - Form management
- `zod` (3.23.8) - Schema validation

### Utilities
- `date-fns` (3.6.0) - Date manipulation
- `clsx` (2.1.1) - Conditional classes

---

## 🎨 Styling

### Tailwind Configuration
- **Theme:** Dark mode support via `next-themes`
- **Colors:** Custom color palette in `tailwind.config.ts`
- **Components:** Shadcn UI with custom styling

### CSS Architecture
```
app/globals.css           # Global styles, Tailwind imports
components/ui/            # Component-specific styles (inline)
tailwind.config.ts        # Tailwind configuration
```

---

## 📊 Database Schema Overview

### User Management
- `User` - User accounts (with roles: SENDER, SIGNER, ADMIN)
- `Account` - OAuth accounts (NextAuth)
- `Session` - User sessions
- `Subscription` - Subscription management

### Document Management
- `Document` - Core document data (with AI fields)
- `DocumentSigner` - Signer assignments
- `DocumentField` - Signature/form fields
- `Template` - Reusable templates

### Auditing & Notifications
- `AuditLog` - Activity tracking
- `Notification` - Email notifications

**Total Models:** 11

---

## 🔧 Development Tips

### Adding New Features

1. **API Route:** Create in `app/api/[feature]/route.ts`
2. **Database Model:** Update `prisma/schema.prisma`
3. **UI Component:** Create in `components/[feature]/`
4. **Page:** Add to `app/dashboard/[feature]/page.tsx`

### Storage System

- Local files go to `uploads/documents/`
- Access files via `/api/files/documents/[filename]`
- S3 backup happens automatically in hybrid mode

### Authentication

- Protected routes use `getServerSession(authOptions)`
- Client-side: Use `useSession()` hook
- All dashboard routes require authentication

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `AI_FEATURES_GUIDE.md` | How to implement AI features |
| `HYBRID_STORAGE_SETUP.md` | Storage configuration guide |
| `PROJECT_STRUCTURE.md` | This file - project overview |

---

## 🎯 Next Steps

### To Enable AI Features:
1. Review `AI_FEATURES_GUIDE.md`
2. Create `lib/ai/` directory
3. Implement AI client and document analyzer
4. Integrate with upload API
5. Add UI components to display AI insights

### To Customize Storage:
1. Review `HYBRID_STORAGE_SETUP.md`
2. Update `.env` with your S3 credentials (optional)
3. Choose storage mode: `local`, `s3`, or `hybrid`

### To Deploy:
1. Set up production environment variables
2. Configure database (PostgreSQL)
3. Run database migrations
4. Build and deploy application

---

## 🆘 Support

### Common Issues

**Storage Issues:**
- Check `uploads/` directory permissions
- Verify `.env` storage configuration
- Review `HYBRID_STORAGE_SETUP.md`

**Database Issues:**
- Run `yarn prisma generate`
- Check `DATABASE_URL` in `.env`
- Verify PostgreSQL is running

**Authentication Issues:**
- Verify `NEXTAUTH_SECRET` is set
- Check `NEXTAUTH_URL` matches your domain

**Build Issues:**
- Run `yarn install` to update dependencies
- Clear `.next` folder and rebuild
- Check for TypeScript errors: `yarn tsc --noEmit`

---

## 📄 License & Credits

**SynergySign** - AI-Powered Electronic Signature Platform

Built with:
- Next.js 14
- TypeScript
- Prisma ORM
- Tailwind CSS
- Shadcn UI
- NextAuth
- AWS S3 (optional)

---

**Need Help?** Check the documentation files or review the code structure above! 🚀
