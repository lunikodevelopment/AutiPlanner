package app.autiplanner.data

import java.net.URI

/**
 * Connection settings for the Home Assistant boundary.
 *
 * The app never edits the calendar file. These values only point it at the
 * Home Assistant that owns the calendar.
 */
data class RoutineSettings(
    val baseUrl: String = "",
    val token: String = "",
    val entityId: String = "",
) {
    /** A normalized base URL, or null when the entry is not usable. */
    fun normalizedUrl(): String? = validateUrl(baseUrl)

    val isConfigured: Boolean
        get() = normalizedUrl() != null && token.isNotBlank() && entityId.isNotBlank()

    /** User-facing problems. Empty when the settings can be saved. */
    fun problems(): List<String> = buildList {
        if (baseUrl.isBlank()) {
            add(SetupProblem.URL_MISSING)
        } else if (normalizedUrl() == null) {
            add(SetupProblem.URL_INVALID)
        }
        if (token.isBlank()) add(SetupProblem.TOKEN_MISSING)
        if (entityId.isBlank()) add(SetupProblem.ENTITY_MISSING)
    }

    companion object {
        /**
         * Accepts http and https only. `URI` is used rather than `android.net.Uri`
         * so this stays testable on a plain JVM.
         */
        fun validateUrl(value: String): String? {
            val trimmed = value.trim().trimEnd('/')
            if (trimmed.isEmpty()) return null
            val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
            val scheme = uri.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return null
            if (uri.host.isNullOrBlank()) return null
            return trimmed
        }
    }
}

object SetupProblem {
    const val URL_MISSING = "Enter your Home Assistant address."
    const val URL_INVALID = "The address must start with http:// or https:// and include a host."
    const val TOKEN_MISSING = "Paste a long-lived Home Assistant access token."
    const val ENTITY_MISSING = "Enter the AutiPlanner entity, for example sensor.routine_agenda."
}

/** Persistence seam. Tests use an in-memory implementation. */
interface SettingsStore {
    fun load(): RoutineSettings

    fun save(settings: RoutineSettings)
}

class InMemorySettingsStore(private var settings: RoutineSettings = RoutineSettings()) : SettingsStore {
    override fun load(): RoutineSettings = settings

    override fun save(settings: RoutineSettings) {
        this.settings = settings
    }
}
