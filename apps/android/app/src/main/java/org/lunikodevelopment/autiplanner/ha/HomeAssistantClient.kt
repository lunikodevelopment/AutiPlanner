package org.lunikodevelopment.autiplanner.ha

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.lunikodevelopment.autiplanner.model.NewRoutine
import org.lunikodevelopment.autiplanner.model.RoutineCommand
import org.lunikodevelopment.autiplanner.model.RoutineItem
import org.lunikodevelopment.autiplanner.model.toRoutineItemOrNull
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class HomeAssistantConfig(
    val baseUrl: String,
    val accessToken: String,
    val todoEntityId: String,
)

class HomeAssistantException(message: String, cause: Throwable? = null) : IOException(message, cause)

class HomeAssistantClient(private val config: HomeAssistantConfig) {
    suspend fun getItems(): List<RoutineItem> = withContext(Dispatchers.IO) {
        val root = JSONObject(request("GET", "/api/states/${config.todoEntityId}"))
        val records = root.optJSONObject("attributes")?.optJSONArray("autiplanner_items") ?: JSONArray()
        buildList {
            for (index in 0 until records.length()) {
                records.optJSONObject(index)?.toRoutineItemOrNull()?.let(::add)
            }
        }.sortedWith(compareBy<RoutineItem> { it.date }.thenBy { it.dayPart.ordinal }.thenBy { it.priority.ordinal }.thenBy { it.uid })
    }

    suspend fun execute(command: RoutineCommand): Unit = withContext(Dispatchers.IO) {
        when (command) {
            is RoutineCommand.Complete -> callAutiPlanner("complete", command.uid, command.completedAt)
            is RoutineCommand.MarkMissed -> callAutiPlanner("mark_missed", command.uid, null)
            is RoutineCommand.Skip -> callAutiPlanner("skip", command.uid, null)
            is RoutineCommand.Reset -> callAutiPlanner("reset", command.uid, null)
            is RoutineCommand.Update -> callService("autiplanner", "update_routine", JSONObject().apply {
                put("uid", command.uid)
                put("title", command.title)
                put("date", command.date)
                put("day_part", command.dayPart.name.lowercase())
                putOptional("description", command.description)
                putOptional("icon", command.icon)
                put("priority", command.priority.name.lowercase())
            })
            is RoutineCommand.Delete -> callService("todo", "remove_item", JSONObject().put("item", command.uid))
        }
    }

    suspend fun create(routine: NewRoutine): Unit = withContext(Dispatchers.IO) {
        callService("autiplanner", "add_routine", JSONObject().apply {
            put("title", routine.title)
            put("date", routine.date)
            put("day_part", routine.dayPart.name.lowercase())
            putOptional("description", routine.description)
            putOptional("icon", routine.icon)
            put("priority", routine.priority.name.lowercase())
        })
    }

    private fun callAutiPlanner(service: String, uid: String, completedAt: String?) {
        callService("autiplanner", service, JSONObject().apply {
            put("uid", uid)
            putOptional("completed_at", completedAt)
        })
    }

    private fun callService(domain: String, service: String, data: JSONObject) {
        data.put("entity_id", config.todoEntityId)
        request("POST", "/api/services/$domain/$service", data)
    }

    private fun request(method: String, path: String, body: JSONObject? = null): String {
        val connection = (URL("${config.baseUrl.trimEnd('/')}$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Authorization", "Bearer ${normalizeAccessToken(config.accessToken)}")
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        return try {
            body?.toString()?.let { connection.outputStream.use { output -> output.write(it.toByteArray()) } }
            val responseCode = connection.responseCode
            val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (responseCode !in 200..299) {
                val detail = response.replace(Regex("\\s+"), " ").trim().take(240)
                if (responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
                    throw HomeAssistantException("Home Assistant authentication failed (HTTP 401). Re-enter a valid long-lived access token.")
                }
                throw HomeAssistantException(
                    if (detail.isEmpty()) "Home Assistant returned HTTP $responseCode"
                    else "Home Assistant returned HTTP $responseCode: $detail",
                )
            }
            response
        } catch (error: HomeAssistantException) {
            throw error
        } catch (error: Exception) {
            throw HomeAssistantException("Unable to reach Home Assistant", error)
        } finally {
            connection.disconnect()
        }
    }
}

internal fun normalizeAccessToken(value: String): String {
    val token = value.trim()
    return if (token.startsWith("Bearer ", ignoreCase = true)) token.substring(7).trim() else token
}

private fun JSONObject.putOptional(key: String, value: String?) {
    if (value.isNullOrBlank()) remove(key) else put(key, value)
}
