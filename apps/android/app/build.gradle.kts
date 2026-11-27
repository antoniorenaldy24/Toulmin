plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

val hasGoogleServicesJson = file("google-services.json").exists() ||
    file("src/bundledSample/google-services.json").exists()

if (hasGoogleServicesJson) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "app.toulmin.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.toulmin"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-spike"

        buildConfigField("boolean", "HAS_GOOGLE_SERVICES_JSON", hasGoogleServicesJson.toString())
        buildConfigField("String", "PINNED_FIREBASE_BOM", "\"${libs.versions.firebase.bom.get()}\"")
        buildConfigField("String", "PINNED_FIREBASE_AI", "\"${libs.versions.firebase.ai.asProvider().get()}\"")
        buildConfigField("String", "PINNED_FIREBASE_AI_ONDEVICE", "\"${libs.versions.firebase.ai.ondevice.get()}\"")
        buildConfigField("String", "PINNED_FIREBASE_AI_KSP", "\"${libs.versions.firebase.ai.ksp.processor.get()}\"")
        buildConfigField("String", "PINNED_MLKIT_OCR", "\"${libs.versions.mlkit.text.recognition.get()}\"")
        buildConfigField("String", "PINNED_ROOM", "\"${libs.versions.room.get()}\"")
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("bundledSample") {
            dimension = "distribution"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += listOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "META-INF/DEPENDENCIES",
            )
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core-l0"))
    implementation(project(":spike-core"))
    implementation(project(":l1"))

    implementation(libs.mlkit.text.recognition)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.sqlite.bundled)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    systemProperty(
        "toulmin.repoRoot",
        rootProject.projectDir.resolve("../..").canonicalPath,
    )
    systemProperty(
        "toulmin.requireApk",
        System.getProperty("toulmin.requireApk") ?: "false",
    )
}
