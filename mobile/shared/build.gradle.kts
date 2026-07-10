plugins {
    kotlin("multiplatform") version "2.3.21"
    id("com.android.library") version "8.13.2"
    id("org.jetbrains.compose") version "1.11.1"
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21"
    kotlin("plugin.serialization") version "2.3.21"
    id("app.cash.sqldelight") version "2.1.0"
}

kotlin {
    androidTarget {
        compilations.all {
            compileTaskProvider.configure {
                compilerOptions {
                    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
                }
            }
        }
    }
    
    // Compose Multiplatform 1.11.x no longer publishes iosX64 (Intel-simulator) artifacts;
    // the iOS app only uses iosSimulatorArm64/iosArm64 (see shared.podspec), so iosX64 is dropped.
    listOf(
        iosArm64(),
        iosSimulatorArm64()
    ).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = "shared"
            isStatic = true
        }
    }
    
    // Set iOS deployment target to match Xcode project (iOS 14.0)
    targets.filterIsInstance<org.jetbrains.kotlin.gradle.plugin.mpp.KotlinNativeTarget>().forEach { target ->
        target.compilations.all {
            compileTaskProvider.configure {
                compilerOptions {
                    freeCompilerArgs.add("-Xoverride-konan-properties=osVersionMin.ios_arm64=14.0")
                    freeCompilerArgs.add("-Xoverride-konan-properties=osVersionMin.ios_simulator_arm64=14.0")
                }
            }
        }
    }
    
    sourceSets {
        commonMain.dependencies {
            // Compose Multiplatform
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.ui)
            implementation(compose.components.resources)
            implementation(compose.components.uiToolingPreview)
            // Material icons: the ~24 icons used by the shared UI are vendored as plain
            // ImageVectors in presentation/components/AppIcons.kt, so we no longer depend on the
            // frozen `material-icons-extended:1.7.3` artifact (Compose MP stopped publishing it).

            // Kotlinx
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
            implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.6.1")
            implementation("org.jetbrains.kotlinx:atomicfu:0.27.0")
            
            // Ktor (Network)
            implementation("io.ktor:ktor-client-core:3.5.1")
            implementation("io.ktor:ktor-client-content-negotiation:3.5.1")
            implementation("io.ktor:ktor-serialization-kotlinx-json:3.5.1")
            implementation("io.ktor:ktor-client-logging:3.5.1")
            implementation("io.ktor:ktor-client-auth:3.5.1")
            
            // Koin DI
            implementation("io.insert-koin:koin-core:4.0.0")
            implementation("io.insert-koin:koin-compose:4.0.0")

            // DataStore
            implementation("androidx.datastore:datastore-preferences-core:1.1.1")

            // SQLDelight (offline persistence)
            implementation("app.cash.sqldelight:runtime:2.1.0")
            implementation("app.cash.sqldelight:coroutines-extensions:2.1.0")
            
            // Lifecycle ViewModel
            implementation("androidx.lifecycle:lifecycle-viewmodel:2.8.7")
            
            // Navigation
            implementation("org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10")
        }
        
        androidMain.dependencies {
            // Ktor Android Engine
            implementation("io.ktor:ktor-client-okhttp:3.5.1")

            // Koin Android
            implementation("io.insert-koin:koin-android:4.0.0")

            // Android DataStore
            implementation("androidx.datastore:datastore-preferences:1.1.1")

            // SQLDelight Android driver
            implementation("app.cash.sqldelight:android-driver:2.1.0")

            // CameraX (barcode-scanning camera pipeline)
            implementation("androidx.camera:camera-camera2:1.4.0")
            implementation("androidx.camera:camera-lifecycle:1.4.0")
            implementation("androidx.camera:camera-view:1.4.0")
            implementation("com.google.mlkit:barcode-scanning:17.3.0")

            // Process-level lifecycle owner for the long-lived CameraService Koin singleton
            implementation("androidx.lifecycle:lifecycle-process:2.8.7")
        }

        iosMain.dependencies {
            // Ktor iOS Engine
            implementation("io.ktor:ktor-client-darwin:3.5.1")

            // SQLDelight native driver
            implementation("app.cash.sqldelight:native-driver:2.1.0")
        }
        
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
            implementation("app.cash.sqldelight:sqlite-driver:2.1.0")
        }
    }
}

android {
    namespace = "com.idento.shared"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

sqldelight {
    databases {
        create("IdentoDatabase") {
            packageName.set("com.idento.db")
        }
    }
}
