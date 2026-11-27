import java.security.MessageDigest

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

val promptsSourceDir = rootProject.layout.projectDirectory.dir("../../packages/prompts/p2.1")
val generatedPromptsAssetDir = layout.buildDirectory.dir("generated/toulmin-prompts/assets")

val generatePromptAssets by tasks.registering {
    inputs.dir(promptsSourceDir)
    outputs.dir(generatedPromptsAssetDir)
    doLast {
        val outDir = generatedPromptsAssetDir.get().asFile.resolve("prompts/p2.1")
        outDir.mkdirs()
        val files = listOf("stage1.txt", "stage2.txt", "b5.txt", "o2.txt", "alt_sources.txt")
        val md = MessageDigest.getInstance("SHA-256")
        val entries = LinkedHashMap<String, String>()
        for (name in files) {
            val src = promptsSourceDir.file(name).asFile
            require(src.isFile) { "Missing canonical SSOT prompt file: ${src.absolutePath}" }
            val bytes = src.readBytes()
            outDir.resolve(name).writeBytes(bytes)
            md.reset()
            val hex = md.digest(bytes).joinToString("") { "%02x".format(it) }
            entries[name] = hex
        }
        val filesJson = entries.entries.joinToString(",\n    ") { "\"${it.key}\": \"${it.value}\"" }
        val manifest = """
            {
              "promptVersion": "p2.1",
              "files": {
                $filesJson
              }
            }
        """.trimIndent() + "\n"
        outDir.resolve("manifest.json").writeText(manifest, Charsets.UTF_8)
    }
}

android {
    namespace = "app.toulmin.l1"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(generatedPromptsAssetDir)
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

tasks.named("preBuild").configure {
    dependsOn(generatePromptAssets)
}

dependencies {
    implementation(project(":core-l0"))
    implementation(project(":spike-core"))

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.ai) {
        exclude(group = "com.google.firebase", module = "firebase-appcheck")
    }
    implementation(libs.firebase.ai.ondevice)
    ksp(libs.firebase.ai.ksp.processor)

    implementation(libs.mlkit.genai.prompt)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    systemProperty(
        "toulmin.repoRoot",
        rootProject.projectDir.resolve("../..").canonicalPath,
    )
}
