package app.autiplanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.autiplanner.core.AgendaDay
import app.autiplanner.core.DayPartSection
import app.autiplanner.core.MIN_TOUCH_TARGET_DP
import app.autiplanner.core.OutcomeControl
import app.autiplanner.core.OutcomeSummary
import app.autiplanner.core.RoutineItem
import app.autiplanner.core.RoutineStatus
import app.autiplanner.core.outcomeControls
import app.autiplanner.core.summarize

/**
 * The daily agenda.
 *
 * Every outcome is shown as a glyph *and* as a word, so state is never
 * communicated by glyph or color alone. Day-part headings are exposed to
 * assistive technology as headings.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgendaScreen(
    day: AgendaDay?,
    summary: OutcomeSummary?,
    error: String?,
    conflict: String?,
    crash: String?,
    onRefresh: () -> Unit,
    onStatus: (RoutineItem, RoutineStatus) -> Unit,
    onDismissConflict: () -> Unit,
    onDismissCrash: () -> Unit,
    onDisconnect: () -> Unit,
    snackbarHostState: SnackbarHostState,
    onDateChange: (Int) -> Unit,
) {
    var pendingAction by remember { mutableStateOf<Pair<RoutineItem, RoutineStatus>?>(null) }
    var menuOpen by remember { mutableStateOf(false) }

    LaunchedEffect(conflict) {
        if (conflict != null) {
            snackbarHostState.showSnackbar("Showing the stored version of the routine")
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(day?.heading ?: "No routine") },
                navigationIcon = {
                    TextButton(
                        onClick = { onDateChange(-1) },
                        modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
                    ) { Text("‹") }
                },
                actions = {
                    TextButton(
                        onClick = onRefresh,
                        modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
                    ) { Text("Refresh") }
                    TextButton(
                        onClick = { onDateChange(1) },
                        modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
                    ) { Text("›") }
                    IconButton(
                        onClick = { menuOpen = true },
                        modifier = Modifier.size(MIN_TOUCH_TARGET_DP.dp),
                    ) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More options")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("Disconnect from Home Assistant") },
                            onClick = {
                                menuOpen = false
                                onDisconnect()
                            },
                            modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
                        )
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (crash != null) {
                CrashBanner(message = crash, onDismiss = onDismissCrash)
            }
            if (error != null) {
                ErrorBanner(error, onRefresh)
            }
            if (summary != null) {
                SummaryBar(summary)
            }
            if (conflict != null) {
                ConflictBanner(conflict, onDismissConflict)
            }
            if (day == null || day.sections.isEmpty()) {
                EmptyDay(hasError = error != null)
            } else {
                LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(day.sections, key = { it.dayPart.name }) { section ->
                        DayPartCard(section) { item, status ->
                            val control = outcomeControls(item.status)
                                .firstOrNull { it.next == status }
                            if (control?.destructive == true) {
                                // Missed and skipped confirm first.
                                pendingAction = item to status
                            } else {
                                onStatus(item, status)
                            }
                        }
                    }
                }
            }
        }
    }

    pendingAction?.let { (item, status) ->
        ConfirmDialog(
            item = item,
            status = status,
            onConfirm = {
                pendingAction = null
                onStatus(item, status)
            },
            onDismiss = { pendingAction = null },
        )
    }

    // A conflict is resolved by the user, never by silently overwriting.
}

@Composable
private fun SummaryBar(summary: OutcomeSummary) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics {
                contentDescription = "Pending ${summary.pending}, " +
                    "completed ${summary.completed}, missed ${summary.missed}, skipped ${summary.skipped}"
            },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("${summary.pending} ${RoutineStatus.PENDING.symbol} pending", style = MaterialTheme.typography.bodySmall)
        Text("${summary.completed} ${RoutineStatus.COMPLETED.symbol} completed", style = MaterialTheme.typography.bodySmall)
        Text("${summary.missed} ${RoutineStatus.MISSED.symbol} missed", style = MaterialTheme.typography.bodySmall)
        Text("${summary.skipped} ${RoutineStatus.SKIPPED.symbol} skipped", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ConflictBanner(message: String, onDismiss: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Row(
            modifier = Modifier.padding(12.dp).heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = onDismiss, modifier = Modifier.size(MIN_TOUCH_TARGET_DP.dp)) {
                Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "Dismiss and undo my change")
            }
        }
    }
}

@Composable
private fun EmptyDay(hasError: Boolean) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            if (hasError) {
                "Nothing to show while the app is not connected."
            } else {
                "Nothing planned for this day."
            },
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(24.dp),
        )
    }
}

@Composable
private fun ErrorBanner(message: String, onRetry: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            TextButton(
                onClick = onRetry,
                modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            ) { Text("Try again") }
        }
    }
}

@Composable
private fun DayPartCard(
    section: DayPartSection,
    onStatus: (RoutineItem, RoutineStatus) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                section.dayPart.heading,
                style = MaterialTheme.typography.labelLarge,
                letterSpacing = 1.2.sp,
                modifier = Modifier.semantics { contentDescription = section.dayPart.spoken },
            )
            Spacer(Modifier.height(8.dp))
            section.items.forEach { item ->
                RoutineRow(item, onStatus)
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun RoutineRow(
    item: RoutineItem,
    onStatus: (RoutineItem, RoutineStatus) -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val controls = outcomeControls(item.status)
    val primary = controls.firstOrNull { it.next != null }
    val clock = item.clock()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MIN_TOUCH_TARGET_DP.dp)
            .semantics(mergeDescendants = true) { contentDescription = item.accessibleLabel() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            item.status.symbol,
            style = MaterialTheme.typography.titleLarge,
            color = statusColor(item.status),
            modifier = Modifier.defaultMinSize(minWidth = 28.dp),
        )
        Column(modifier = Modifier.weight(1f).padding(horizontal = 8.dp)) {
            Text(item.title, style = MaterialTheme.typography.bodyLarge)
            if (clock != null) {
                Text(
                    clock,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.clearAndSetSemantics { },
                )
            }
        }
        if (primary != null) {
            OutcomeButton(
                control = primary,
                onClick = { primary.next?.let { onStatus(item, it) } },
            )
        }
        Box {
            IconButton(
                onClick = { menuOpen = true },
                modifier = Modifier.size(MIN_TOUCH_TARGET_DP.dp),
            ) {
                Icon(Icons.Default.MoreVert, contentDescription = "More outcomes for ${item.title}")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                controls.forEach { control ->
                    if (control.status != item.status || control.status == RoutineStatus.PENDING) {
                        DropdownMenuItem(
                            text = { Text("${control.symbol} ${control.accessibleLabel}") },
                            onClick = {
                                menuOpen = false
                                control.next?.let { onStatus(item, it) }
                            },
                            modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The primary control. Its label names the state it applies, so TalkBack
 * announces the action rather than only the current state.
 */
