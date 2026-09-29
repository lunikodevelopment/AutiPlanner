package app.autiplanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.autiplanner.core.MIN_TOUCH_TARGET_DP
import app.autiplanner.data.PairResult
import app.autiplanner.data.RoutineSettings
import kotlinx.coroutines.launch

/**
 * Connects the app to Home Assistant.
 *
 * Pairing is the normal path: Home Assistant shows a short code, the app
 * exchanges it for a token. Entering a token by hand stays available for anyone
 * who prefers it, and for builds where pairing is unavailable.
 */
@Composable
fun SetupScreen(
    initial: RoutineSettings,
    deviceName: String,
    onPair: suspend (address: String, code: String) -> PairResult,
    onSave: (RoutineSettings) -> Unit,
    modifier: Modifier = Modifier,
) {
    var address by remember { mutableStateOf(initial.baseUrl) }
    var code by remember { mutableStateOf("") }
    var token by remember { mutableStateOf(initial.token) }
    var entityId by remember { mutableStateOf(initial.entityId) }
    var pairing by remember { mutableStateOf(false) }
    var pairError by remember { mutableStateOf<String?>(null) }
    var manualOpen by remember { mutableStateOf(!initial.isConfigured && initial.token.isNotBlank()) }
    val scope = rememberCoroutineScope()

    val draft = RoutineSettings(baseUrl = address, token = token, entityId = entityId)

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Connect to Home Assistant", style = MaterialTheme.typography.headlineSmall)
        Text(
            "AutiPlanner reads and writes your routine through Home Assistant. " +
                "The app never edits the calendar file directly.",
            style = MaterialTheme.typography.bodyMedium,
        )

        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            label = { Text("Home Assistant address") },
            placeholder = { Text("https://homeassistant.local:8123") },
            singleLine = true,
            isError = address.isNotBlank() && RoutineSettings.validateUrl(address) == null,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
        )

        OutlinedTextField(
            value = code,
            onValueChange = { code = it.trim() },
            label = { Text("Pairing code") },
            placeholder = { Text("From Developer tools → Actions") },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
        )

        Button(
            onClick = {
                pairError = null
                pairing = true
                scope.launch {
                    when (val result = onPair(address, code)) {
                        is PairResult.Paired -> {
                            token = result.settings.token
                            entityId = result.settings.entityId
                            address = result.settings.baseUrl
                            onSave(result.settings)
                        }
                        is PairResult.Failed -> pairError = result.message
                    }
                    pairing = false
                }
            },
            enabled = !pairing && RoutineSettings.validateUrl(address) != null && code.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
        ) {
            if (pairing) {
                CircularProgressIndicator(modifier = Modifier.height(20.dp), strokeWidth = 2.dp)
            } else {
                Text("Pair this device")
            }
        }

        pairError?.let { message ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(
                    message,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        OutlinedButton(
            onClick = { manualOpen = !manualOpen },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
        ) {
            Text(if (manualOpen) "Hide manual setup" else "Enter a token manually")
        }

        if (manualOpen) {
            HorizontalDivider()
            Text("Manual setup", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("Long-lived access token") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            )
            OutlinedTextField(
                value = entityId,
                onValueChange = { entityId = it },
                label = { Text("AutiPlanner entity (optional)") },
                placeholder = { Text("sensor.routine_agenda") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            )
            Button(
                onClick = { onSave(draft) },
                enabled = draft.isConfigured,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = MIN_TOUCH_TARGET_DP.dp),
            ) {
                Text("Save and connect")
            }
            val problems = if (token.isNotBlank() || entityId.isNotBlank()) draft.problems() else emptyList()
            problems.forEach { problem ->
                Text("• $problem", style = MaterialTheme.typography.bodySmall)
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Still in Home Assistant, go to Developer tools → Actions, choose " +
                    "AutiPlanner: Pair a device, and select Perform action. The code " +
                    "expires after ten minutes and only works once. This device is " +
                    "registered as \"$deviceName\".",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
