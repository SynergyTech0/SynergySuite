# SynergySign Android App

A native Android app built with Kotlin for the SynergySign e-signature platform.

## 🛠️ Tech Stack

- **Language**: Kotlin
- **UI**: Jetpack Compose
- **Architecture**: MVVM + Clean Architecture
- **Networking**: Retrofit + OkHttp
- **Dependency Injection**: Hilt
- **Async**: Kotlin Coroutines + Flow
- **Local Storage**: DataStore (encrypted) + Room Database
- **Navigation**: Jetpack Navigation Compose
- **Push Notifications**: Firebase Cloud Messaging
- **Background Sync**: WorkManager

## 📋 Prerequisites

- Android Studio Hedgehog (2023.1.1) or later
- JDK 17
- Android SDK 34
- Kotlin 1.9+
- Firebase project (for push notifications)

## 🚀 Getting Started

### 1. Open in Android Studio

```bash
cd android-app
# Open the folder in Android Studio
```

### 2. Configure Firebase

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Add an Android app with package name `com.synergysign.app`
3. Download `google-services.json` and place it in `app/`

### 3. Configure API Base URL

Update the base URL in `app/src/main/java/com/synergysign/app/data/api/ApiConfig.kt`:

```kotlin
object ApiConfig {
    // For emulator accessing localhost
    const val BASE_URL = "http://10.0.2.2:3000/api/"
    
    // For production
    // const val BASE_URL = "https://your-domain.com/api/"
}
```

### 4. Build and Run

1. Connect an Android device or start an emulator
2. Click "Run" in Android Studio or use:
```bash
./gradlew installDebug
```

## 📁 Project Structure

```
app/src/main/java/com/synergysign/app/
├── data/                    # Data layer
│   ├── api/                 # Retrofit API interfaces
│   │   ├── ApiConfig.kt
│   │   ├── ApiService.kt
│   │   └── AuthInterceptor.kt
│   ├── local/               # Room database
│   │   └── SynergySignDatabase.kt
│   ├── repository/          # Repository implementations
│   │   ├── AuthRepository.kt
│   │   ├── DocumentRepository.kt
│   │   ├── OfflineRepository.kt
│   │   ├── AnalyticsRepository.kt
│   │   ├── UserRepository.kt
│   │   ├── BillingRepository.kt
│   │   ├── AffiliateRepository.kt
│   │   ├── SignersRepository.kt
│   │   ├── SettingsRepository.kt
│   │   ├── AiRepository.kt
│   │   └── EnterpriseRepository.kt
│   └── model/               # Data Transfer Objects
│       └── ApiModels.kt
├── service/                 # Background services
│   ├── SynergySignFirebaseMessagingService.kt
│   └── SyncWorker.kt
├── presentation/            # UI layer
│   ├── auth/                # Login/Signup screens
│   ├── dashboard/           # Dashboard screen
│   ├── documents/           # Document list
│   ├── upload/              # Document upload
│   ├── viewer/              # PDF viewing & field placement
│   ├── signature/           # Signature capture
│   ├── biometric/           # Biometric auth settings
│   ├── verification/        # Email verification
│   ├── templates/           # Document templates
│   ├── history/             # Audit trail
│   ├── sharing/             # Deep links & sharing
│   ├── analytics/           # Analytics dashboard with charts
│   ├── profile/             # Profile management
│   ├── billing/             # Subscription & billing
│   ├── affiliates/          # Affiliate program
│   ├── signers/             # Signers/contacts management
│   ├── settings/            # App settings
│   ├── ai/                  # AI features (summary, classification)
│   ├── enterprise/          # Team management & branding
│   ├── bulk/                # Bulk document operations
│   ├── common/              # Shared components
│   └── theme/               # Material theme
├── di/                      # Dependency injection
│   └── AppModule.kt
└── SynergySignApp.kt        # Application class
```

## 🔑 Features

### Core E-Sign Features
- [x] User authentication (Login/Signup)
- [x] Dashboard with statistics
- [x] Document list with filtering & search
- [x] Document upload (PDF picker)
- [x] PDF viewing with zoom
- [x] Signature capture canvas
- [x] Field placement (Signature, Initials, Date, Text, Checkbox)

### Production Polish
- [x] Push notifications (Firebase Cloud Messaging)
- [x] Biometric authentication (Fingerprint/Face)
- [x] Offline mode with local caching
- [x] App splash screen

### Web App Feature Parity
- [x] Analytics dashboard with charts (document metrics, trends)
- [x] Profile management (edit name, email, photo, password)
- [x] Billing & Subscription (plan upgrades, payment methods, invoices)
- [x] Affiliate program (referral links, earnings tracking, payouts)
- [x] Signers/contacts management (save frequently used signers, groups)
- [x] Settings (notifications, timezone, theme, offline mode)

### AI Features
- [x] Document classification (Contract, NDA, Invoice, etc.)
- [x] AI-powered document summarization
- [x] Smart field detection (auto-suggest signature placements)
- [x] Signer extraction from document text
- [x] Keyword extraction

### Enterprise Features
- [x] Team management (invite members, assign roles)
- [x] Bulk operations (send multiple documents at once)
- [x] Custom branding (logo, colors, email templates)
- [x] Role-based access control

### Optional Enhancements
- [x] Email verification flow UI
- [x] Document sharing via deep links
- [x] Template selection for new documents
- [x] Audit trail/history view

## 🔔 Push Notifications

The app supports push notifications for:
- **Signing requests** - When you're invited to sign
- **Document completed** - When all parties have signed
- **Document viewed** - When someone views your document
- **Reminders** - Signing deadline reminders

## 🔐 Biometric Authentication

Enable fingerprint/face unlock for:
- Quick app login
- Confirming signature actions
- Accessing sensitive documents

## 📡 Offline Mode

Documents are cached locally for offline access:
- View previously loaded documents
- Queue signatures for sync when online
- Automatic background sync via WorkManager

## 🔗 Deep Links

The app handles these URL schemes:
- `synergysign://document/{id}` - Open document
- `synergysign://sign/{id}` - Sign document
- `https://synergysign.app/document/{id}` - Web deep link

## 🔒 Security

- JWT tokens stored in EncryptedSharedPreferences
- Certificate pinning (optional, configure in OkHttp)
- Biometric authentication via BiometricPrompt
- ProGuard/R8 obfuscation enabled for release builds
- HTTPS-only in production (via network_security_config.xml)

## 📱 Building for Release

```bash
# Generate signed APK
./gradlew assembleRelease

# Generate signed AAB for Play Store
./gradlew bundleRelease
```

## 📚 API Integration

The app connects to the SynergySign REST API. Key endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/signup` | POST | Create account |
| `/auth/callback/credentials` | POST | Login |
| `/auth/verify` | POST | Verify email |
| `/documents` | GET | List documents |
| `/documents/{id}` | GET | Document details |
| `/documents/upload` | POST | Upload document |
| `/documents/{id}/sign` | POST | Sign a field |
| `/templates` | GET | List templates |
| `/dashboard/stats` | GET | Dashboard statistics |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `./gradlew test`
5. Submit a pull request

## 📄 License

Proprietary - Synergy Technologies LLC
