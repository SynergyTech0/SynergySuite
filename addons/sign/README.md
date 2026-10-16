
# SynergySign - AI-Powered Electronic Signature Platform

![Synergy Technologies](./public/synergy-logo.png)

**By Synergy Technologies LLC**  
*Powering the Future Through Technology*

## Overview

SynergySign is a modern, AI-powered electronic signature platform that revolutionizes document workflow management. Built with cutting-edge technology, it offers intelligent field detection, seamless multi-party signing, and enterprise-grade security.

## 🚀 Features

- **AI-Powered Field Detection**: Automatically detect and place signature fields using advanced AI
- **Multi-Party Signing**: Manage documents requiring multiple signatures with role-based access
- **Real-Time Tracking**: Monitor document status and receive instant notifications
- **Template Management**: Create and reuse document templates for faster processing
- **Analytics Dashboard**: Track signing activity and document metrics
- **Affiliate System**: Built-in affiliate marketing program with automatic payouts
- **Enterprise Support**: Custom solutions for organizations
- **Bank-Level Security**: Enterprise-grade encryption and compliance

## 🛠️ Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js
- **Styling**: Tailwind CSS with shadcn/ui components
- **Storage**: AWS S3
- **Payments**: Stripe (for affiliate payouts)

## 📋 Prerequisites

- Node.js 18+ and Yarn
- PostgreSQL database
- AWS account (for S3 storage)
- Stripe account (for affiliate payouts)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ssynerg/ai_docusign_clone.git
   cd ai_docusign_clone
   ```

2. **Install dependencies**
   ```bash
   cd nextjs_space
   yarn install
   ```

3. **Set up environment variables**
   
   Copy the example environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```

   Required environment variables:
   ```env
   # Database
   DATABASE_URL="postgresql://username:password@localhost:5432/database_name?schema=public"

   # Authentication
   NEXTAUTH_SECRET="your-secret-key"
   NEXTAUTH_URL="http://localhost:3000"

   # AWS S3
   AWS_PROFILE=hosted_storage
   AWS_REGION=us-west-2
   AWS_BUCKET_NAME=your-bucket-name
   AWS_FOLDER_PREFIX=your-folder-prefix/

   # Stripe (for affiliate payouts)
   STRIPE_SECRET_KEY="sk_test_..."
   STRIPE_PUBLISHABLE_KEY="pk_test_..."
   STRIPE_WEBHOOK_SECRET="whsec_..."
   ```

4. **Set up the database**
   ```bash
   yarn prisma generate
   yarn prisma db push
   ```

5. **Run the development server**
   ```bash
   yarn dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📦 Production Deployment

### Build the application
```bash
yarn build
```

### Start the production server
```bash
yarn start
```

### Important Production Notes

- **Environment Variables**: Ensure all production environment variables are properly configured
- **Database**: Use a production PostgreSQL instance
- **NEXTAUTH_URL**: Set to your production domain
- **Stripe**: Use live keys (sk_live_... and pk_live_...)
- **Stripe Webhooks**: Configure webhook endpoint at `https://yourdomain.com/api/webhooks/stripe`
- **S3**: Configure production bucket with proper CORS settings

## 🎯 Key Features Documentation

### Affiliate System
The platform includes a complete affiliate marketing system:
- Users can refer others and earn $2/month per active subscription
- Automatic weekly payouts via Stripe
- Admin dashboard for affiliate management
- Detailed earnings tracking

See [AFFILIATE_SYSTEM.md](./AFFILIATE_SYSTEM.md) for full documentation.

### AI Features
- Smart document analysis
- Automatic field detection
- Intelligent signature placement
- Text extraction and processing

See [AI_FEATURES_GUIDE.md](./AI_FEATURES_GUIDE.md) for details.

### File Storage
Hybrid storage system supporting both local and S3 storage:
- Automatic cloud uploads
- Secure file access
- Download management

See [HYBRID_STORAGE_SETUP.md](./HYBRID_STORAGE_SETUP.md) and [S3_SETUP_INSTRUCTIONS.md](./S3_SETUP_INSTRUCTIONS.md).

### Mobile App Development
Native Android app built with Kotlin and Jetpack Compose:
- Complete Kotlin/Compose project ready to build
- MVVM + Clean Architecture
- Hilt dependency injection
- Retrofit for API integration

See [ANDROID_APP_GUIDE.md](./ANDROID_APP_GUIDE.md) and the `android-app/` directory.

## 👥 Default Admin Account

An admin account is automatically created when you first run the application:
- **Email**: admin@synergysign.com
- **Password**: Admin@123

⚠️ **Important**: Change the admin password immediately after first login!

## 📱 User Roles

- **ADMIN**: Full system access including user management
- **SENDER**: Can upload documents, manage templates, and send for signing
- **SIGNER**: Can sign documents sent to them

## 🔐 Security

- All passwords are hashed using bcrypt
- Session-based authentication with NextAuth.js
- Role-based access control (RBAC)
- Secure file storage with signed URLs
- Environment-based secrets management

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is proprietary software owned by Synergy Technologies LLC.

## 📞 Support

For enterprise inquiries and support:
- Email: sales@synergysign.com

## 🏢 About Synergy Technologies

Synergy Technologies LLC is committed to powering the future through innovative technology solutions. Our mission is to streamline business processes and enhance productivity through cutting-edge software.

---

**Built with ❤️ by Synergy Technologies LLC**
# ai_docusign_clone
