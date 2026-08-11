package org.lunikodevelopment.autiplanner

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.lunikodevelopment.autiplanner.R as AppR
import org.lunikodevelopment.autiplanner.data.RoutineRepository
import org.lunikodevelopment.autiplanner.ha.HomeAssistantClient
import org.lunikodevelopment.autiplanner.ha.HomeAssistantConfig
import org.lunikodevelopment.autiplanner.model.DayPart
import org.lunikodevelopment.autiplanner.model.IconCategory
import org.lunikodevelopment.autiplanner.model.NewRoutine
import org.lunikodevelopment.autiplanner.model.RoutineCommand
import org.lunikodevelopment.autiplanner.model.RoutineItem
import org.lunikodevelopment.autiplanner.model.RoutinePriority
import org.lunikodevelopment.autiplanner.model.RoutineStatus
import org.lunikodevelopment.autiplanner.model.builtInIcon
import org.lunikodevelopment.autiplanner.model.builtInIconFontGlyph
import org.lunikodevelopment.autiplanner.model.searchBuiltInIcons
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.WeekFields
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AutiPlannerApp(this) }
    }
}

private data class SavedSettings(val baseUrl: String, val token: String, val entityId: String)

private val AUTIPLANNER_ICON_FONT = FontFamily(Font(AppR.font.autiplanner_mdi))

@Composable
private fun AutiPlannerApp(context: Context) {
    val preferences = remember { context.getSharedPreferences("autiplanner", Context.MODE_PRIVATE) }
    var settings by remember { mutableStateOf(readSettings(preferences)) }
    val systemDark = isSystemInDarkTheme()
    var darkMode by remember { mutableStateOf(preferences.getBoolean("dark_mode", systemDark)) }
    val colors = if (darkMode) {
        androidx.compose.material3.darkColorScheme(primary = Color(0xFF9BC8AA), onPrimary = Color(0xFF17231B))
    } else {
        androidx.compose.material3.lightColorScheme(primary = Color(0xFF3F6957))
    }
    MaterialTheme(colorScheme = colors) {
        if (settings == null) {
            SetupScreen(onSave = { next ->
                preferences.edit()
                    .putString("base_url", next.baseUrl)
                    .putString("token", next.token)
                    .putString("entity_id", next.entityId)
                    .apply()
                settings = next
            })
        } else {
            val current = settings!!
            PlannerScreen(
                repository = remember(current) {
                    RoutineRepository(context, HomeAssistantClient(HomeAssistantConfig(current.baseUrl, current.token, current.entityId)))
                },
                darkMode = darkMode,
                onDarkModeChange = {
                    darkMode = it
                    preferences.edit().putBoolean("dark_mode", it).apply()
                },
                onChangeConnection = {
                    preferences.edit().clear().apply()
                    settings = null
                },
            )
        }
    }
}

@Composable
private fun SetupScreen(onSave: (SavedSettings) -> Unit) {
    var baseUrl by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf("") }
    var entityId by rememberSaveable { mutableStateOf("todo.autiplanner") }
    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Connect AutiPlanner", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text("Use the Home Assistant URL, a long-lived access token, and the AutiPlanner to-do entity.")
            Spacer(Modifier.height(20.dp))
            OutlinedTextField(baseUrl, { baseUrl = it }, Modifier.fillMaxWidth(), label = { Text("Home Assistant URL") }, singleLine = true)
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(token, { token = it }, Modifier.fillMaxWidth(), label = { Text("Long-lived access token") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(entityId, { entityId = it }, Modifier.fillMaxWidth(), label = { Text("To-do entity ID") }, singleLine = true)
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = { onSave(SavedSettings(baseUrl.trim(), token.trim(), entityId.trim())) },
                enabled = baseUrl.isNotBlank() && token.isNotBlank() && entityId.isNotBlank(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text("Connect") }
        }
    }
}

