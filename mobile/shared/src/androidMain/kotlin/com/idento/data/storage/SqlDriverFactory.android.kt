package com.idento.data.storage

import android.content.Context
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.idento.db.IdentoDatabase

actual class SqlDriverFactory(private val context: Context) {
    actual fun createDriver(): SqlDriver =
        AndroidSqliteDriver(IdentoDatabase.Schema, context, "idento.db")
}
