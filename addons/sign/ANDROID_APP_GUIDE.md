# SynergySign Android App - Kotlin

A complete native Android app built with Kotlin and Jetpack Compose for the SynergySign e-signature platform.

## 🛠️ Tech Stack

- **Language**: Kotlin 1.9+
- **UI**: Jetpack Compose with Material 3
- **Architecture**: MVVM + Clean Architecture
- **Networking**: Retrofit 2 + OkHttp
- **Dependency Injection**: Hilt
- **Async**: Kotlin Coroutines + Flow
- **Local Storage**: DataStore (Preferences)
- **Navigation**: Jetpack Navigation Compose

## 📋 Prerequisites

- Android Studio Hedgehog (2023.1.1) or later
- JDK 17
- Android SDK 34
- Kotlin 1.9+

## 🚀 Quick Start

### 1. Open Project in Android Studio

```bash
cd android-app
# Open in Android Studio
```

### 2. Configure API Base URL

Edit `app/src/main/java/com/synergysign/app/data/api/ApiConfig.kt`:

```kotlin
object ApiConfig {
    // For Android Emulator accessing localhost
    const val BASE_URL = "http://10.0.2.2:3000/api/"
    
    // For physical device on same WiFi
    // const val BASE_URL = "http://192.168.1.XXX:3000/api/"
    
    // For production
    // const val BASE_URL = "https://your-synergysign-domain.com/api/"
}
```

### 3. Build and Run

1. Connect an Android device or start an emulator
2. Click **Run** (▶) in Android Studio

Or via command line:
```bash
./gradlew installDebug
```

## 📁 Project Structure

```
android-app/
├── app/
│   ├── src/main/
│   │   ├── java/com/synergysign/app/
│   │   │   ├── data/                    # Data layer
│   │   │   │   ├── api/                 # Retrofit API
│   │   │   │   │   ├── ApiConfig.kt     # API configuration
│   │   │   │   │   ├── ApiService.kt    # API endpoints
│   │   │   │   │   └── AuthInterceptor.kt
│   │   │   │   ├── model/               # Data models
│   │   │   │   │   └── ApiModels.kt
│   │   │   │   └── repository/          # Repositories
│   │   │   │       ├── AuthRepository.kt
│   │   │   │       ├── DocumentRepository.kt
│   │   │   │       └── TokenRepository.kt
│   │   │   ├── di/                      # Hilt modules
│   │   │   │   └── AppModule.kt
│   │   │   ├── presentation/            # UI layer
│   │   │   │   ├── auth/                # Login/Signup
│   │   │   │   │   ├── AuthViewModel.kt
│   │   │   │   │   ├── LoginScreen.kt
│   │   │   │   │   └── SignupScreen.kt
│   │   │   │   ├── dashboard/           # Dashboard
│   │   │   │   │   ├── DashboardViewModel.kt
│   │   │   │   │   └── DashboardScreen.kt
│   │   │   │   ├── documents/           # Document list
│   │   │   │   │   ├── DocumentListViewModel.kt
│   │   │   │   │   └── DocumentListScreen.kt
│   │   │   │   ├── common/              # Shared components
│   │   │   │   │   └── DocumentCard.kt
│   │   │   │   ├── theme/               # Material theme
│   │   │   │   │   ├── Color.kt
│   │   │   │   │   └── Theme.kt
│   │   │   │   └── MainActivity.kt      # Main entry + Navigation
│   │   │   └── SynergySignApp.kt        # Application class
│   │   ├── res/                         # Resources
│   │   └── AndroidManifest.xml
│   ├── build.gradle.kts                 # App dependencies
│   └── proguard-rules.pro
├── build.gradle.kts                     # Project build config
├── settings.gradle.kts
└── gradle.properties
```

## ✨ Features Included

### Authentication
- Login with email/password
- User registration with validation
- JWT token management
- Automatic token refresh
- Secure token storage with DataStore

### Dashboard
- Statistics cards (Total, Pending, Completed, Active Signers)
- Recent documents list
- Quick action buttons
- Pull-to-refresh

### Documents
- Document list with pagination
- Status filtering (Draft, Sent, Completed, Expired)
- Search functionality
- Document cards with status indicators
- Signer progress display

### UI/UX
- Material 3 Design
- Light/Dark theme support
- Loading states
- Error handling with dialogs
- Pull-to-refresh

## 🔌 API Integration

The app connects to these SynergySign API endpoints:

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/signup` | POST | Create account |
| `/auth/callback/credentials` | POST | Login |
| `/auth/verify` | POST | Verify email |

### Documents
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/documents` | GET | List documents |
| `/documents/{id}` | GET | Get document |
| `/documents/upload` | POST | Upload document |
| `/documents/{id}/signers` | POST | Add signers |
| `/documents/{id}/archive` | POST | Archive document |

### Dashboard
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dashboard/stats` | GET | Get statistics |

## 🔒 Security

- **Token Storage**: DataStore with encryption
- **Auth Interceptor**: Automatic token injection
- **401 Handling**: Automatic logout on token expiry
- **ProGuard**: Obfuscation for release builds
- **Network Security**: Cleartext traffic disabled in production

## 📱 Building for Release

### Generate Signed APK/AAB

1. In Android Studio: **Build → Generate Signed Bundle/APK**
2. Create or select a keystore
3. Select **release** build type
4. Build!

Or via command line:
```bash
# APK
./gradlew assembleRelease

# AAB (for Play Store)
./gradlew bundleRelease
```

### Play Store Checklist
- [ ] App icon (512x512 PNG)
- [ ] Feature graphic (1024x500)
- [ ] Screenshots (phone & tablet)
- [ ] Privacy policy URL
- [ ] App description
- [ ] Content rating questionnaire

## 🧪 Testing

```bash
# Run unit tests
./gradlew test

# Run instrumented tests
./gradlew connectedAndroidTest
```

## 📝 Adding New Features

### Add a New Screen

1. Create ViewModel in `presentation/feature/`:
```kotlin
@HiltViewModel
class MyViewModel @Inject constructor(
    private val repository: MyRepository
) : ViewModel() {
    // State and logic
}
```

2. Create Composable Screen:
```kotlin
@Composable
fun MyScreen(
    viewModel: MyViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    // UI
}
```

3. Add to Navigation in `MainActivity.kt`:
```kotlin
composable("my_screen") {
    MyScreen()
}
```

### Add a New API Endpoint

1. Add to `ApiService.kt`:
```kotlin
@GET("my-endpoint")
suspend fun myEndpoint(): Response<MyResponse>
```

2. Add data class in `ApiModels.kt`:
```kotlin
data class MyResponse(
    val data: String
)
```

3. Add repository method:
```kotlin
suspend fun myMethod(): Result<MyData> = withContext(Dispatchers.IO) {
    try {
        val response = apiService.myEndpoint()
        if (response.isSuccessful) {
            Result.success(response.body()!!)
        } else {
            Result.failure(Exception("Error"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

## 🐛 Troubleshooting

### "Connection refused" on emulator
- Use `10.0.2.2` instead of `localhost` for emulator
- Ensure backend server is running
- Check firewall settings

### Build errors
```bash
# Clean and rebuild
./gradlew clean build
```

### Hilt errors
- Ensure `@HiltAndroidApp` on Application class
- Ensure `@AndroidEntryPoint` on Activity
- Run **Build → Rebuild Project**

## 📄 License

Proprietary - Synergy Technologies LLC

---

Built with ❤️ using Kotlin and Jetpack Compose
