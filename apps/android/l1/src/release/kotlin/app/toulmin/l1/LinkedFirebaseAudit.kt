package app.toulmin.l1

import app.toulmin.spikes.LinkedClassAudit

internal object LinkedFirebaseAudit {
    fun inspect(classLoader: ClassLoader?): LinkedClassAudit {
        val aiPresent = runCatching {
            Class.forName("com.google.firebase.ai.FirebaseAI", false, classLoader)
            true
        }.getOrDefault(false)
        return LinkedClassAudit(
            forbiddenNetworkClassesFound = emptyList(),
            debugClassesFound = emptyList(),
            aiLogicPresent = aiPresent,
            appCheckCorePresent = false,
        )
    }
}
