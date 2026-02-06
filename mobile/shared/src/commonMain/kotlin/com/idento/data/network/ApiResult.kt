package com.idento.data.network

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
