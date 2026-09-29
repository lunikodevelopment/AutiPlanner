package app.autiplanner.data

import android.content.Context

/**
 * Crash records in plain preferences.
 *
 * The message is an exception type and message, never routine data, so this
 * does not need the encrypted store. Writes use `commit()` because the crash
 * handler writes while the process is about to die and `apply()` may not finish.
 */
class SharedPreferencesCrashStore(context: Context) : CrashStore {
    private val prefs = context.applicationContext
        .getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    override fun read(): CrashRecord? {
        val message = prefs.getString(KEY_MESSAGE, null) ?: return null
        return CrashRecord(
            message = message,
            threadName = prefs.getString(KEY_THREAD, "").orEmpty(),
            timestampMillis = prefs.getLong(KEY_TIME, 0L),
        )
    }

    override fun write(record: CrashRecord) {
        prefs.edit()
            .putString(KEY_MESSAGE, record.message)
            .putString(KEY_THREAD, record.threadName)
            .putLong(KEY_TIME, record.timestampMillis)
            .commit()
    }

    override fun clear() {
        prefs.edit().clear().commit()
    }

    private companion object {
        const val FILE_NAME = "autiplanner_crash"
        const val KEY_MESSAGE = "message"
        const val KEY_THREAD = "thread"
        const val KEY_TIME = "time"
    }
}
