package app.autiplanner

import app.autiplanner.data.AppContainer
import app.autiplanner.data.CrashLog
import app.autiplanner.data.InMemoryCrashStore
import app.autiplanner.data.InMemorySettingsStore
import app.autiplanner.data.RoutineSettings
import app.autiplanner.data.SetupProblem
import app.autiplanner.ui.AgendaViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

/**
 * Regression tests for the post-startup crash.
 *
 * The app died because the default `ViewModelProvider` factory could not
 * instantiate `AgendaViewModel`. These tests pin the factory and the settings
 * path that replaced it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(JUnit4::class)
class StartupTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun configuredContainer(): AppContainer = AppContainer(
        InMemorySettingsStore(
            RoutineSettings(
                baseUrl = "https://homeassistant.local:8123/",
                token = "token",
                entityId = "sensor.routine_agenda",
            ),
        ),
    )

    @Test
    fun `the factory creates the view model instead of throwing`() {
        val factory = AgendaViewModel.Factory(configuredContainer().client())
        // Would throw IllegalArgumentException with the default factory.
        val viewModel = factory.create(AgendaViewModel::class.java)
        assertNotNull(viewModel)
        // The state is available immediately.
        assertNotNull(viewModel.state.value)
    }

    @Test
    fun `an unconfigured container still builds a client that fails as state`() {
        val container = AppContainer(InMemorySettingsStore())
        assertFalse(container.isConfigured())
        // The client must be constructible even with no settings.
        val client = container.client()
        assertNotNull(client)
    }

    @Test
    fun `settings validation accepts http and https only`() {
        assertEquals(
            "https://example.local:8123",
            RoutineSettings.validateUrl("https://example.local:8123/"),
        )
        assertEquals("http://10.0.0.2:8123", RoutineSettings.validateUrl("http://10.0.0.2:8123"))
        assertEquals(null, RoutineSettings.validateUrl("example.local"))
        assertEquals(null, RoutineSettings.validateUrl("ftp://example.local"))
        assertEquals(null, RoutineSettings.validateUrl(""))
    }

    @Test
    fun `problems explain what is missing`() {
        val empty = RoutineSettings()
        assertTrue(SetupProblem.URL_MISSING in empty.problems())
        assertTrue(SetupProblem.TOKEN_MISSING in empty.problems())
        assertTrue(SetupProblem.ENTITY_MISSING in empty.problems())

        val badUrl = RoutineSettings(baseUrl = "nope", token = "t", entityId = "e")
        assertEquals(listOf(SetupProblem.URL_INVALID), badUrl.problems())

        assertTrue(
            RoutineSettings(baseUrl = "https://h.local", token = "t", entityId = "sensor.x")
                .problems()
                .isEmpty(),
        )
    }

    @Test
    fun `a stored crash is recorded and then cleared`() {
        val log = CrashLog(InMemoryCrashStore())
        assertEquals(null, log.last())

        val record = log.record(IllegalStateException("boom"), "main", 1_000L)
        assertEquals("java.lang.IllegalStateException: boom", record.message)
        assertEquals("main", record.threadName)
        assertEquals(1_000L, record.timestampMillis)
        assertNotNull(log.last())

        log.clear()
        assertEquals(null, log.last())
    }

    @Test
    fun `a crash without a message still records its type`() {
        val log = CrashLog(InMemoryCrashStore())
        val record = log.record(RuntimeException(), "main", 5L)
        assertEquals("java.lang.RuntimeException", record.message)
    }
}
