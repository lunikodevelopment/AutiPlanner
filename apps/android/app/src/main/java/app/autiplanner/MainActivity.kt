package app.autiplanner

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.autiplanner.data.RoutineSettings
import app.autiplanner.ui.AgendaScreen
import app.autiplanner.ui.AgendaViewModel
import app.autiplanner.ui.CrashBanner
import app.autiplanner.ui.SetupScreen

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as AutiPlannerApplication
        val container = app.container
        val crashLog = app.crashLog

        setContent {
            MaterialTheme {
                var configured by remember { mutableStateOf(container.isConfigured()) }
                // Recreates the view model when the connection changes.
                var connectionVersion by remember { mutableStateOf(0) }
                var crash by remember { mutableStateOf(crashLog.last()) }

                if (!configured) {
                    Column(Modifier.fillMaxSize()) {
                        crash?.let { record ->
                            CrashBanner(
                                message = record.message,
                                onDismiss = {
                                    crashLog.clear()
                                    crash = null
                                },
                            )
                        }
                        SetupScreen(
                            initial = container.settings(),
                            deviceName = android.os.Build.MODEL ?: "Android device",
                            onPair = { address, code ->
                                container.pair(
                                    baseUrl = address,
                                    code = code,
                                    deviceName = android.os.Build.MODEL ?: "Android device",
                                )
                            },
                            onSave = { settings ->
                                container.save(settings)
                                crashLog.clear()
                                crash = null
                                connectionVersion += 1
                                configured = true
                            },
                        )
                    }
                    return@MaterialTheme
                }

                // The factory is what makes this constructible. The default
                // factory looks for a no-arg constructor and crashed here.
                val viewModel: AgendaViewModel = viewModel(
                    key = "agenda-$connectionVersion",
                    factory = AgendaViewModel.Factory(container.client()),
                )
                val state by viewModel.state.collectAsStateWithLifecycle()

                LifecycleResumeEffect(Unit) {
                    viewModel.refresh()
                    onPauseOrDispose { }
                }

                AgendaScreen(
                    day = state.day,
                    summary = state.summary,
                    error = state.error,
                    conflict = state.conflict,
                    crash = crash?.message,
                    onRefresh = viewModel::refresh,
                    onStatus = viewModel::setStatus,
                    onDismissConflict = viewModel::dismissConflict,
                    onDismissCrash = {
                        crashLog.clear()
                        crash = null
                    },
                    onDisconnect = {
                        container.save(RoutineSettings())
                        connectionVersion += 1
                        configured = false
                    },
                    snackbarHostState = remember { SnackbarHostState() },
                    onDateChange = viewModel::moveDay,
                )
            }
        }
    }
}