@Composable
private fun PlannerScreen(
    repository: RoutineRepository,
    darkMode: Boolean,
    onDarkModeChange: (Boolean) -> Unit,
    onChangeConnection: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var monthValue by rememberSaveable { mutableStateOf(YearMonth.now().toString()) }
    var selectedDate by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var items by remember { mutableStateOf<List<RoutineItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedItem by remember { mutableStateOf<RoutineItem?>(null) }
    var editorOpen by remember { mutableStateOf(false) }
    var editorItem by remember { mutableStateOf<RoutineItem?>(null) }
    var busyUid by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        scope.launch {
            loading = true
            items = repository.cachedItems()
            runCatching { repository.refresh() }
                .onSuccess { next -> items = next; error = null }
                .onFailure { error = it.message ?: "Unable to load routines" }
            loading = false
        }
    }

    fun selectMonth(next: YearMonth) {
        monthValue = next.toString()
        val currentDay = runCatching { LocalDate.parse(selectedDate).dayOfMonth }.getOrDefault(1)
        selectedDate = next.atDay(currentDay.coerceAtMost(next.lengthOfMonth())).toString()
    }

    fun runCommand(command: RoutineCommand, closeDetails: Boolean = false) {
        busyUid = command.uid
        scope.launch {
            runCatching { repository.execute(command) }
                .onSuccess { next ->
                    items = next
                    selectedItem = if (closeDetails) null else next.firstOrNull { it.uid == command.uid }
                    error = null
                }
                .onFailure { error = it.message ?: "Home Assistant could not save this change" }
                .also { busyUid = null }
        }
    }

    LaunchedEffect(repository) {
        refresh()
        while (true) {
            delay(15_000)
            runCatching { repository.refresh() }.onSuccess { next -> items = next; error = null }
        }
    }

    val month = runCatching { YearMonth.parse(monthValue) }.getOrDefault(YearMonth.now())
    val dayItems = items.filter { it.date == selectedDate }.sortedBy { priorityRank(it.priority) }
    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("AutiPlanner", style = MaterialTheme.typography.titleLarge)
                    Text("${items.size} ${if (items.size == 1) "routine" else "routines"}")
                }
                Text("Dark", modifier = Modifier.padding(end = 6.dp))
                Switch(checked = darkMode, onCheckedChange = onDarkModeChange, modifier = Modifier.semantics { contentDescription = "Toggle dark mode" })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { selectMonth(month.minusMonths(1)) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Previous") }
                Button(onClick = { selectMonth(YearMonth.now()) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Today") }
                OutlinedButton(onClick = { selectMonth(month.plusMonths(1)) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Next") }
            }
            Spacer(Modifier.height(8.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    MonthCalendar(
                        month = month,
                        selectedDate = selectedDate,
                        items = items,
                        onSelectDate = { selectedDate = it },
                    )
                }
                item { PriorityLegend() }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { editorItem = null; editorOpen = true }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Add routine") }
                        OutlinedButton(onClick = onChangeConnection, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Connection") }
                    }
                }
                item {
                    Text(formatDate(selectedDate), style = MaterialTheme.typography.titleLarge)
                    Text("${dayItems.size} ${if (dayItems.size == 1) "routine" else "routines"}")
                    if (loading && items.isEmpty()) Text("Loading routines…", modifier = Modifier.padding(vertical = 12.dp))
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) }
                }
                DayPart.entries.forEach { dayPart ->
                    val group = dayItems.filter { it.dayPart == dayPart }
                    item {
                        Text(dayPart.label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
                        if (group.isEmpty()) {
                            Text("No routines", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
                        }
                    }
                    items(group, key = { it.uid }) { item ->
                        RoutineRow(item, busy = busyUid == item.uid, onSelect = { selectedItem = item }, onComplete = { runCommand(RoutineCommand.Complete(item.uid)) })
                    }
                }
            }
        }
    }

    selectedItem?.let { item ->
        RoutineDetailDialog(
            item = item,
            busy = busyUid == item.uid,
            onDismiss = { selectedItem = null },
            onCommand = { command -> runCommand(command) },
            onEdit = { editorItem = item; selectedItem = null; editorOpen = true },
            onDelete = { runCommand(RoutineCommand.Delete(item.uid), closeDetails = true) },
        )
    }
    if (editorOpen) {
        RoutineEditorDialog(
            existing = editorItem,
            date = selectedDate,
            onDismiss = { editorOpen = false },
            onSave = { title, description, editedDate, dayPart, icon, priority ->
                editorOpen = false
                scope.launch {
                    runCatching {
                        editorItem?.let { existing ->
                            repository.execute(RoutineCommand.Update(existing.uid, title, description, editedDate, dayPart, icon, priority))
                        } ?: repository.create(NewRoutine(title, description, editedDate, dayPart, icon, priority))
                    }.onSuccess { next -> items = next; selectedDate = editedDate; monthValue = editedDate.substring(0, 7); error = null }
                        .onFailure { error = it.message ?: "Home Assistant could not save this routine" }
                }
            },
        )
    }
}

