package com.idento.data.storage

import app.cash.sqldelight.db.SqlDriver

/**
 * Platform-specific factory for creating the [SqlDriver] used by SQLDelight.
 * Android needs a [android.content.Context] to open the database file;
 * iOS's native driver does not need any platform context.
 */
expect class SqlDriverFactory {
    fun createDriver(): SqlDriver
}
