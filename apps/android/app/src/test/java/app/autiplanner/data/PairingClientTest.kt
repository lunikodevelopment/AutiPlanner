package app.autiplanner.data

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4
import java.io.IOException

/** A transport that answers from a script, and records the URLs it was asked for. */
private class FakeTransport(
    private val answer: (String) -> JsonObject,
) : RoutineTransport {
    val urls = mutableListOf<String>()
    var failWith: Exception? = null

    override suspend fun post(path: String, body: JsonObject): JsonObject {
        urls.add(path)
        failWith?.let { throw it }
        return answer(path)
    }
}

private fun paired(
    token: String = "token-123",
    entity: String? = "sensor.routine_agenda",
): JsonObject = buildJsonObject {
    put("access_token", token)
    if (entity != null) put("entity_id", entity)
}

@RunWith(JUnit4::class)
class PairingClientTest {

    private fun client(transport: FakeTransport): PairingClient =
        PairingClient { transport }

    @Test
    fun `a successful pairing returns usable settings`() = runTest {
        val transport = FakeTransport { paired() }
        val result = client(transport).pair(
            candidates = listOf("https://ha.local:8123"),
            code = "code-abc",
            deviceName = "Pixel",
        )
        assertTrue(result is PairResult.Paired)
        val settings = (result as PairResult.Paired).settings
        assertEquals("https://ha.local:8123", settings.baseUrl)
        assertEquals("token-123", settings.token)
        assertEquals("sensor.routine_agenda", settings.entityId)
        assertTrue(settings.isConfigured)
        assertEquals(listOf("/api/autiplanner/pair"), transport.urls)
    }

    @Test
    fun `a missing entity id falls back to a safe default`() = runTest {
        val transport = FakeTransport { paired(entity = null) }
        val result = client(transport).pair(listOf("https://ha.local"), "code", "Pixel")
        assertEquals("sensor.routine_agenda", (result as PairResult.Paired).settings.entityId)
    }

    @Test
    fun `the first reachable candidate wins`() = runTest {
        val failing = FakeTransport { paired() }.apply { failWith = IOException("unreachable") }
        // Only the second candidate answers.
        val response = paired()
        val transport = FakeTransport { response }
        var calls = 0
        val client = PairingClient {
            calls += 1
            if (calls == 1) failing else transport
        }
        val result = client.pair(
            candidates = listOf("https://external.example", "http://10.0.0.2:8123"),
            code = "code",
            deviceName = "Pixel",
        )
        assertTrue(result is PairResult.Paired)
        assertEquals("http://10.0.0.2:8123", (result as PairResult.Paired).settings.baseUrl)
    }

    @Test
    fun `an invalid address is rejected before any request`() = runTest {
        val transport = FakeTransport { paired() }
        val result = client(transport).pair(listOf("not-a-url"), "code", "Pixel")
        assertTrue(result is PairResult.Failed)
        assertEquals(SetupProblem.URL_INVALID, (result as PairResult.Failed).message)
        assertTrue(transport.urls.isEmpty())
    }

    @Test
    fun `a blank code is rejected without a request`() = runTest {
        val transport = FakeTransport { paired() }
        val result = client(transport).pair(listOf("https://ha.local"), "  ", "Pixel")
        assertTrue(result is PairResult.Failed)
        assertTrue(transport.urls.isEmpty())
    }

    @Test
    fun `an error payload is reported verbatim`() = runTest {
        val transport = FakeTransport {
            buildJsonObject {
                put("error", buildJsonObject { put("message", "That pairing code has expired") })
            }
        }
        val result = client(transport).pair(listOf("https://ha.local"), "code", "Pixel")
        assertEquals("That pairing code has expired", (result as PairResult.Failed).message)
    }

    @Test
    fun `a network failure is reported instead of throwing`() = runTest {
        val transport = FakeTransport { paired() }.apply { failWith = IOException("no route to host") }
        val result = client(transport).pair(listOf("https://ha.local"), "code", "Pixel")
        assertEquals("no route to host", (result as PairResult.Failed).message)
    }

    @Test
    fun `the code is trimmed before it is sent`() = runTest {
        var sent: String? = null
        val transport = object : RoutineTransport {
            override suspend fun post(path: String, body: JsonObject): JsonObject {
                sent = body["code"].toString().trim('"')
                return paired()
            }
        }
        PairingClient { transport }.pair(listOf("https://ha.local"), "  abc  ", "Pixel")
        assertEquals("abc", sent)
    }
}
