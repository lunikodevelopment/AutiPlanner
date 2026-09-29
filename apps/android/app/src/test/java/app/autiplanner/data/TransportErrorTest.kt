package app.autiplanner.data

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import okhttp3.OkHttpClient
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * A wrong address is the most common reason the app cannot reach Home
 * Assistant. These pin the message a household actually sees, because the raw
 * OkHttp text does not say which part of the address is wrong.
 */
@RunWith(JUnit4::class)
class TransportErrorTest {

    private fun transportThrowing(error: IOException): HomeAssistantHttpTransport {
        val client = OkHttpClient.Builder()
            .addInterceptor { throw error }
            .build()
        return HomeAssistantHttpTransport(
            baseUrl = "http://92.168.11.114:8123",
            tokenProvider = { "token" },
            client = client,
        )
    }

    private suspend fun messageFrom(error: IOException): String =
        try {
            transportThrowing(error).post("/api/autiplanner/pair", buildJsonObject { })
            "no error thrown"
        } catch (thrown: IOException) {
            thrown.message.orEmpty()
        }

    @Test
    fun `a timeout names the host and suggests the address or the network`() = runTest {
        val message = messageFrom(SocketTimeoutException("timeout"))
        assertTrue(message, message.contains("92.168.11.114:8123"))
        assertTrue(message, message.contains("typos", ignoreCase = true))
        assertTrue(message, message.contains("same network", ignoreCase = true))
    }

    @Test
    fun `an unknown host suggests a typo`() = runTest {
        val message = messageFrom(UnknownHostException("nope.local"))
        assertTrue(message, message.contains("92.168.11.114:8123"))
        assertTrue(message, message.contains("typos", ignoreCase = true))
    }

    @Test
    fun `a refused connection says nothing answered`() = runTest {
        val message = messageFrom(ConnectException("Connection refused"))
        assertTrue(message, message.contains("92.168.11.114:8123"))
        assertTrue(message, message.contains("running", ignoreCase = true))
    }

    @Test
    fun `a TLS failure points at http versus https`() = runTest {
        val message = messageFrom(javax.net.ssl.SSLHandshakeException("handshake failed"))
        assertTrue(message, message.contains("http://"))
    }

    @Test
    fun `the message includes the port that was tried`() = runTest {
        val message = messageFrom(SocketTimeoutException("timeout"))
        assertTrue(message, message.contains(":8123"))
    }
}
