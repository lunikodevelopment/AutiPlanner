package app.autiplanner.data

import app.autiplanner.core.Agenda
import app.autiplanner.core.RoutineItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * The result of a command.
 *
 * A command does not report success as a bare boolean. It returns the confirmed
 * item so the UI can render the outcome Home Assistant actually stored, and it
 * reports a conflict so the UI can roll back instead of lying to the user.
 */
sealed interface CommandResult {
    data class Applied(val item: RoutineItem) : CommandResult

    data class Conflict(
        val uid: String,
        val message: String,
        val serverItem: RoutineItem?,
    ) : CommandResult

    data class Rejected(val message: String) : CommandResult
}

sealed interface SyncResult {
    data class Success(val agenda: Agenda) : SyncResult

    data class Failure(val message: String) : SyncResult
}

/** Narrow transport seam so the client can be tested without a server. */
interface RoutineTransport {
    suspend fun post(path: String, body: JsonObject): JsonObject
}

class HomeAssistantHttpTransport(
    private val baseUrl: String,
    private val tokenProvider: suspend () -> String,
    private val client: OkHttpClient = defaultClient(),
) : RoutineTransport {
    private val json = "application/json".toMediaType()

    override suspend fun post(path: String, body: JsonObject): JsonObject {
        val token = tokenProvider()
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .post(body.toString().toRequestBody(json))
        if (token.isNotBlank()) {
            // Pairing runs before there is a token, so the header is optional.
            builder.addHeader("Authorization", "Bearer $token")
        }
        val response = try {
            client.newCall(builder.build()).execute()
        } catch (error: IOException) {
            // OkHttp's own text ("failed to connect to /10.0.0.1 (port 8123) ...")
            // does not say which part of the address is wrong, and a typo in the
            // host is the most common cause of a failure to reach Home Assistant.
            throw IOException(reachFailureMessage(error), error)
        }
        return response.use { result ->
            val payload = result.body?.string().orEmpty()
            if (!result.isSuccessful) {
                throw IOException(readErrorMessage(payload, result.code))
            }
            Json.parseToJsonElement(payload).jsonObject
        }
    }

    /** The host and port as entered, for an error a household can act on. */
    private fun target(): String {
        val uri = runCatching { java.net.URI(baseUrl.trim()) }.getOrNull() ?: return baseUrl
        val host = uri.host ?: return baseUrl
        val port = if (uri.port > 0) ":${uri.port}" else ""
        return "$host$port"
    }

    private fun reachFailureMessage(error: IOException): String {
        val where = target()
        return when (error) {
            is java.net.SocketTimeoutException ->
                "Timed out reaching $where. Check the address for typos, and that this " +
                    "device is on the same network as Home Assistant."
            is java.net.UnknownHostException ->
                "Could not look up $where. Check the address for typos."
            is java.net.ConnectException ->
                "Nothing answered at $where. Check that Home Assistant is running and " +
                    "reachable from this network."
            is javax.net.ssl.SSLException ->
                "The secure connection to $where failed. If Home Assistant is on plain " +
                    "http, use http:// instead of https://."
            else ->
                "Could not reach ${target()}: ${error.message ?: error::class.java.simpleName}"
        }
    }

    companion object {
        /** Short connect timeout so a wrong address fails instead of hanging. */
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    }
}

private fun readErrorMessage(payload: String, status: Int): String {
    val message = runCatching {
        Json.parseToJsonElement(payload).jsonObject["error"]?.jsonObject
            ?.get("message")?.jsonPrimitive?.content
    }.getOrNull()
    return message?.takeIf { it.isNotBlank() } ?: "Home Assistant returned $status"
}

/**
 * AutiPlanner client.
 *
 * The app never writes the ICS file. Every change is a Home Assistant command,
 * which keeps one writer for the calendar and lets the dashboard see the change.
 */
