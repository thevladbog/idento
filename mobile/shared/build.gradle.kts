plugins {
    kotlin("multiplatform") version "2.1.0"
    id("com.android.library") version "8.7.2"
    id("org.jetbrains.compose") version "1.7.3"
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
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
    
    listOf(
        iosX64(),
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
                    freeCompilerArgs.add("-Xoverride-konan-properties=osVersionMin.ios_x64=14.0")
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
            
            // Kotlinx
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
            implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.6.1")
            implementation("org.jetbrains.kotlinx:atomicfu:0.27.0")
            
            // Ktor (Network)
            implementation("io.ktor:ktor-client-core:3.0.2")
            implementation("io.ktor:ktor-client-content-negotiation:3.0.2")
            implementation("io.ktor:ktor-serialization-kotlinx-json:3.0.2")
            implementation("io.ktor:ktor-client-logging:3.0.2")
            implementation("io.ktor:ktor-client-auth:3.0.2")
            
            // Koin DI
            implementation("io.insert-koin:koin-core:4.0.0")
            implementation("io.insert-koin:koin-compose:4.0.0")
            
            // DataStore
            implementation("androidx.datastore:datastore-preferences-core:1.1.1")
            
            // Lifecycle ViewModel
            implementation("androidx.lifecycle:lifecycle-viewmodel:2.8.7")
            
            // Navigation
            implementation("org.jetbrains.androidx.navigation:navigation-compose:2.8.0-alpha10")
        }
        
        androidMain.dependencies {
            // Ktor Android Engine
            implementation("io.ktor:ktor-client-okhttp:3.0.2")
            
            // Koin Android
            implementation("io.insert-koin:koin-android:4.0.0")
            
            // Android DataStore
            implementation("androidx.datastore:datastore-preferences:1.1.1")
        }
        
        iosMain.dependencies {
            // Ktor iOS Engine
            implementation("io.ktor:ktor-client-darwin:3.0.2")
        }
        
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
        }
    }
}

android {
    namespace = "com.idento.shared"
    compileSdk = 35
    
    defaultConfig {
        minSdk = 26
    }
    
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
