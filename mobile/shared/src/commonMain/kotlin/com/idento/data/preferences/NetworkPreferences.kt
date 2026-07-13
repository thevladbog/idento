package com.idento.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.DataStoreNames
import kotlinx.atomicfu.atomic
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach

/**
 * Stores the user-configured on-prem server URL override. `null`/absent means "use
 * [com.idento.data.network.getDefaultBaseUrl] as before" — every existing install keeps
 * today's exact behavior until someone explicitly sets a custom URL via the Server URL screen.
 *
 * DataStore is `Flow`-based with no synchronous read API, but [com.idento.data.network.ApiClient]
 * needs a synchronous `baseUrlProvider` (called on every request, can't suspend). Mirrors
 * [AuthPreferences]'s `cachedToken` pattern: an [atomic] in-memory cache that (a) updates
 * synchronously the instant [save] is called — no DataStore round-trip needed before the app can
 * use a just-saved URL — and (b) is best-effort warmed from the persisted value once at
 * construction via a background coroutine. That warm-up leaves a negligible cold-start race (a
 * request sent in the literal milliseconds before it completes would still see `null`/default)
 * — the same tradeoff [AuthPreferences] already accepts for its own cache. This class does NOT
 * use `runBlocking` to close that race — see this plan's Global Constraints for why.
 */
class NetworkPreferences(dataStoreFactory: DataStoreFactory) {

    private val dataStore: DataStore<Preferences> =
        dataStoreFactory.createDataStore(DataStoreNames.NETWORK_CONFIG)

    companion object {
        private val CUSTOM_BASE_URL = stringPreferencesKey("custom_base_url")
    }

    private val cachedUrl = atomic<String?>(null)

    // Long-lived (app-lifetime singleton) scope for the one-shot startup cache warm-up —
    // same rationale/lifetime as AuthPreferences's own `scope`.
    private val scope = CoroutineScope(Dispatchers.Default)

    val customBaseUrl: Flow<String?> = dataStore.data.map { prefs -> prefs[CUSTOM_BASE_URL] }

    init {
        customBaseUrl.onEach { cachedUrl.value = it }.launchIn(scope)
    }

    /** Synchronous, cache-backed read — see the class doc for why this can't just be `suspend`. */
    fun getBaseUrlSync(): String? = cachedUrl.value

    /**
     * Persists first, then updates the in-memory cache — the reverse order would leave
     * [getBaseUrlSync] (and therefore [com.idento.data.network.ApiClient]'s live
     * `baseUrlProvider`) pointed at [url] even if the DataStore write below throws, stranding the
     * app on a server it never actually saved a record of switching to.
     */
    suspend fun save(url: String) {
        dataStore.edit { prefs -> prefs[CUSTOM_BASE_URL] = url }
        cachedUrl.value = url
    }

    suspend fun clear() {
        dataStore.edit { prefs -> prefs.remove(CUSTOM_BASE_URL) }
        cachedUrl.value = null
    }
}
