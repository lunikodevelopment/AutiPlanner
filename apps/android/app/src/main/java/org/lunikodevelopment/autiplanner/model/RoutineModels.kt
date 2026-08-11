package org.lunikodevelopment.autiplanner.model

import org.json.JSONObject

enum class DayPart(val label: String) {
    MORNING("Morning"),
    AFTERNOON("Afternoon"),
    EVENING("Evening"),
    NIGHT("Night"),
}

enum class RoutineStatus(val label: String, val glyph: String) {
    PENDING("Pending", "○"),
    COMPLETED("Completed", "✓"),
    MISSED("Missed", "✕"),
    SKIPPED("Skipped", "—"),
}

data class RoutineItem(
    val uid: String,
    val title: String,
    val date: String,
    val dayPart: DayPart,
    val status: RoutineStatus,
    val description: String? = null,
    val start: String? = null,
    val due: String? = null,
    val completedAt: String? = null,
    val revision: Int? = null,
)

sealed interface RoutineCommand {
    val uid: String

    data class Complete(override val uid: String, val completedAt: String? = null) : RoutineCommand
    data class MarkMissed(override val uid: String) : RoutineCommand
    data class Skip(override val uid: String) : RoutineCommand
    data class Reset(override val uid: String) : RoutineCommand
    data class Update(
        override val uid: String,
        val title: String,
        val description: String?,
        val date: String,
    ) : RoutineCommand
    data class Delete(override val uid: String) : RoutineCommand
}

data class NewRoutine(
    val title: String,
    val description: String?,
    val date: String,
)

fun JSONObject.toRoutineItemOrNull(): RoutineItem? {
    return routineItemOrNull(
        uid = optString("uid"),
        title = optString("title"),
        date = optString("date"),
        dayPartValue = optString("day_part"),
        statusValue = optString("outcome"),
        description = optStringOrNull("description"),
        start = optStringOrNull("start"),
        due = optStringOrNull("due"),
        completedAt = optStringOrNull("completed_at"),
        revision = if (has("revision") && !isNull("revision")) optInt("revision") else null,
    )
}

fun routineItemOrNull(
    uid: String,
    title: String,
    date: String,
    dayPartValue: String,
    statusValue: String,
    description: String? = null,
    start: String? = null,
    due: String? = null,
    completedAt: String? = null,
    revision: Int? = null,
): RoutineItem? {
    val cleanUid = uid.trim()
    val cleanTitle = title.trim()
    val cleanDate = date.trim()
    val dayPart = DayPart.entries.firstOrNull { it.name.equals(dayPartValue, ignoreCase = true) }
    val status = RoutineStatus.entries.firstOrNull { it.name.equals(statusValue, ignoreCase = true) }
    if (cleanUid.isEmpty() || cleanTitle.isEmpty() || cleanDate.isEmpty() || dayPart == null || status == null) return null
    if (status == RoutineStatus.COMPLETED && completedAt == null) return null
    return RoutineItem(
        uid = cleanUid,
        title = cleanTitle,
        date = cleanDate,
        dayPart = dayPart,
        status = status,
        description = description,
        start = start,
        due = due,
        completedAt = completedAt,
        revision = revision,
    )
}

private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key) && optString(key).isNotBlank()) optString(key) else null
