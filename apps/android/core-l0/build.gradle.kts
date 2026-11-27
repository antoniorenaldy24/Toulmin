plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

val tsCoreL0Dir = rootProject.layout.projectDirectory.dir("../../packages/core-l0")

val syncTierAAssets by tasks.registering(Copy::class) {
    from(tsCoreL0Dir.file("unicode_15_1.bin"))
    from(tsCoreL0Dir.file("norm_table.json"))
    from(tsCoreL0Dir.file("porter_v1.json"))
    from(tsCoreL0Dir.file("bm25_min_cov.json"))
    from(tsCoreL0Dir.file("wordlist_en.txt"))
    into(layout.projectDirectory.dir("src/main/resources"))
}

tasks.named("processResources") {
    dependsOn(syncTierAAssets)
}

tasks.test {
    useJUnitPlatform()
    systemProperty(
        "toulmin.repoRoot",
        rootProject.projectDir.resolve("../..").canonicalPath,
    )
    testLogging {
        events("passed", "skipped", "failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
