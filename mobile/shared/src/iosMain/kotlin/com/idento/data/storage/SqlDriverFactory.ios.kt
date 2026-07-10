package com.idento.data.storage

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.idento.db.IdentoDatabase

actual class SqlDriverFactory {
    actual fun createDriver(): SqlDriver =
        NativeSqliteDriver(IdentoDatabase.Schema, "idento.db")
}
