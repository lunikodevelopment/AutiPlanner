package app.autiplanner.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.autiplanner.core.Agenda
import app.autiplanner.core.AgendaDay
import app.autiplanner.core.OutcomeSummary
import app.autiplanner.core.RoutineItem
import app.autiplanner.core.RoutineStatus
import app.autiplanner.core.summarize
import app.autiplanner.data.CommandResult
import app.autiplanner.data.HomeAssistantRoutineClient
import app.autiplanner.data.completionTimestamp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AgendaState(
    val agenda: Agenda = Agenda(),
    val offsetDays: Int = 0,
    val loading: Boolean = true,
    val error: String? = null,
    val conflict: String? = null,
) {
    /** The day the user is looking at, starting at today. */
    val day: AgendaDay?
        get() = agenda.days().getOrNull(offsetDays.coerceAtLeast(0))

    val summary: OutcomeSummary?
        get() = day?.sections?.flatMap { section -> section.items }?.let { items -> summarize(items) }

    val items: List<RoutineItem> get() = agenda.items
}

/**
 * Agenda state holder.
 *
 * Mutations go to Home Assistant and the UI is updated from the item the
 * server returns. A failed or conflicting command rolls the row back rather
 * than leaving a state the calendar does not have.
 */
class AgendaViewModel(
    private val client: HomeAssistantRoutineClient,
) : ViewModel() {

    private val _state = MutableStateFlow(AgendaState())
    val state: StateFlow<AgendaState> = _state.asStateFlow()

    init {
        refresh()
    }

    /**
     * Builds the view model with its client.
     *
     * Without this factory the default `ViewModelProvider` looks for a no-arg
     * constructor, does not find one, and throws on the first composition. That
     * was the post-startup crash.
     */
    class Factory(private val client: HomeAssistantRoutineClient) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(AgendaViewModel::class.java)) {
                "AgendaViewModel.Factory cannot create ${modelClass.name}"
            }
            @Suppress("UNCHECKED_CAST")
            return AgendaViewModel(client) as T
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            when (val result = client.agenda()) {
                is app.autiplanner.data.SyncResult.Success ->
                    _state.update { it.copy(agenda = result.agenda, loading = false, error = null) }
                is app.autiplanner.data.SyncResult.Failure ->
                    _state.update { it.copy(loading = false, error = result.message) }
            }
        }
    }

    fun moveDay(delta: Int) {
        _state.update { it.copy(offsetDays = (it.offsetDays + delta).coerceAtLeast(0)) }
    }

    fun dismissConflict() {
        _state.update { it.copy(conflict = null) }
    }

    fun setStatus(item: RoutineItem, status: RoutineStatus) {
        viewModelScope.launch {
            val result = when (status) {
                RoutineStatus.COMPLETED -> client.complete(item.uid, item.revision, completionTimestamp())
                RoutineStatus.MISSED -> client.markMissed(item.uid, item.revision)
                RoutineStatus.SKIPPED -> client.skip(item.uid, item.revision)
                RoutineStatus.PENDING -> client.reset(item.uid, item.revision)
            }
            apply(result, item)
        }
    }

    private fun apply(result: CommandResult, item: RoutineItem) {
        when (result) {
            is CommandResult.Applied -> _state.update { current ->
                current.copy(
                    agenda = current.agenda.copy(
                        items = current.agenda.items.map { entry ->
                            if (entry.uid == result.item.uid) result.item else entry
                        },
                    ),
                    conflict = null,
                )
            }
            is CommandResult.Conflict -> {
                // Roll back to what the calendar actually holds.
                _state.update { current ->
                    current.copy(
                        agenda = current.agenda.copy(
                            items = current.agenda.items.map { entry ->
                                result.serverItem?.takeIf { it.uid == entry.uid } ?: entry
                            },
                        ),
                        conflict = "${item.title} changed in Home Assistant. The stored version is shown.",
                    )
                }
                refresh()
            }
            is CommandResult.Rejected -> _state.update { current ->
                current.copy(error = result.message, conflict = null)
            }
        }
    }
}
