package com.idento.data.registration

import com.idento.data.model.PrinterConfig
import com.idento.data.sync.PrintRetryQueue
import com.idento.db.PrintJobQueries
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.datetime.Clock

/**
 * Domain representation of a queued print job awaiting submission to a physical printer —
 * deliberately a hand-rolled type (not the raw SQLDelight-generated row), matching this
 * codebase's established `PendingZoneCheckIn`/`PendingRegistrationCheckIn` convention (see
 * [RegistrationOfflineQueueRepository]): `attemptCount` comes back from SQLDelight as `Long`, but
 * callers work with `Int`.
 */
data class PrintJob(
    val id: Long,
    val zpl: String,
    val printerName: String,
    val printerTransport: String,
    val printerAddress: String,
    val status: String,
    val attemptCount: Int,
    val lastAttemptAt: Long?,
    val errorMessage: String?,
    val createdAt: Long,
)

/** Outcome of a single [PrintQueueRepository.retryNext] attempt. */
sealed class PrintRetryResult {
    /** The queue is empty — no print jobs pending at all. */
    data object NoJobsPending : PrintRetryResult()

    /** At least one job is pending, but the oldest eligible one is still within its backoff window. */
    data object WithinBackoffWindow : PrintRetryResult()

    /** The oldest eligible pending job printed successfully and was marked done. */
    data class Succeeded(val id: Long) : PrintRetryResult()

    /** The oldest eligible pending job failed again; the attempt/error was recorded and it stays pending. */
    data class Failed(val id: Long, val reason: String) : PrintRetryResult()
}

/**
 * Narrow seam for actually sending a print job's ZPL payload to its target printer, given the
 * job's persisted `printerTransport`/`printerAddress` columns. [createPrintSender] builds the real
 * production implementation (wired in `AppModule.kt`); tests substitute a fake instead of
 * depending on the real `BluetoothPrinterService`/`EthernetPrinterService` — both `expect class`es
 * with no `actual` outside androidMain/iosMain, so neither can be constructed in `commonTest`
 * directly (same rationale as `SetupPrinterViewModel`'s `BluetoothPrinterGateway`/
 * `EthernetPrinterGateway` seams).
 */
fun interface PrintSender {
    suspend fun send(printerTransport: String, printerAddress: String, zpl: String): Result<Unit>
}

/**
 * Builds the production [PrintSender]: routes to [BluetoothPrinterService.printWithAutoConnect]
 * for `"bluetooth"` jobs, or [EthernetPrinterService.printWithAutoConnect] for `"ethernet"` jobs
 * after parsing `printerAddress` as `"ip:port"`. Reproduces the exact safe-parsing guards from
 * `SetupPrinterViewModel.testPrint` (explicit empty/non-numeric-port checks via
 * `address.split(":", limit = 2)`, not a naive unguarded split that could throw
 * `IndexOutOfBoundsException`/`NumberFormatException` on a malformed address) — returning
 * `Result.failure` instead of throwing, so a malformed job is recorded as a failed attempt by
 * [PrintQueueRepository.retryNext] rather than crashing the retry loop.
 */
fun createPrintSender(
    bluetoothPrinterService: BluetoothPrinterService,
    ethernetPrinterService: EthernetPrinterService,
): PrintSender = PrintSender { transport, address, zpl ->
    when (transport) {
        "bluetooth" -> bluetoothPrinterService.printWithAutoConnect(address, zpl)
        "ethernet" -> {
            val parts = address.split(":", limit = 2)
            if (parts.size != 2) {
                Result.failure(IllegalArgumentException("Invalid printer address: $address"))
            } else {
                val port = parts[1].toIntOrNull()
                if (port == null) {
                    Result.failure(IllegalArgumentException("Invalid printer port: $address"))
                } else {
                    ethernetPrinterService.printWithAutoConnect(parts[0], port, zpl)
                }
            }
        }
        else -> Result.failure(IllegalArgumentException("Unknown printer transport: $transport"))
    }
}

/**
 * SQLDelight-backed offline print queue: persists print jobs (ZPL payload + target printer) so
 * they survive process death and can be retried with exponential backoff via [retryNext], rather
 * than being lost if a print attempt fails transiently (printer powered off, out of
 * Bluetooth/Wi-Fi range).
 *
 * Follows the same `withContext(Dispatchers.Default)` pattern as
 * [RegistrationOfflineQueueRepository] for every suspend method touching the SQLDelight queries
 * object, and the same per-operation try/catch (log-and-swallow) convention for writes whose
 * return type can't signal failure meaningfully (`Unit`) — matching `AuthRepository.kt`/
 * `AuthPreferences.kt`'s established style.
 *
 * [enqueue] is the one deliberate exception to that swallow convention: unlike
 * `RegistrationOfflineQueueRepository.enqueue` (which returns `Unit` and can safely swallow a
 * storage failure), this method's contract requires returning the real inserted row's id — there
 * is no sensible id to fabricate on failure, so the write is left unguarded and a storage
 * exception propagates (mirrors `SqlDelightOfflineDatabase.savePendingCheckIn`, equally unguarded
 * for the same reason).
 */
