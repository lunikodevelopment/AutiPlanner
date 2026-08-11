package org.lunikodevelopment.autiplanner.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.lunikodevelopment.autiplanner.model.RoutineItem
import org.lunikodevelopment.autiplanner.model.toRoutineItemOrNull
import java.io.File

class RoutineCache(context: Context) {
    private val cacheFile = File(context.filesDir, "autiplanner-routines.json")

    suspend fun read(): List<RoutineItem> = withContext(Dispatchers.IO) {
        if (!cacheFile.exists()) return@withContext emptyList()
        runCatching {
            val array = JSONArray(cacheFile.readText())
            buildList {
                for (index in 0 until array.length()) {
                    array.optJSONObject(index)?.toRoutineItemOrNull()?.let(::add)
                }
            }
        }.getOrDefault(emptyList())
    }

    suspend fun write(items: List<RoutineItem>) = withContext(Dispatchers.IO) {
        val temporary = File(cacheFile.parentFile, "${cacheFile.name}.tmp")
        temporary.writeText(JSONArray(items.map(::toJson)).toString())
        if (!temporary.renameTo(cacheFile)) {
            temporary.delete()
            error("Unable to replace local routine cache")
        }
    }

    private fun toJson(item: RoutineItem): JSONObject = JSONObject().apply {
        put("uid", item.uid)
        put("title", item.title)
        put("date", item.date)
        put("day_part", item.dayPart.name)
        put("outcome", item.status.name)
        putOptional("description", item.description)
        putOptional("icon", item.icon)
        put("priority", item.priority.name)
        putOptional("start", item.start)
        putOptional("due", item.due)
        putOptional("completed_at", item.completedAt)
        item.revision?.let { put("revision", it) }
    }
}

private fun JSONObject.putOptional(key: String, value: String?) {
    if (value.isNullOrBlank()) remove(key) else put(key, value)
}