@Composable
private fun MonthCalendar(month: YearMonth, selectedDate: String, items: List<RoutineItem>, onSelectDate: (String) -> Unit) {
    val weeks = remember(month) { monthWeeks(month) }
    val itemsByDate = remember(items) { items.groupBy { it.date } }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant), shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.fillMaxWidth().padding(8.dp)) {
            Text(month.format(DateTimeFormatter.ofPattern("LLLL yyyy", Locale.getDefault())), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Wk", modifier = Modifier.width(34.dp), style = MaterialTheme.typography.labelSmall)
                listOf("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su").forEach { day -> Text(day, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall) }
            }
            weeks.forEach { week ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(isoWeek(week.first()).toString(), modifier = Modifier.width(34.dp).heightIn(min = 58.dp).padding(top = 8.dp), style = MaterialTheme.typography.labelSmall)
                    week.forEach { day ->
                        val dayItems = itemsByDate[day.toString()].orEmpty()
                        val priority = dayItems.minByOrNull { priorityRank(it.priority) }?.priority
                        val selected = day.toString() == selectedDate
                        OutlinedButton(
                            onClick = { onSelectDate(day.toString()) },
                            contentPadding = PaddingValues(4.dp),
                            modifier = Modifier.weight(1f).heightIn(min = 58.dp),
                            shape = RoundedCornerShape(8.dp),
                            colors = if (selected) androidx.compose.material3.ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer) else androidx.compose.material3.ButtonDefaults.outlinedButtonColors(),
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(day.dayOfMonth.toString(), style = MaterialTheme.typography.labelLarge)
                                if (dayItems.isNotEmpty()) Text(dayItems.size.toString(), style = MaterialTheme.typography.labelSmall)
                                priority?.let { Text("●", color = priorityDotColor(it), style = MaterialTheme.typography.labelSmall) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RoutineRow(item: RoutineItem, busy: Boolean, onSelect: () -> Unit, onComplete: () -> Unit) {
    Card(onClick = onSelect, colors = CardDefaults.cardColors(containerColor = priorityContainer(item.priority)), modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Open details for ${item.title}" }) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(item.status.glyph, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { contentDescription = item.status.label })
            if (item.icon != null) Text(builtInIconFontGlyph(item.icon) ?: iconGlyph(item.icon), fontFamily = if (builtInIconFontGlyph(item.icon) != null) AUTIPLANNER_ICON_FONT else null, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { contentDescription = "Icon ${item.icon}" })
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.titleMedium)
                Text("${item.priority.label} · ${item.status.label}${formatTime(item)?.let { " · $it" } ?: ""}")
            }
            if (item.status == RoutineStatus.PENDING) Button(onClick = onComplete, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (busy) "Saving…" else "Complete") }
        }
    }
}

@Composable
private fun RoutineDetailDialog(item: RoutineItem, busy: Boolean, onDismiss: () -> Unit, onCommand: (RoutineCommand) -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${item.status.glyph}${item.icon?.let { " ${iconGlyph(it)}" } ?: ""} ${item.title}") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("${item.priority.label} · ${item.status.label} · ${item.dayPart.label}"); item.description?.let { Text(it) }; item.icon?.let { Text("Icon: $it") }; Text(formatTime(item) ?: "Any time"); Text("UID ${item.uid}") } },
        confirmButton = { Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (item.status == RoutineStatus.PENDING) TextButton(onClick = { onCommand(RoutineCommand.Complete(item.uid)) }, enabled = !busy) { Text("Complete") }
            if (item.status != RoutineStatus.MISSED) TextButton(onClick = { onCommand(RoutineCommand.MarkMissed(item.uid)) }, enabled = !busy) { Text("Missed") }
            if (item.status != RoutineStatus.SKIPPED) TextButton(onClick = { onCommand(RoutineCommand.Skip(item.uid)) }, enabled = !busy) { Text("Skip") }
            if (item.status != RoutineStatus.PENDING) TextButton(onClick = { onCommand(RoutineCommand.Reset(item.uid)) }, enabled = !busy) { Text("Reset") }
        } },
        dismissButton = { Row { TextButton(onClick = onEdit, enabled = !busy) { Text("Edit") }; TextButton(onClick = onDelete, enabled = !busy) { Text("Delete") }; TextButton(onClick = onDismiss) { Text("Close") } } },
    )
}

