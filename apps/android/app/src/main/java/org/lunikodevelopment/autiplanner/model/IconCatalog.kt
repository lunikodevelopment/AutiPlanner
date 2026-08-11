package org.lunikodevelopment.autiplanner.model

import java.util.Locale

/** The common-use categories shown by the built-in icon picker. */
enum class IconCategory(val label: String) {
    ALL("All"),
    APPOINTMENTS("Appointments"),
    DAILY_TASKS("Daily tasks"),
    HEALTH_ROUTINES("Health & routines"),
    FREE_TIME("Free time"),
    HOME_ERRANDS("Home & errands"),
    TRAVEL("Travel"),
    SOCIAL("Social"),
    NATURE_WEATHER("Nature & weather"),
}

/**
 * A portable Material Design Icons token plus the friendly text used by the picker.
 *
 * The glyph is a platform-safe preview fallback. Home Assistant can render the
 * persisted mdi:* token with its Material Design Icons font, while Android keeps
 * the picker useful even when a platform font is unavailable.
 */
data class BuiltInIcon(
    val token: String,
    val label: String,
    val category: IconCategory,
    val keywords: Set<String>,
    val glyph: String,
)

val BUILT_IN_ICON_CATALOG: List<BuiltInIcon> = listOf(
    // Appointments
    BuiltInIcon("mdi:calendar", "Calendar", IconCategory.APPOINTMENTS, setOf("date", "plan"), "🗓️"),
    BuiltInIcon("mdi:calendar-check", "Calendar check", IconCategory.APPOINTMENTS, setOf("appointment", "done"), "✅"),
    BuiltInIcon("mdi:calendar-clock", "Calendar time", IconCategory.APPOINTMENTS, setOf("appointment", "schedule"), "🕘"),
    BuiltInIcon("mdi:calendar-plus", "Add to calendar", IconCategory.APPOINTMENTS, setOf("appointment", "new"), "➕"),
    BuiltInIcon("mdi:clock-outline", "Clock", IconCategory.APPOINTMENTS, setOf("time", "schedule"), "🕘"),
    BuiltInIcon("mdi:alarm", "Alarm", IconCategory.APPOINTMENTS, setOf("reminder", "wake"), "⏰"),
    BuiltInIcon("mdi:doctor", "Doctor", IconCategory.APPOINTMENTS, setOf("appointment", "medical"), "🩺"),
    BuiltInIcon("mdi:hospital-building", "Hospital", IconCategory.APPOINTMENTS, setOf("appointment", "medical"), "🏥"),
    BuiltInIcon("mdi:map-marker", "Location", IconCategory.APPOINTMENTS, setOf("place", "address"), "📍"),
    BuiltInIcon("mdi:phone", "Phone call", IconCategory.APPOINTMENTS, setOf("call", "contact"), "📞"),
    BuiltInIcon("mdi:email", "Email", IconCategory.APPOINTMENTS, setOf("mail", "contact"), "✉️"),

    // Daily tasks
    BuiltInIcon("mdi:check-circle", "Complete", IconCategory.DAILY_TASKS, setOf("done", "task"), "✅"),
    BuiltInIcon("mdi:clipboard-check", "Checklist", IconCategory.DAILY_TASKS, setOf("task", "todo"), "📋"),
    BuiltInIcon("mdi:format-list-checks", "Task list", IconCategory.DAILY_TASKS, setOf("todo", "routine"), "☑️"),
    BuiltInIcon("mdi:home", "Home", IconCategory.DAILY_TASKS, setOf("routine", "place"), "🏠"),
    BuiltInIcon("mdi:bed", "Sleep", IconCategory.DAILY_TASKS, setOf("rest", "night"), "🛏️"),
    BuiltInIcon("mdi:shower", "Shower", IconCategory.DAILY_TASKS, setOf("wash", "hygiene"), "🚿"),
    BuiltInIcon("mdi:toilet", "Toilet", IconCategory.DAILY_TASKS, setOf("bathroom", "hygiene"), "🚻"),
    BuiltInIcon("mdi:toothbrush", "Brush teeth", IconCategory.DAILY_TASKS, setOf("hygiene", "morning"), "🪥"),
    BuiltInIcon("mdi:food-apple", "Eat fruit", IconCategory.DAILY_TASKS, setOf("food", "snack", "healthy"), "🍎"),
    BuiltInIcon("mdi:food", "Meal", IconCategory.DAILY_TASKS, setOf("eat", "lunch", "dinner"), "🍽️"),
    BuiltInIcon("mdi:water", "Drink water", IconCategory.DAILY_TASKS, setOf("drink", "health"), "💧"),
    BuiltInIcon("mdi:pill", "Medicine", IconCategory.HEALTH_ROUTINES, setOf("medication", "health"), "💊"),
    BuiltInIcon("mdi:walk", "Walk", IconCategory.HEALTH_ROUTINES, setOf("exercise", "outside"), "🚶"),
    BuiltInIcon("mdi:run", "Run", IconCategory.HEALTH_ROUTINES, setOf("exercise", "sport"), "🏃"),
    BuiltInIcon("mdi:meditation", "Meditate", IconCategory.HEALTH_ROUTINES, setOf("calm", "mindfulness"), "🧘"),
    BuiltInIcon("mdi:heart-pulse", "Health", IconCategory.HEALTH_ROUTINES, setOf("wellbeing", "medical"), "💗"),

    // Free time
    BuiltInIcon("mdi:gamepad-variant", "Gaming", IconCategory.FREE_TIME, setOf("play", "hobby"), "🎮"),
    BuiltInIcon("mdi:book-open-page-variant", "Read", IconCategory.FREE_TIME, setOf("book", "hobby"), "📖"),
    BuiltInIcon("mdi:movie-open", "Movie", IconCategory.FREE_TIME, setOf("film", "watch"), "🎬"),
    BuiltInIcon("mdi:music", "Music", IconCategory.FREE_TIME, setOf("listen", "hobby"), "🎵"),
    BuiltInIcon("mdi:palette", "Art", IconCategory.FREE_TIME, setOf("draw", "paint", "hobby"), "🎨"),
    BuiltInIcon("mdi:camera", "Photography", IconCategory.FREE_TIME, setOf("photo", "hobby"), "📷"),
    BuiltInIcon("mdi:coffee", "Coffee", IconCategory.FREE_TIME, setOf("drink", "break"), "☕"),
    BuiltInIcon("mdi:flower", "Gardening", IconCategory.FREE_TIME, setOf("plant", "hobby"), "🌸"),
    BuiltInIcon("mdi:dog", "Dog", IconCategory.FREE_TIME, setOf("pet", "walk"), "🐶"),
    BuiltInIcon("mdi:cat", "Cat", IconCategory.FREE_TIME, setOf("pet"), "🐱"),
    BuiltInIcon("mdi:television", "Television", IconCategory.FREE_TIME, setOf("watch", "relax"), "📺"),
    BuiltInIcon("mdi:puzzle", "Puzzle", IconCategory.FREE_TIME, setOf("game", "hobby"), "🧩"),

    // Home and errands
    BuiltInIcon("mdi:broom", "Clean", IconCategory.HOME_ERRANDS, setOf("chore", "tidy"), "🧹"),
    BuiltInIcon("mdi:washing-machine", "Laundry", IconCategory.HOME_ERRANDS, setOf("chore", "clothes"), "🧺"),
    BuiltInIcon("mdi:vacuum", "Vacuum", IconCategory.HOME_ERRANDS, setOf("clean", "chore"), "🧹"),
    BuiltInIcon("mdi:trash-can", "Take out trash", IconCategory.HOME_ERRANDS, setOf("chore", "bin"), "🗑️"),
    BuiltInIcon("mdi:cart", "Shopping", IconCategory.HOME_ERRANDS, setOf("groceries", "errand"), "🛒"),
    BuiltInIcon("mdi:shopping", "Shopping bag", IconCategory.HOME_ERRANDS, setOf("store", "errand"), "🛍️"),
    BuiltInIcon("mdi:lightbulb", "Light", IconCategory.HOME_ERRANDS, setOf("home", "remember"), "💡"),
    BuiltInIcon("mdi:lock", "Lock", IconCategory.HOME_ERRANDS, setOf("door", "safety"), "🔒"),
    BuiltInIcon("mdi:key", "Key", IconCategory.HOME_ERRANDS, setOf("door", "leave"), "🔑"),
    BuiltInIcon("mdi:tools", "Repair", IconCategory.HOME_ERRANDS, setOf("fix", "chore"), "🛠️"),

    // Travel
    BuiltInIcon("mdi:car", "Car", IconCategory.TRAVEL, setOf("drive", "transport"), "🚗"),
    BuiltInIcon("mdi:bus", "Bus", IconCategory.TRAVEL, setOf("transport", "commute"), "🚌"),
    BuiltInIcon("mdi:train", "Train", IconCategory.TRAVEL, setOf("transport", "commute"), "🚆"),
    BuiltInIcon("mdi:airplane", "Airplane", IconCategory.TRAVEL, setOf("flight", "holiday"), "✈️"),
    BuiltInIcon("mdi:bicycle", "Bicycle", IconCategory.TRAVEL, setOf("cycle", "exercise"), "🚲"),
    BuiltInIcon("mdi:map", "Map", IconCategory.TRAVEL, setOf("route", "directions"), "🗺️"),
    BuiltInIcon("mdi:gas-station", "Fuel", IconCategory.TRAVEL, setOf("car", "errand"), "⛽"),
    BuiltInIcon("mdi:briefcase", "Work", IconCategory.TRAVEL, setOf("job", "office"), "💼"),

    // Social and communication
    BuiltInIcon("mdi:message", "Message", IconCategory.SOCIAL, setOf("chat", "contact"), "💬"),
    BuiltInIcon("mdi:chat", "Chat", IconCategory.SOCIAL, setOf("talk", "contact"), "🗨️"),
    BuiltInIcon("mdi:account", "Person", IconCategory.SOCIAL, setOf("people", "contact"), "👤"),
    BuiltInIcon("mdi:account-group", "Group", IconCategory.SOCIAL, setOf("people", "family"), "👥"),
    BuiltInIcon("mdi:heart", "Favourite", IconCategory.SOCIAL, setOf("love", "care"), "♥"),
    BuiltInIcon("mdi:gift", "Gift", IconCategory.SOCIAL, setOf("birthday", "present"), "🎁"),
    BuiltInIcon("mdi:party-popper", "Party", IconCategory.SOCIAL, setOf("celebrate", "event"), "🎉"),
    BuiltInIcon("mdi:human-greeting", "Greet", IconCategory.SOCIAL, setOf("hello", "people"), "👋"),

    // Nature and weather
    BuiltInIcon("mdi:white-balance-sunny", "Sunny", IconCategory.NATURE_WEATHER, setOf("weather", "day"), "☀️"),
    BuiltInIcon("mdi:weather-night", "Night", IconCategory.NATURE_WEATHER, setOf("weather", "sleep"), "🌙"),
    BuiltInIcon("mdi:weather-rainy", "Rain", IconCategory.NATURE_WEATHER, setOf("weather", "outside"), "🌧️"),
    BuiltInIcon("mdi:weather-cloudy", "Cloudy", IconCategory.NATURE_WEATHER, setOf("weather"), "☁️"),
    BuiltInIcon("mdi:snowflake", "Snow", IconCategory.NATURE_WEATHER, setOf("weather", "winter"), "❄️"),
    BuiltInIcon("mdi:leaf", "Nature", IconCategory.NATURE_WEATHER, setOf("plant", "outside"), "🍃"),
    BuiltInIcon("mdi:weather-sunset", "Sunset", IconCategory.NATURE_WEATHER, setOf("evening", "weather"), "🌇"),
)

