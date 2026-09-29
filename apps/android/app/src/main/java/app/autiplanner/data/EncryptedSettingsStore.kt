package app.autiplanner.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Stores the Home Assistant connection settings.
 *
 * The access token is kept in `EncryptedSharedPreferences`, not plain
 * preferences, because a long-lived token grants full access to the household's
 * Home Assistant. `allowBackup` is disabled in the manifest so these values are
 * never copied into a cloud backup.
 */
class EncryptedSettingsStore(context: Context) : SettingsStore {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun load(): RoutineSettings = RoutineSettings(
        baseUrl = prefs.getString(KEY_URL, "").orEmpty(),
        token = prefs.getString(KEY_TOKEN, "").orEmpty(),
        entityId = prefs.getString(KEY_ENTITY, "").orEmpty(),
    )

    override fun save(settings: RoutineSettings) {
        prefs.edit()
            .putString(KEY_URL, settings.baseUrl.trim())
            .putString(KEY_TOKEN, settings.token.trim())
            .putString(KEY_ENTITY, settings.entityId.trim())
            .apply()
    }

    private companion object {
        const val FILE_NAME = "autiplanner_settings"
        const val KEY_URL = "base_url"
        const val KEY_TOKEN = "token"
        const val KEY_ENTITY = "entity_id"
    }
}
