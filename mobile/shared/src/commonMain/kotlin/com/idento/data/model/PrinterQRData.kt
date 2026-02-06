package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PrinterQRData(
    @SerialName("type") val type: String,
    @SerialName("version") val version: String,
    @SerialName("printer_type") val printer_type: String,
    @SerialName("name") val name: String,
    @SerialName("address") val address: String? = null,
    @SerialName("ip") val ip: String? = null,
    @SerialName("port") val port: Int? = null,
    @SerialName("model") val model: String? = null,
    @SerialName("location") val location: String? = null,
    @SerialName("settings") val settings: PrinterSettings? = null
) {
    companion object {
        const val TYPE_IDENTIFIER = "idento_printer"
        const val TYPE_VERSION = "1.0"
        const val TYPE_BLUETOOTH = "bluetooth"
        const val TYPE_ETHERNET = "ethernet"
        const val DEFAULT_PORT = 9100
        
        private val MAC_ADDRESS_REGEX = Regex("^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$")
        private val IP_ADDRESS_REGEX = Regex("^((25[0-5]|(2[0-4]|1\\d|[1-9]|\\d)\\.?)){4}$")
    }
    
    fun isValid(): Boolean {
        if (type != TYPE_IDENTIFIER) return false
        if (name.isBlank()) return false
        
        return when (printer_type) {
            TYPE_BLUETOOTH -> {
                address != null && MAC_ADDRESS_REGEX.matches(address)
            }
            TYPE_ETHERNET -> {
                ip != null && IP_ADDRESS_REGEX.matches(ip) &&
                (port == null || port in 1..65535)
            }
            else -> false
        }
    }
    
    fun getPort(): Int = port ?: DEFAULT_PORT
    
    fun getDescription(): String = buildString {
        append(name)
        when (printer_type) {
            TYPE_BLUETOOTH -> address?.let { append(" ($it)") }
            TYPE_ETHERNET -> ip?.let { append(" ($it:${getPort()})") }
        }
        model?.let { append(" - $it") }
        location?.let { append(" @ $it") }
    }
}

@Serializable
data class PrinterSettings(
    @SerialName("dpi") val dpi: Int? = 203,
    @SerialName("label_width") val labelWidth: Int? = 54,
    @SerialName("label_height") val labelHeight: Int? = 86,
    @SerialName("darkness") val darkness: Int? = 15
)

sealed class PrinterQRResult {
    data class Success(val data: PrinterQRData) : PrinterQRResult()
    data class InvalidType(val actualType: String) : PrinterQRResult()
    data object InvalidFormat : PrinterQRResult()
    data class ValidationFailed(val reason: String) : PrinterQRResult()
}