@Composable
private fun OutcomeButton(control: OutcomeControl, onClick: () -> Unit) {
    val target = control.next
    val action = when (target) {
        RoutineStatus.COMPLETED -> "Mark completed"
        RoutineStatus.PENDING -> "Reset to pending"
        else -> "Mark ${target?.accessibleLabel?.lowercase()}"
    }
    TextButton(
        onClick = onClick,
        modifier = Modifier
            .defaultMinSize(minWidth = MIN_TOUCH_TARGET_DP.dp, minHeight = MIN_TOUCH_TARGET_DP.dp)
            .semantics { contentDescription = action },
    ) {
        Text(text = "${control.symbol} $action", fontSize = 16.sp)
    }
}

@Composable
private fun ConfirmDialog(
    item: RoutineItem,
    status: RoutineStatus,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Mark as ${status.accessibleLabel.lowercase()}") },
        text = { Text("${item.title}\n\nYou can undo this straight away afterwards.") },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            ) { Text(status.accessibleLabel) }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            ) { Text("Cancel") }
        },
    )
}

/** Color is a secondary cue only; the glyph and the label carry the state. */
@Composable
private fun statusColor(status: RoutineStatus): Color = when (status) {
    RoutineStatus.PENDING -> MaterialTheme.colorScheme.outline
    RoutineStatus.COMPLETED -> MaterialTheme.colorScheme.primary
    RoutineStatus.MISSED -> MaterialTheme.colorScheme.error
    RoutineStatus.SKIPPED -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Preview
@Composable
private fun AgendaPreview() {
    val items = listOf(
        RoutineItem("a", "Take medication", "2026-08-11", app.autiplanner.core.DayPart.MORNING, RoutineStatus.COMPLETED, start = "2026-08-11T08:00:00Z", completedAt = "2026-08-11T08:05:00Z", order = 10),
        RoutineItem("b", "Eat breakfast", "2026-08-11", app.autiplanner.core.DayPart.MORNING, RoutineStatus.PENDING, start = "2026-08-11T08:30:00Z", order = 20),
        RoutineItem("c", "Exercise", "2026-08-11", app.autiplanner.core.DayPart.AFTERNOON, RoutineStatus.MISSED, start = "2026-08-11T13:30:00Z", order = 10),
        RoutineItem("d", "Optional journaling", "2026-08-11", app.autiplanner.core.DayPart.EVENING, RoutineStatus.SKIPPED, start = "2026-08-11T20:00:00Z"),
    )
    AgendaScreen(
        day = app.autiplanner.core.Agenda(items = items).days().first(),
        summary = summarize(items),
        error = null,
        conflict = null,
        crash = null,
        onRefresh = {},
        onStatus = { _, _ -> },
        onDismissConflict = {},
        onDismissCrash = {},
        onDisconnect = {},
        snackbarHostState = remember { SnackbarHostState() },
        onDateChange = {},
    )
}
