plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("maven-publish")
}

android {
    namespace = "cloud.synergytech.ui"
    compileSdk = 35

    // minSdk 26 is the floor across the fleet (SynergyPhone). Anything higher here
    // would silently exclude an app from adopting this.
    defaultConfig { minSdk = 26 }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }

    publishing { singleVariant("release") { withSourcesJar() } }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    api(composeBom)

    api("androidx.compose.ui:ui")
    api("androidx.compose.ui:ui-graphics")
    api("androidx.compose.material3:material3")
    api("androidx.compose.material:material-icons-extended")
    implementation("androidx.core:core-ktx:1.15.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.compose.ui:ui-tooling-preview")
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "cloud.synergytech"
            artifactId = "synergy-ui"
            version = "0.1.0"
            afterEvaluate { from(components["release"]) }
        }
    }
}
