package app.autiplanner.data

/**
 * A record of the last crash that happened outside normal error handling.
 *
 * AutiPlanner handles expected failures as state, so anything recorded here is
 * a bug worth surfacing on the next launch rather than dying silently.
 */
data class CrashRecord(
    val message: String,
    val threadName: String,
    val timestampMillis: Long,
)

interface CrashStore {
    fun read(): CrashRecord?

    fun write(record: CrashRecord)

    fun clear()
}

class CrashLog(private val store: CrashStore) {

    fun record(throwable: Throwable, threadName: String, nowMillis: Long): CrashRecord {
        val record = CrashRecord(
            message = describe(throwable),
            threadName = threadName,
            timestampMillis = nowMillis,
        )
        runCatching { store.write(record) }
        return record
    }

    fun last(): CrashRecord? = runCatching { store.read() }.getOrNull()

    fun clear() {
        runCatching { store.clear() }
    }

    private fun describe(throwable: Throwable): String {
        val type = throwable::class.java.name
        val message = throwable.message?.take(200)?.trim()
        return if (message.isNullOrEmpty()) type else "$type: $message"
    }
}

class InMemoryCrashStore(private var record: CrashRecord? = null) : CrashStore {
    override fun read(): CrashRecord? = record

    override fun write(record: CrashRecord) {
        this.record = record
    }

    override fun clear() {
        record = null
    }
}