@Composable
private fun RoutineEditorDialog(existing: RoutineItem?, date: String, onDismiss: () -> Unit, onSave: (String, String?, String, DayPart, String?, RoutinePriority) -> Unit) {
    var title by rememberSaveable(existing?.uid) { mutableStateOf(existing?.title.orEmpty()) }
    var description by rememberSaveable(existing?.uid) { mutableStateOf(existing?.description.orEmpty()) }
    var editedDate by rememberSaveable(existing?.uid) { mutableStateOf(existing?.date ?: date) }
    var dayPart by rememberSaveable(existing?.uid) { mutableStateOf(existing?.dayPart ?: DayPart.MORNING) }
    var icon by rememberSaveable(existing?.uid) { mutableStateOf(existing?.icon.orEmpty()) }
    var priority by rememberSaveable(existing?.uid) { mutableStateOf(existing?.priority ?: RoutinePriority.PREFERABLY) }
    var menuOpen by remember { mutableStateOf(false) }
    var priorityMenuOpen by remember { mutableStateOf(false) }
    var iconPickerOpen by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(if (existing == null) "Add routine" else "Edit routine") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(title, { title = it }, label = { Text("Title") }, singleLine = true)
        OutlinedTextField(description, { description = it }, label = { Text("Description") })
        OutlinedTextField(editedDate, { editedDate = it }, label = { Text("Date (YYYY-MM-DD)") }, singleLine = true)
        Box {
            OutlinedButton(onClick = { menuOpen = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Day part: ${dayPart.label}") }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DayPart.entries.forEach { option -> DropdownMenuItem(text = { Text(option.label) }, onClick = { dayPart = option; menuOpen = false }) }
            }
        }
        Box {
            OutlinedButton(onClick = { priorityMenuOpen = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Priority: ${priority.label}") }
            DropdownMenu(expanded = priorityMenuOpen, onDismissRequest = { priorityMenuOpen = false }) {
                RoutinePriority.entries.forEach { option -> DropdownMenuItem(text = { Text(option.label) }, onClick = { priority = option; priorityMenuOpen = false }) }
            }
        }
        IconPickerField(icon = icon, onChoose = { iconPickerOpen = true }, onClear = { icon = "" })
    } }, confirmButton = { Button(onClick = { onSave(title.trim(), description.trim().ifBlank { null }, editedDate.trim(), dayPart, icon.trim().ifBlank { null }, priority) }, enabled = title.isNotBlank() && editedDate.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) { Text("Save") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })

    if (iconPickerOpen) {
        IconPickerDialog(
            selectedToken = icon,
            onSelect = { selected -> icon = selected; iconPickerOpen = false },
            onDismiss = { iconPickerOpen = false },
            onClear = { icon = ""; iconPickerOpen = false },
        )
    }
}

@Composable
private fun IconPickerField(icon: String, onChoose: () -> Unit, onClear: () -> Unit) {
    val selected = builtInIcon(icon)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(
            onClick = onChoose,
            modifier = Modifier.weight(1f).heightIn(min = 58.dp),
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
        ) {
            Text(if (icon.isBlank()) "＋" else builtInIconFontGlyph(icon) ?: iconGlyph(icon), fontFamily = if (builtInIconFontGlyph(icon) != null) AUTIPLANNER_ICON_FONT else null, fontSize = 24.sp)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                Text("Icon", style = MaterialTheme.typography.labelSmall)
                Text(
                    when {
                        selected != null -> selected.label
                        icon.isBlank() -> "Choose an icon"
                        else -> "Custom icon"
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (icon.isNotBlank()) {
            TextButton(onClick = onClear, modifier = Modifier.heightIn(min = 48.dp)) { Text("Clear") }
        }
    }
}

@Composable
private fun IconPickerDialog(
    selectedToken: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
    onClear: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(IconCategory.ALL) }
    val filteredIcons = searchBuiltInIcons(query, category)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose an icon") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Material Design Icons", style = MaterialTheme.typography.labelMedium)
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Search icons") },
                    placeholder = { Text("Try appointment, food, relax…") },
                    singleLine = true,
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(vertical = 2.dp)) {
                    items(IconCategory.entries.toList(), key = { it.name }) { option ->
                        FilterChip(selected = category == option, onClick = { category = option }, label = { Text(option.label) })
                    }
                }
                Text("${filteredIcons.size} icons", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier.fillMaxWidth().height(330.dp),
                    contentPadding = PaddingValues(2.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    gridItems(filteredIcons, key = { it.token }) { option ->
                        OutlinedButton(
                            onClick = { onSelect(option.token) },
                            modifier = Modifier.fillMaxWidth().height(84.dp),
                            contentPadding = PaddingValues(4.dp),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                containerColor = if (selectedToken == option.token) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                            ),
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(builtInIconFontGlyph(option.token) ?: option.glyph, fontFamily = if (builtInIconFontGlyph(option.token) != null) AUTIPLANNER_ICON_FONT else null, fontSize = 24.sp)
                                Text(option.label, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClear) { Text("Clear icon") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun readSettings(preferences: android.content.SharedPreferences): SavedSettings? {
    val baseUrl = preferences.getString("base_url", null)?.takeIf { it.isNotBlank() } ?: return null
    val token = preferences.getString("token", null)?.takeIf { it.isNotBlank() } ?: return null
    val entityId = preferences.getString("entity_id", null)?.takeIf { it.isNotBlank() } ?: return null
    return SavedSettings(baseUrl, token, entityId)
}

@Composable
private fun PriorityLegend() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        RoutinePriority.entries.forEach { priority ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("●", color = priorityDotColor(priority), modifier = Modifier.semantics { contentDescription = priority.label })
                Text(priority.label, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun priorityDotColor(priority: RoutinePriority): Color = when (priority) {
    RoutinePriority.MUST_DO -> Color(0xFF2E7D4F)
    RoutinePriority.PREFERABLY -> Color(0xFFB57900)
    RoutinePriority.OPTIONAL -> Color(0xFFB54848)
}

@Composable
private fun priorityContainer(priority: RoutinePriority): Color {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    return when (priority) {
        RoutinePriority.MUST_DO -> if (dark) Color(0xFF1E3A2A) else Color(0xFFE3F2E8)
        RoutinePriority.PREFERABLY -> if (dark) Color(0xFF4A3D1F) else Color(0xFFFFF4D6)
        RoutinePriority.OPTIONAL -> if (dark) Color(0xFF4A2624) else Color(0xFFFFE4E1)
    }
}

private fun priorityRank(priority: RoutinePriority): Int = when (priority) {
    RoutinePriority.MUST_DO -> 0
    RoutinePriority.PREFERABLY -> 1
    RoutinePriority.OPTIONAL -> 2
}

private fun formatDate(value: String): String = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL)) }.getOrDefault(value)

private fun formatTime(item: RoutineItem): String? = Regex("T(\\d{2}:\\d{2})").find(item.start ?: item.due ?: "")?.groupValues?.get(1)

private fun iconGlyph(value: String): String = builtInIcon(value)?.glyph ?: when (value.lowercase()) {
    "fa:coffee", "mdi:coffee" -> "☕"
    "fa:medkit", "mdi:pill" -> "💊"
    "fa:heart", "mdi:heart" -> "♥"
    "fa:bed", "mdi:sleep" -> "☾"
    else -> if (value.startsWith("unicode:", ignoreCase = true)) value.substringAfter(":") else value
}

private fun monthWeeks(month: YearMonth): List<List<LocalDate>> {
    val first = month.atDay(1)
    val start = first.minusDays((first.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())
    val last = month.atEndOfMonth()
    val end = last.plusDays((DayOfWeek.SUNDAY.value - last.dayOfWeek.value).toLong())
    return generateSequence(start) { current -> if (current.plusDays(7) <= end) current.plusDays(7) else null }
        .map { weekStart -> (0L..6L).map { weekStart.plusDays(it) } }
        .toList()
}

private fun isoWeek(value: LocalDate): Int = value.get(WeekFields.ISO.weekOfWeekBasedYear())