class HomeAssistantRoutineClient(
    private val transport: RoutineTransport,
    private val entityId: String,
    private val windowDays: Int = 14,
) {

    suspend fun agenda(fromDate: String? = null): SyncResult = try {
        val payload = transport.post(
            "/api/autiplanner/agenda",
            buildJsonObject {
                put("entity_id", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(entityId))))
                put("limit", windowDays)
                if (fromDate != null) put("from", fromDate)
            },
        )
        SyncResult.Success(payload.toAgenda())
    } catch (error: Exception) {
        SyncResult.Failure(error.message ?: "could not load the routine calendar")
    }

    suspend fun complete(uid: String, revision: Int?, completedAt: String? = null): CommandResult =
        command("complete", uid, revision, completedAt)

    suspend fun markMissed(uid: String, revision: Int?): CommandResult =
        command("mark_missed", uid, revision)

    suspend fun skip(uid: String, revision: Int?): CommandResult =
        command("skip", uid, revision)

    suspend fun reset(uid: String, revision: Int?): CommandResult =
        command("reset", uid, revision)

    suspend fun create(item: RoutineItem): CommandResult {
        val payload = transport.post(
            "/api/autiplanner/command",
            buildJsonObject {
                put("command", "create")
                put("entity_id", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(entityId))))
                put("item", Json.encodeToJsonElement(RoutineItem.serializer(), item))
            },
        )
        return payload.toCommandResult()
    }

    suspend fun update(uid: String, patch: JsonObject, revision: Int?): CommandResult {
        val payload = transport.post(
            "/api/autiplanner/command",
            buildJsonObject {
                put("command", "update")
                put("entity_id", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(entityId))))
                put("uid", uid)
                put("patch", patch)
                if (revision != null) put("expected_revision", revision)
            },
        )
        return payload.toCommandResult()
    }

    suspend fun delete(uid: String, revision: Int?): CommandResult {
        val payload = transport.post(
            "/api/autiplanner/command",
            buildJsonObject {
                put("command", "delete")
                put("entity_id", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(entityId))))
                put("uid", uid)
                if (revision != null) put("expected_revision", revision)
            },
        )
        return payload.toCommandResult()
    }

    private suspend fun command(
        name: String,
        uid: String,
        revision: Int?,
        completedAt: String? = null,
    ): CommandResult {
        val payload = transport.post(
            "/api/autiplanner/command",
            buildJsonObject {
                put("command", name)
                put("entity_id", kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(entityId))))
                put("uid", uid)
                if (revision != null) put("expected_revision", revision)
                if (completedAt != null) put("completed_at", completedAt)
            },
        )
        return payload.toCommandResult()
    }

    private fun JsonObject.toCommandResult(): CommandResult {
        if (this["success"] == JsonPrimitive(false)) {
            val error = this["error"]?.jsonObject
            val code = error?.get("code")?.jsonPrimitive?.content.orEmpty()
            val message = error?.get("message")?.jsonPrimitive?.content ?: "command failed"
            val failedUid = this["uid"]?.jsonPrimitive?.content.orEmpty()
            return if (code.contains("conflict")) {
                CommandResult.Conflict(failedUid, message, null)
            } else {
                CommandResult.Rejected(message)
            }
        }
        val item = this["item"]?.let { Json.decodeFromJsonElement(RoutineItem.serializer(), it) }
        return if (item != null) {
            // The caller updates its own list from this item. A partial agenda
            // is not broadcast: that would replace the whole list with one row.
            CommandResult.Applied(item)
        } else {
            CommandResult.Rejected("Home Assistant did not return the updated item")
        }
    }

    private fun JsonObject.toAgenda(): Agenda {
        val rows = this["items"]?.let { element ->
            Json.decodeFromJsonElement(ListSerializer(RoutineItem.serializer()), element)
        } ?: emptyList()
        val problems = (this["issues"] as? JsonArray)?.map { entry ->
            entry.jsonPrimitive.content
        } ?: emptyList()
        return Agenda(
            items = rows,
            revision = this["revision"]?.jsonPrimitive?.content?.toIntOrNull(),
            issues = problems,
        )
    }

    companion object {
        val Json = kotlinx.serialization.json.Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }
    }
}

/** ISO-8601 UTC timestamp with `Z`, which is what a completion requires. */
fun completionTimestamp(): String = java.time.Instant.now().toString()
