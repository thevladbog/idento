package com.idento.data.network

import io.ktor.client.call.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Like [runCatching], but rethrows [CancellationException] instead of wrapping it in
 * [Result.failure] — cancelling a suspend API call must actually cancel the coroutine.
 */
suspend inline fun <T> apiRunCatching(crossinline block: suspend () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        Result.failure(e)
    }

/**
 * Error response shape returned by the backend on non-2xx responses.
 */
@Serializable
data class ApiErrorResponse(
    val error: String? = null,
    val message: String? = null
)

/** Thrown by [bodyOrThrow] for a non-2xx response, carrying the backend's own error message. */
class ApiException(val status: HttpStatusCode, message: String) : Exception(message)

@PublishedApi
internal val apiErrorJson = Json { ignoreUnknownKeys = true }

/**
 * Deserializes a successful response as [T]. On a non-2xx response, parses the body as
 * [ApiErrorResponse] instead of [T] and throws [ApiException] with the backend's own message —
 * calling plain [io.ktor.client.call.body] here would otherwise try to deserialize the error body
 * (e.g. `{"error": "..."}`) as the success DTO and fail with a confusing [SerializationException]
 * about missing fields, hiding the backend's actual error message from the caller.
 */
suspend inline fun <reified T> HttpResponse.bodyOrThrow(): T {
    if (status.isSuccess()) return body()
    val text = bodyAsText()
    val parsed = try {
        apiErrorJson.decodeFromString<ApiErrorResponse>(text)
    } catch (e: SerializationException) {
        null
    }
    val message = (parsed?.error ?: parsed?.message ?: text).ifBlank { status.description }
    throw ApiException(status, message)
}

/**
 * Sealed class for API call results
 * Better type-safety than Result<T>
 */
sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Error(val exception: Throwable, val message: String? = null) : ApiResult<Nothing>()
    data object Loading : ApiResult<Nothing>()
}

/**
 * Extension functions for easier handling
 */
inline fun <T> ApiResult<T>.onSuccess(action: (T) -> Unit): ApiResult<T> {
    if (this is ApiResult.Success) action(data)
    return this
}

inline fun <T> ApiResult<T>.onError(action: (Throwable) -> Unit): ApiResult<T> {
    if (this is ApiResult.Error) action(exception)
    return this
}

inline fun <T> ApiResult<T>.onLoading(action: () -> Unit): ApiResult<T> {
    if (this is ApiResult.Loading) action()
    return this
}

/**
 * Convert Result<T> to ApiResult<T>
 */
fun <T> Result<T>.toApiResult(): ApiResult<T> {
    return fold(
        onSuccess = { ApiResult.Success(it) },
        onFailure = { ApiResult.Error(it, it.message) }
    )
}

/**
 * Map ApiResult to another type
 */
inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> {
    return when (this) {
        is ApiResult.Success -> ApiResult.Success(transform(data))
        is ApiResult.Error -> ApiResult.Error(exception, message)
        is ApiResult.Loading -> ApiResult.Loading
    }
}

/**
 * Get data or null
 */
fun <T> ApiResult<T>.getOrNull(): T? {
    return when (this) {
        is ApiResult.Success -> data
        else -> null
    }
}

/**
 * Get data or throw exception
 */
fun <T> ApiResult<T>.getOrThrow(): T {
    return when (this) {
        is ApiResult.Success -> data
        is ApiResult.Error -> throw exception
        is ApiResult.Loading -> throw IllegalStateException("Result is still loading")
    }
}

/**
 * Get data or default value
 */
fun <T> ApiResult<T>.getOrDefault(default: T): T {
    return when (this) {
        is ApiResult.Success -> data
        else -> default
    }
}
