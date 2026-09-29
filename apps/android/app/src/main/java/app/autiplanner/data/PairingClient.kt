package app.autiplanner.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Exchanges a one-time pairing code for a Home Assistant token.
 *
 * This is the step that removes copying a long-lived token by hand. The code is
 * issued in Home Assistant by the `autiplanner.pair` action and is single use.
 */
sealed interface PairResult {
    /** Ready to save. `baseUrl` is taken from the request that worked. */
    data class Paired(val settings: RoutineSettings) : PairResult

    data class Failed(val message: String) : PairResult
}

class PairingClient(private val transportFactory: (String) -> RoutineTransport) {

    /**
     * Tries each candidate address until one answers. Households commonly have
     * both an internal and an external address, and only one may be reachable.
     */
    suspend fun pair(
        candidates: List<String>,
        code: String,
        deviceName: String,
    ): PairResult {
        val urls = candidates.mapNotNull { RoutineSettings.validateUrl(it) }.distinct()
        if (urls.isEmpty()) {
            return PairResult.Failed(SetupProblem.URL_INVALID)
        }
        if (code.isBlank()) {
            return PairResult.Failed("Enter the pairing code shown in Home Assistant.")
        }

        var lastError = "Could not reach Home Assistant."
        for (url in urls) {
            val outcome = redeem(url, code, deviceName)
            when (outcome) {
                is PairResult.Paired -> return outcome
                is PairResult.Failed -> lastError = outcome.message
            }
        }
        return PairResult.Failed(lastError)
    }

    private suspend fun redeem(url: String, code: String, deviceName: String): PairResult = try {
        val payload = transportFactory(url).post(
            PAIR_PATH,
            buildJsonObject {
                put("code", code.trim())
                put("device_name", deviceName.ifBlank { "AutiPlanner app" })
            },
        )
        readPaired(url, payload)
    } catch (error: Exception) {
        PairResult.Failed(error.message ?: "Could not reach Home Assistant.")
    }

    private fun readPaired(url: String, payload: JsonObject): PairResult {
        val token = payload["access_token"]?.jsonPrimitive?.content
        if (token.isNullOrBlank()) {
            val message = payload["error"]?.jsonObject
                ?.get("message")?.jsonPrimitive?.content
            return PairResult.Failed(message ?: "Home Assistant did not return a token.")
        }
        // `entity_id` is filled in by the integration, so the household does not
        // have to know which sensor to point at.
        val entityId = payload["entity_id"]?.jsonPrimitive?.content.orEmpty()
        return PairResult.Paired(
            RoutineSettings(
                baseUrl = url,
                token = token,
                entityId = entityId.ifBlank { "sensor.routine_agenda" },
            ),
        )
    }

    private companion object {
        const val PAIR_PATH = "/api/autiplanner/pair"
    }
}
