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
import java.time.Instant

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
        }.sortedWith(compareBy<RoutineItem> { it.date }.thenBy { it.dayPart.ordinal }.thenBy { it.uid })
    }

    suspend fun execute(command: RoutineCommand): Unit = withContext(Dispatchers.IO) {
        when (command) {
            is RoutineCommand.Complete -> callAutiPlanner("complete", command.uid, command.completedAt)
            is RoutineCommand.MarkMissed -> callAutiPlanner("mark_missed", command.uid, null)
            is RoutineCommand.Skip -> callAutiPlanner("skip", command.uid, null)
            is RoutineCommand.Reset -> callAutiPlanner("reset", command.uid, null)
            is RoutineCommand.Update -> callTodo("update_item", JSONObject().apply {
                put("item", command.uid)
                put("rename", command.title)
                put("due_date", command.date)
                putOptional("description", command.description)
            })
            is RoutineCommand.Delete -> callTodo("remove_item", JSONObject().put("item", command.uid))
        }
    }

    suspend fun create(routine: NewRoutine): Unit = withContext(Dispatchers.IO) {
        callTodo("add_item", JSONObject().apply {
            put("item", routine.title)
            put("due_date", routine.date)
            putOptional("description", routine.description)
        })
    }

    private fun callAutiPlanner(service: String, uid: String, completedAt: String?) {
        callService("autiplanner", service, JSONObject().apply {
            put("uid", uid)
            putOptional("completed_at", completedAt ?: if (service == "complete") Instant.now().toString() else null)
        })
    }

    private fun callTodo(service: String, data: JSONObject) {
        callService("todo", service, data)
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
            setRequestProperty("Authorization", "Bearer ${config.accessToken}")
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
            if (responseCode !in 200..299) throw HomeAssistantException("Home Assistant returned HTTP $responseCode")
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

private fun JSONObject.putOptional(key: String, value: String?) {
    if (value.isNullOrBlank()) remove(key) else put(key, value)
}
