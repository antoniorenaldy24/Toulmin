package app.toulmin.l1

import app.toulmin.spikes.LinkedClassAudit

internal object LinkedFirebaseAudit {
    fun inspect(classLoader: ClassLoader?): LinkedClassAudit {
        val forbiddenClasses = listOf(
            "com.google.firebase.firestore.FirebaseFirestore",
            "com.google.firebase.functions.FirebaseFunctions",
            "com.google.firebase.auth.FirebaseAuth",
            "com.google.firebase.remoteconfig.FirebaseRemoteConfig",
            "com.google.firebase.storage.FirebaseStorage",
            "com.google.android.play.core.integrity.IntegrityManagerFactory",
            "com.google.firebase.appcheck.FirebaseAppCheck",
            "com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory",
        )
        val debugProviderClasses = listOf(
            "com.google.firebase.appcheck.debug.FirebaseAppCheckDebugRegistrar",
            "com.google.firebase.appcheck.debug.testing.DebugAppCheckTestHelper",
        )
        val foundForbidden = forbiddenClasses.filter { isClassPresent(it, classLoader) }
        val foundDebug = debugProviderClasses.filter { isClassPresent(it, classLoader) }
        val aiPresent = isClassPresent("com.google.firebase.ai.FirebaseAI", classLoader)
        val appCheckCore = isClassPresent("com.google.firebase.appcheck.FirebaseAppCheck", classLoader)
        return LinkedClassAudit(
            forbiddenNetworkClassesFound = foundForbidden,
            debugClassesFound = foundDebug,
            aiLogicPresent = aiPresent,
            appCheckCorePresent = appCheckCore,
        )
    }

    private fun isClassPresent(name: String, classLoader: ClassLoader?): Boolean =
        runCatching {
            Class.forName(name, false, classLoader)
            true
        }.getOrDefault(false)
}
