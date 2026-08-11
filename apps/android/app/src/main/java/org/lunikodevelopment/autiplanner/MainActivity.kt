package org.lunikodevelopment.autiplanner

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.lunikodevelopment.autiplanner.data.RoutineRepository
import org.lunikodevelopment.autiplanner.ha.HomeAssistantClient
import org.lunikodevelopment.autiplanner.ha.HomeAssistantConfig
import org.lunikodevelopment.autiplanner.model.DayPart
import org.lunikodevelopment.autiplanner.model.NewRoutine
import org.lunikodevelopment.autiplanner.model.RoutineCommand
import org.lunikodevelopment.autiplanner.model.RoutineItem
import org.lunikodevelopment.autiplanner.model.RoutineStatus
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AutiPlannerApp(this) }
    }
}

private data class SavedSettings(val baseUrl: String, val token: String, val entityId: String)

@Composable
private fun AutiPlannerApp(context: Context) {
    val preferences = remember { context.getSharedPreferences("autiplanner", Context.MODE_PRIVATE) }
    var settings by remember { mutableStateOf(readSettings(preferences)) }
    MaterialTheme {
        if (settings == null) {
            SetupScreen(onSave = { next ->
                preferences.edit().putString("base_url", next.baseUrl).putString("token", next.token).putString("entity_id", next.entityId).apply()
                settings = next
            })
        } else {
            val current = settings!!
            PlannerScreen(
                repository = remember(current) {
                    RoutineRepository(context, HomeAssistantClient(HomeAssistantConfig(current.baseUrl, current.token, current.entityId)))
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
private fun PlannerScreen(repository: RoutineRepository, onChangeConnection: () -> Unit) {
    val scope = rememberCoroutineScope()
    var date by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
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

    LaunchedEffect(repository) {
        refresh()
        while (true) {
            delay(15_000)
            runCatching { repository.refresh() }.onSuccess { next -> items = next; error = null }
        }
    }

    val dayItems = items.filter { it.date == date }
    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { date = LocalDate.parse(date).minusDays(1).toString() }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Previous") }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(formatDate(date), style = MaterialTheme.typography.titleLarge)
                    Text("${dayItems.size} ${if (dayItems.size == 1) "routine" else "routines"}")
                }
                TextButton(onClick = { date = LocalDate.parse(date).plusDays(1).toString() }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Next") }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { editorItem = null; editorOpen = true }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Add routine") }
                OutlinedButton(onClick = onChangeConnection, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Connection") }
            }
            Spacer(Modifier.height(8.dp))
            if (loading && items.isEmpty()) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) }
            if (!loading && dayItems.isEmpty()) Text("No routines scheduled for this day.", modifier = Modifier.padding(vertical = 24.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                DayPart.entries.forEach { dayPart ->
                    val group = dayItems.filter { it.dayPart == dayPart }
                    if (group.isNotEmpty()) {
                        item { Text(dayPart.label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
                        items(group, key = { it.uid }) { item ->
                            RoutineRow(item, busy = busyUid == item.uid, onSelect = { selectedItem = item }, onComplete = {
                                busyUid = item.uid
                                scope.launch { runCatching { repository.execute(RoutineCommand.Complete(item.uid)) }.onSuccess { items = it; error = null }.onFailure { error = it.message }.also { busyUid = null } }
                            })
                        }
                    }
                }
            }
        }
    }

    selectedItem?.let { item ->
        RoutineDetailDialog(item, busy = busyUid == item.uid, onDismiss = { selectedItem = null }, onCommand = { command ->
            busyUid = item.uid
            scope.launch { runCatching { repository.execute(command) }.onSuccess { items = it; selectedItem = it.firstOrNull { candidate -> candidate.uid == item.uid }; error = null }.onFailure { error = it.message }.also { busyUid = null } }
        }, onEdit = {
            editorItem = item
            selectedItem = null
            editorOpen = true
        }, onDelete = {
            busyUid = item.uid
            scope.launch { runCatching { repository.execute(RoutineCommand.Delete(item.uid)) }.onSuccess { items = it; selectedItem = null; error = null }.onFailure { error = it.message }.also { busyUid = null } }
        })
    }
    if (editorOpen) {
        RoutineEditorDialog(editorItem, date, onDismiss = { editorOpen = false }, onSave = { title, description, editedDate ->
            editorOpen = false
            scope.launch {
                runCatching {
                    editorItem?.let { existing ->
                        repository.execute(RoutineCommand.Update(existing.uid, title, description, editedDate))
                    } ?: repository.create(NewRoutine(title, description, editedDate))
                }.onSuccess { items = it; error = null }.onFailure { error = it.message }
            }
        })
    }
}

@Composable
private fun RoutineRow(item: RoutineItem, busy: Boolean, onSelect: () -> Unit, onComplete: () -> Unit) {
    Card(onClick = onSelect, modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Open details for ${item.title}" }) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(item.status.glyph, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { contentDescription = item.status.label })
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.titleMedium)
                Text("${item.status.label}${formatTime(item)?.let { " · $it" } ?: ""}")
            }
            if (item.status == RoutineStatus.PENDING) Button(onClick = onComplete, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (busy) "Saving…" else "Complete") }
        }
    }
}

@Composable
private fun RoutineDetailDialog(item: RoutineItem, busy: Boolean, onDismiss: () -> Unit, onCommand: (RoutineCommand) -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${item.status.glyph} ${item.title}") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("${item.status.label} · ${item.dayPart.label}"); item.description?.let { Text(it) }; Text(formatTime(item) ?: "Any time"); Text("UID ${item.uid}") } },
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
private fun RoutineEditorDialog(existing: RoutineItem?, date: String, onDismiss: () -> Unit, onSave: (String, String?, String) -> Unit) {
    var title by rememberSaveable(existing?.uid) { mutableStateOf(existing?.title.orEmpty()) }
    var description by rememberSaveable(existing?.uid) { mutableStateOf(existing?.description.orEmpty()) }
    var editedDate by rememberSaveable(existing?.uid) { mutableStateOf(existing?.date ?: date) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(if (existing == null) "Add routine" else "Edit routine") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(title, { title = it }, label = { Text("Title") }, singleLine = true)
        OutlinedTextField(description, { description = it }, label = { Text("Description") })
        OutlinedTextField(editedDate, { editedDate = it }, label = { Text("Date (YYYY-MM-DD)") }, singleLine = true)
    } }, confirmButton = { Button(onClick = { onSave(title.trim(), description.trim().ifBlank { null }, editedDate.trim()) }, enabled = title.isNotBlank() && editedDate.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) { Text("Save") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

private fun readSettings(preferences: android.content.SharedPreferences): SavedSettings? {
    val baseUrl = preferences.getString("base_url", null)?.takeIf { it.isNotBlank() } ?: return null
    val token = preferences.getString("token", null)?.takeIf { it.isNotBlank() } ?: return null
    val entityId = preferences.getString("entity_id", null)?.takeIf { it.isNotBlank() } ?: return null
    return SavedSettings(baseUrl, token, entityId)
}

private fun formatDate(value: String): String = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL)) }.getOrDefault(value)

private fun formatTime(item: RoutineItem): String? = Regex("T(\\d{2}:\\d{2})").find(item.start ?: item.due ?: "")?.groupValues?.get(1)