class PrintQueueRepository(
    private val queries: PrintJobQueries,
    private val printSender: PrintSender,
) : PrintRetryQueue {

    suspend fun enqueue(zpl: String, printer: PrinterConfig): Long = withContext(Dispatchers.Default) {
        queries.transactionWithResult {
            queries.insert(
                zpl = zpl,
                printerName = printer.name,
                printerTransport = printer.transport,
                printerAddress = printer.address,
                createdAt = Clock.System.now().toEpochMilliseconds(),
            )
            queries.lastInsertRowId().executeAsOne()
        }
    }

    suspend fun getPending(): List<PrintJob> = withContext(Dispatchers.Default) {
        queries.selectPending().executeAsList().map(::toDomain)
    }

    suspend fun markDone(id: Long) {
        withContext(Dispatchers.Default) {
            try {
                queries.markDone(id)
            } catch (e: Exception) {
                println("⚠️ Failed to mark print job $id as done: ${e.message}")
            }
        }
    }

    suspend fun markFailed(id: Long, reason: String) {
        withContext(Dispatchers.Default) {
            try {
                queries.markFailed(errorMessage = reason, id = id)
            } catch (e: Exception) {
                println("⚠️ Failed to mark print job $id as failed: ${e.message}")
            }
        }
    }

    /**
     * Drops every queued print job unconditionally — used when the app is pointed at a different
     * server (see `ServerUrlSaveGateway`'s `clearSession`), since a queued job's ZPL was rendered
     * for the *previous* server's attendee and would otherwise still print after the switch.
     */
    suspend fun clearAll() {
        withContext(Dispatchers.Default) {
            queries.deleteAll()
        }
    }

    /**
     * Attempts the oldest pending print job that is past its exponential backoff window
     * (`min(attemptCount^2, 300)` seconds since `lastAttemptAt` — see `PrintJob.sq`'s
     * `selectOldestPending`, which performs this filtering in SQL rather than fetching every
     * pending row into Kotlin just to filter one out). If nothing is eligible, distinguishes
     * an empty queue ([PrintRetryResult.NoJobsPending]) from a queue that has jobs but all are
     * still cooling down ([PrintRetryResult.WithinBackoffWindow]), which costs one extra
     * (unfiltered) query only on that path.
     */
    override suspend fun retryNext(): PrintRetryResult = withContext(Dispatchers.Default) {
        val now = Clock.System.now().toEpochMilliseconds()
        val job = queries.selectOldestPending(now).executeAsOneOrNull()?.let(::toDomain)
            ?: return@withContext if (queries.selectPending().executeAsList().isEmpty()) {
                PrintRetryResult.NoJobsPending
            } else {
                PrintRetryResult.WithinBackoffWindow
            }

        val result = printSender.send(job.printerTransport, job.printerAddress, job.zpl)
        result.fold(
            onSuccess = {
                try {
                    queries.markDone(job.id)
                } catch (e: Exception) {
                    println("⚠️ Failed to mark print job ${job.id} as done after a successful print: ${e.message}")
                }
                PrintRetryResult.Succeeded(job.id)
            },
            onFailure = { error ->
                val reason = error.message ?: "Unknown print error"
                try {
                    queries.updateAttempt(
                        attemptCount = job.attemptCount + 1L,
                        lastAttemptAt = now,
                        errorMessage = reason,
                        id = job.id,
                    )
                } catch (e: Exception) {
                    println("⚠️ Failed to record retry attempt for print job ${job.id}: ${e.message}")
                }
                PrintRetryResult.Failed(job.id, reason)
            },
        )
    }

    private fun toDomain(row: com.idento.db.PrintJob): PrintJob =
        PrintJob(
            id = row.id,
            zpl = row.zpl,
            printerName = row.printerName,
            printerTransport = row.printerTransport,
            printerAddress = row.printerAddress,
            status = row.status,
            attemptCount = row.attemptCount.toInt(),
            lastAttemptAt = row.lastAttemptAt,
            errorMessage = row.errorMessage,
            createdAt = row.createdAt,
        )
}
