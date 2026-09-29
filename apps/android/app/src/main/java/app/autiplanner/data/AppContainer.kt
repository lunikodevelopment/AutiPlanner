package app.autiplanner.data

import java.io.IOException

/**
 * Builds the Home Assistant client.
 *
 * The client is created lazily from stored settings. When the app is not
 * configured yet, the transport fails with a readable message instead of
 * throwing during construction, so a missing configuration can never crash the
 * app on startup.
 */
class AppContainer(private val settingsStore: SettingsStore) {

    /**
     * Reads settings defensively. A keystore or storage failure must degrade to
     * the setup screen, never to a crash during composition.
     */
    fun settings(): RoutineSettings = runCatching { settingsStore.load() }
        .getOrDefault(RoutineSettings())

    fun isConfigured(): Boolean = settings().isConfigured

    fun save(settings: RoutineSettings) {
        runCatching { settingsStore.save(settings) }
    }
    fun client(): HomeAssistantRoutineClient {
        val settings = settings()
        val transport = if (settings.isConfigured) {
            HomeAssistantHttpTransport(
                baseUrl = settings.normalizedUrl()!!,
                tokenProvider = { settings.token },
            )
        } else {
            UnconfiguredTransport()
        }
        return HomeAssistantRoutineClient(
            transport = transport,
            entityId = settings.entityId.ifBlank { DEFAULT_ENTITY },
        )
    }

    /** Redeems a pairing code for a token. No token is needed to call this. */
    suspend fun pair(baseUrl: String, code: String, deviceName: String): PairResult =
        PairingClient { url -> HomeAssistantHttpTransport(url, tokenProvider = { "" }) }
            .pair(candidates = candidates(baseUrl), code = code, deviceName = deviceName)

    /**
     * Candidate addresses, most specific first. `http` is tried as a fallback
     * for a local instance without TLS, which is common on a home network.
     */
    private fun candidates(baseUrl: String): List<String> {
        val primary = baseUrl.trim().trimEnd('/')
        if (primary.isEmpty()) return emptyList()
        val candidates = mutableListOf(primary)
        val stored = settings().normalizedUrl()
        if (stored != null && stored != primary) candidates.add(stored)
        if (primary.startsWith("https://")) {
            candidates.add("http://" + primary.removePrefix("https://"))
        }
        return candidates
    }

    private companion object {
        const val DEFAULT_ENTITY = "sensor.routine_agenda"
    }
}

/** Used before setup. Every call reports that the app is not connected yet. */
class UnconfiguredTransport : RoutineTransport {
    override suspend fun post(path: String, body: kotlinx.serialization.json.JsonObject) =
        throw IOException("AutiPlanner is not connected to Home Assistant yet.")
}
