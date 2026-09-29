package app.autiplanner.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The four outcomes. They are separate domain values and must never be
 * collapsed into a single `done` boolean.
 */
@Serializable
enum class RoutineStatus {
    @SerialName("pending")
    PENDING,

    @SerialName("completed")
    COMPLETED,

    @SerialName("missed")
    MISSED,

    @SerialName("skipped")
    SKIPPED,
    ;

    /** Glyph shown in the list. Never the only signal. */
    val symbol: String
        get() = when (this) {
            PENDING -> "○"
            COMPLETED -> "✓"
            MISSED -> "✕"
            SKIPPED -> "—"
        }

    /** Spoken by TalkBack. */
    val accessibleLabel: String
        get() = when (this) {
            PENDING -> "Pending"
            COMPLETED -> "Completed"
            MISSED -> "Missed"
            SKIPPED -> "Skipped"
        }

    val isComplete: Boolean get() = this == COMPLETED
}

@Serializable
enum class DayPart(val heading: String, val spoken: String) {
    @SerialName("morning")
    MORNING("MORNING", "Morning"),

    @SerialName("afternoon")
    AFTERNOON("AFTERNOON", "Afternoon"),

    @SerialName("evening")
    EVENING("EVENING", "Evening"),

    @SerialName("night")
    NIGHT("NIGHT", "Night"),
}

/**
 * One routine item as received from Home Assistant.
 *
 * `dayPart` is explicit metadata. It is never derived from [start].
 */
@Serializable
data class RoutineItem(
    val uid: String,
    val title: String,
    val date: String,
    val dayPart: DayPart,
    val status: RoutineStatus,
    val description: String? = null,
    val start: String? = null,
    val due: String? = null,
    val timezone: String? = null,
    val completedAt: String? = null,
    val order: Int? = null,
    val routineId: String? = null,
    val revision: Int? = null,
) {
    /** True for a single occurrence of a repeated series. */
    val isOccurrence: Boolean
        get() = routineId != null && uid == "$routineId:$date"

    /**
     * Local clock, or null when the item has no time.
     *
     * Mirrors `formatClock` in `@autiplanner/core`: minute precision, and the
     * zone is shown only when the timestamp actually carries one. Seconds are
     * omitted, matching the core so every client renders the same clock.
     */
    fun clock(): String? {
        val stamp = start ?: due ?: return null
        val parts = stamp.split("T")
        if (parts.size < 2) return null
        val time = parts[1]
        if (time.length < 5) return null
        val base = time.substring(0, 5)
        return when {
            // UTC stays UTC. A numeric offset is shown as written.
            stamp.endsWith("Z") -> "$base UTC"
            time.length > 8 && (time[8] == '+' || time[8] == '-') ->
                "${base} ${time.substring(8)}"
            // A floating local time has no zone of its own.
            timezone != null -> "$base $timezone"
            else -> base
        }
    }

    /** One TalkBack label for the whole row. */
    fun accessibleLabel(): String {
        val clock = clock()
        val time = if (clock != null) ", $clock" else ""
        return "${status.accessibleLabel}: $title$time"
    }
}

@Serializable
data class DayPartSection(
    val dayPart: DayPart,
    val items: List<RoutineItem>,
)

@Serializable
data class AgendaDay(
    val date: String,
    val heading: String,
    val sections: List<DayPartSection>,
)

@Serializable
data class Agenda(
    val items: List<RoutineItem> = emptyList(),
    val revision: Int? = null,
    val issues: List<String> = emptyList(),
) {
    fun days(): List<AgendaDay> = groupByDate(items)
}

private fun groupByDate(items: List<RoutineItem>): List<AgendaDay> =
    items.groupBy { it.date }
        .toSortedMap()
        .map { (date, dayItems) ->
            AgendaDay(
                date = date,
                heading = "$date",
                sections = DayPart.entries.mapNotNull { part ->
                    val sectionItems = dayItems
                        .filter { it.dayPart == part }
                        .sortedWith(compareBy({ it.order ?: Int.MAX_VALUE }, { it.title }, { it.uid }))
                    if (sectionItems.isEmpty()) {
                        null
                    } else {
                        DayPartSection(part, sectionItems)
                    }
                },
            )
        }

val OUTCOMES: List<RoutineStatus> = listOf(
    RoutineStatus.PENDING,
    RoutineStatus.COMPLETED,
    RoutineStatus.MISSED,
    RoutineStatus.SKIPPED,
)
