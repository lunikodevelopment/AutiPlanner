package app.autiplanner

import android.app.Application
import app.autiplanner.data.AppContainer
import app.autiplanner.data.CrashLog
import app.autiplanner.data.EncryptedSettingsStore
import app.autiplanner.data.SharedPreferencesCrashStore

/**
 * Wires the long-lived objects.
 *
 * A crash is recorded before the process dies so the next launch can explain
 * what happened. Expected failures are handled as UI state and never reach
 * this handler.
 */
class AutiPlannerApplication : Application() {

    lateinit var container: AppContainer
        private set

    lateinit var crashLog: CrashLog
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(EncryptedSettingsStore(this))
        crashLog = CrashLog(SharedPreferencesCrashStore(this))

        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            crashLog.record(throwable, thread.name, System.currentTimeMillis())
            previous?.uncaughtException(thread, throwable)
        }
    }
}