private val MDI_FONT_CODEPOINTS = mapOf(
    "mdi:calendar" to 0xF00ED, "mdi:calendar-check" to 0xF00EF, "mdi:calendar-clock" to 0xF00F0, "mdi:calendar-plus" to 0xF00F3,
    "mdi:clock-outline" to 0xF0150, "mdi:alarm" to 0xF0020, "mdi:doctor" to 0xF0A42, "mdi:hospital-building" to 0xF02E1,
    "mdi:map-marker" to 0xF034E, "mdi:phone" to 0xF03F2, "mdi:email" to 0xF01EE, "mdi:check-circle" to 0xF05E0,
    "mdi:clipboard-check" to 0xF014E, "mdi:format-list-checks" to 0xF0756, "mdi:home" to 0xF02DC, "mdi:bed" to 0xF02E3,
    "mdi:shower" to 0xF09A0, "mdi:toilet" to 0xF09AB, "mdi:toothbrush" to 0xF1129, "mdi:food-apple" to 0xF025B,
    "mdi:food" to 0xF025A, "mdi:water" to 0xF058C, "mdi:pill" to 0xF0402, "mdi:walk" to 0xF0583, "mdi:run" to 0xF070E,
    "mdi:meditation" to 0xF117B, "mdi:heart-pulse" to 0xF05F6, "mdi:gamepad-variant" to 0xF0297, "mdi:book-open-page-variant" to 0xF05DA,
    "mdi:movie-open" to 0xF0FCE, "mdi:music" to 0xF075A, "mdi:palette" to 0xF03D8, "mdi:camera" to 0xF0100,
    "mdi:coffee" to 0xF0176, "mdi:flower" to 0xF024A, "mdi:dog" to 0xF0A43, "mdi:cat" to 0xF011B,
    "mdi:television" to 0xF0502, "mdi:puzzle" to 0xF0431, "mdi:broom" to 0xF00E2, "mdi:washing-machine" to 0xF072A,
    "mdi:vacuum" to 0xF19A1, "mdi:trash-can" to 0xF0A79, "mdi:cart" to 0xF0110, "mdi:shopping" to 0xF049A,
    "mdi:lightbulb" to 0xF0335, "mdi:lock" to 0xF033E, "mdi:key" to 0xF0306, "mdi:tools" to 0xF1064,
    "mdi:car" to 0xF010B, "mdi:bus" to 0xF00E7, "mdi:train" to 0xF052C, "mdi:airplane" to 0xF001D,
    "mdi:bicycle" to 0xF109C, "mdi:map" to 0xF034D, "mdi:gas-station" to 0xF0298, "mdi:briefcase" to 0xF00D6,
    "mdi:message" to 0xF0361, "mdi:chat" to 0xF0B79, "mdi:account" to 0xF0004, "mdi:account-group" to 0xF0849,
    "mdi:heart" to 0xF02D1, "mdi:gift" to 0xF0E44, "mdi:party-popper" to 0xF1056, "mdi:human-greeting" to 0xF17C4,
    "mdi:white-balance-sunny" to 0xF05A8, "mdi:weather-night" to 0xF0594, "mdi:weather-rainy" to 0xF0597, "mdi:weather-cloudy" to 0xF0590,
    "mdi:snowflake" to 0xF0717, "mdi:leaf" to 0xF032A, "mdi:weather-sunset" to 0xF059A,
)

fun builtInIcon(token: String?): BuiltInIcon? {
    val normalized = token?.trim()?.lowercase(Locale.ROOT).orEmpty()
    return BUILT_IN_ICON_CATALOG.firstOrNull { it.token == normalized }
}

fun builtInIconFontGlyph(token: String?): String? {
    val codepoint = MDI_FONT_CODEPOINTS[token?.trim()?.lowercase(Locale.ROOT)] ?: return null
    return String(Character.toChars(codepoint))
}

fun searchBuiltInIcons(query: String, category: IconCategory): List<BuiltInIcon> {
    val normalizedQuery = query.trim().lowercase(Locale.ROOT)
    return BUILT_IN_ICON_CATALOG.filter { icon ->
        val matchesCategory = category == IconCategory.ALL || icon.category == category
        val matchesQuery = normalizedQuery.isBlank() || listOf(icon.token, icon.label)
            .plus(icon.keywords)
            .any { it.lowercase(Locale.ROOT).contains(normalizedQuery) }
        matchesCategory && matchesQuery
    }
}
