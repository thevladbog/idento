package com.idento.data.localization

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Localization system for Idento mobile app
 * Supports English (en) and Russian (ru)
 */
object LocalizationManager {
    var currentLanguage by mutableStateOf("en")
        private set
    
    fun setLanguage(language: String) {
        currentLanguage = when (language) {
            "ru", "ru_RU", "ru-RU" -> "ru"
            else -> "en"
        }
    }
    
    fun getString(key: StringKey): String {
        return when (currentLanguage) {
            "ru" -> russianStrings[key] ?: englishStrings[key] ?: key.name
            else -> englishStrings[key] ?: key.name
        }
    }
}

/**
 * String keys for localization
 */
enum class StringKey {
    // Common
    WELCOME,
    LOGOUT,
    CANCEL,
    SAVE,
    DELETE,
    EDIT,
    CREATE,
    LOADING,
    SETTINGS,
    CLOSE,
    REFRESH,
    SEARCH,
    BACK,
    DONE,
    ERROR,
    SUCCESS,
    
    // Auth
    LOGIN,
    EMAIL,
    PASSWORD,
    SIGN_IN,
    SIGN_IN_WITH_EMAIL,
    SIGN_IN_WITH_QR,
    SIGNING_IN,
    LOGIN_FAILED,
    INVALID_CREDENTIALS,
    
    // Events
    EVENTS,
    NO_EVENTS,
    SELECT_EVENT,
    EVENT_DETAILS,
    
    // Attendees
    ATTENDEES,
    NO_ATTENDEES,
    SEARCH_ATTENDEE,
    SEARCH_BY_NAME_EMAIL_CODE,
    ATTENDEE_NOT_FOUND,
    VIEW_ALL_ATTENDEES,
    
    // Check-in
    CHECK_IN,
    CHECKED_IN,
    ALREADY_CHECKED_IN,
    CHECK_IN_SUCCESS,
    CHECK_IN_FAILED,
    CHECKIN_TIME,
    CHECKED_IN_BY,
    BLOCKED,
    
    // Zones
    SELECT_ZONE,
    SELECT_EVENT_DAY,
    ZONES,
    NO_ZONES,
    ZONE,
    REGISTRATION,
    GENERAL,
    WORKSHOP,
    TODAY,
    TOTAL,
    UNIQUE,
    RETRY,
    PACKET_DELIVERED,
    SCAN_ZONE_QR,
    
    // Printing
    PRINT_BADGE,
    PRINTING,
    PRINT_SETTINGS,
    PRINT_ON_CHECKIN,
    PRINT_ON_CHECKIN_DESC,
    PRINT_BY_BUTTON,
    PRINT_BY_BUTTON_DESC,
    
    // Settings
    APPEARANCE,
    LANGUAGE,
    THEME,
    THEME_LIGHT,
    THEME_DARK,
    THEME_SYSTEM,
    LANGUAGE_ENGLISH,
    LANGUAGE_RUSSIAN,
    LANGUAGE_SYSTEM,
    PRINTER_SETTINGS,
    SCANNER_SETTINGS,
    BLUETOOTH_PRINTER,
    ETHERNET_PRINTER,
    ADD_PRINTER_QR,
    TEST_PRINT,
    HARDWARE_SCANNER,
    CHECK_CONNECTION,
    CONNECTED,
    DISCONNECTED,
    NOT_CONFIGURED,
    
    // Template
    DISPLAY_SETTINGS,
    DISPLAY_TEMPLATE,
    TEMPLATE_EDITOR,
    BADGE_TEMPLATE,
    
    // Scanner
    TERMINAL_MODE,
    QR_SCANNER,
    SCAN_QR_CODE,
    
    // Misc
    ABOUT,
    VERSION,
}

/**
 * English translations
 */
private val englishStrings = mapOf(
    // Common
    StringKey.WELCOME to "Welcome to Idento",
    StringKey.LOGOUT to "Logout",
    StringKey.CANCEL to "Cancel",
    StringKey.SAVE to "Save",
    StringKey.DELETE to "Delete",
    StringKey.EDIT to "Edit",
    StringKey.CREATE to "Create",
    StringKey.LOADING to "Loading...",
    StringKey.SETTINGS to "Settings",
    StringKey.CLOSE to "Close",
    StringKey.REFRESH to "Refresh",
    StringKey.SEARCH to "Search",
    StringKey.BACK to "Back",
    StringKey.DONE to "Done",
    StringKey.ERROR to "Error",
    StringKey.SUCCESS to "Success",
    
    // Auth
    StringKey.LOGIN to "Login",
    StringKey.EMAIL to "Email",
    StringKey.PASSWORD to "Password",
    StringKey.SIGN_IN to "Sign In",
    StringKey.SIGN_IN_WITH_EMAIL to "Sign in with Email",
    StringKey.SIGN_IN_WITH_QR to "Sign in with QR Code",
    StringKey.SIGNING_IN to "Signing in...",
    StringKey.LOGIN_FAILED to "Login failed",
    StringKey.INVALID_CREDENTIALS to "Invalid email or password",
    
    // Events
    StringKey.EVENTS to "Events",
    StringKey.NO_EVENTS to "No events found",
    StringKey.SELECT_EVENT to "Select an event",
    StringKey.EVENT_DETAILS to "Event Details",
    
    // Attendees
    StringKey.ATTENDEES to "Attendees",
    StringKey.NO_ATTENDEES to "No attendees found",
    StringKey.SEARCH_ATTENDEE to "Search Attendee",
    StringKey.SEARCH_BY_NAME_EMAIL_CODE to "Search by name, email, or code...",
    StringKey.ATTENDEE_NOT_FOUND to "Attendee not found",
    StringKey.VIEW_ALL_ATTENDEES to "View All Attendees",
    
    // Check-in
    StringKey.CHECK_IN to "Check In",
    StringKey.CHECKED_IN to "Checked In",
    StringKey.ALREADY_CHECKED_IN to "Already Checked In",
    StringKey.CHECK_IN_SUCCESS to "Check-in Successful!",
    StringKey.CHECK_IN_FAILED to "Check-in Failed",
    StringKey.CHECKIN_TIME to "Check-in time",
    StringKey.CHECKED_IN_BY to "Checked in by",
    StringKey.BLOCKED to "Blocked",
    
    // Zones
    StringKey.SELECT_ZONE to "Select Zone",
    StringKey.SELECT_EVENT_DAY to "Select Event Day",
    StringKey.ZONES to "Zones",
    StringKey.NO_ZONES to "No zones available",
    StringKey.ZONE to "Zone",
    StringKey.REGISTRATION to "Registration",
    StringKey.GENERAL to "General",
    StringKey.WORKSHOP to "Workshop",
    StringKey.TODAY to "Today",
    StringKey.TOTAL to "Total",
    StringKey.UNIQUE to "Unique",
    StringKey.RETRY to "Retry",
    StringKey.PACKET_DELIVERED to "Packet Delivered",
    StringKey.SCAN_ZONE_QR to "Scan Zone QR Code",
    
    // Printing
    StringKey.PRINT_BADGE to "Print Badge",
    StringKey.PRINTING to "Printing...",
    StringKey.PRINT_SETTINGS to "Print Settings",
    StringKey.PRINT_ON_CHECKIN to "Print badge on check-in",
    StringKey.PRINT_ON_CHECKIN_DESC to "Automatically print when attendee is checked in",
    StringKey.PRINT_BY_BUTTON to "Print by button",
    StringKey.PRINT_BY_BUTTON_DESC to "Show \"Print Badge\" button instead of auto-print",
    
    // Settings
    StringKey.APPEARANCE to "Appearance",
    StringKey.LANGUAGE to "Language",
    StringKey.THEME to "Theme",
    StringKey.THEME_LIGHT to "Light",
    StringKey.THEME_DARK to "Dark",
    StringKey.THEME_SYSTEM to "System",
    StringKey.LANGUAGE_ENGLISH to "English",
    StringKey.LANGUAGE_RUSSIAN to "Русский",
    StringKey.LANGUAGE_SYSTEM to "System",
    StringKey.PRINTER_SETTINGS to "Printer Settings",
    StringKey.SCANNER_SETTINGS to "Scanner Settings",
    StringKey.BLUETOOTH_PRINTER to "Bluetooth Printer",
    StringKey.ETHERNET_PRINTER to "Ethernet Printer",
    StringKey.ADD_PRINTER_QR to "Add Printer via QR",
    StringKey.TEST_PRINT to "Test Print",
    StringKey.HARDWARE_SCANNER to "Hardware Scanner",
    StringKey.CHECK_CONNECTION to "Check Connection",
    StringKey.CONNECTED to "Connected",
    StringKey.DISCONNECTED to "Disconnected",
    StringKey.NOT_CONFIGURED to "Not Configured",
    
    // Template
    StringKey.DISPLAY_SETTINGS to "Display Settings",
    StringKey.DISPLAY_TEMPLATE to "Display Template",
    StringKey.TEMPLATE_EDITOR to "Template Editor",
    StringKey.BADGE_TEMPLATE to "Badge Template",
    
    // Scanner
    StringKey.TERMINAL_MODE to "Terminal Mode",
    StringKey.QR_SCANNER to "QR Scanner",
    StringKey.SCAN_QR_CODE to "Scan QR Code",
    
    // Misc
    StringKey.ABOUT to "About",
    StringKey.VERSION to "Version",
)

/**
 * Russian translations
 */
private val russianStrings = mapOf(
    // Common
    StringKey.WELCOME to "Добро пожаловать в Иденто",
    StringKey.LOGOUT to "Выйти",
    StringKey.CANCEL to "Отмена",
    StringKey.SAVE to "Сохранить",
    StringKey.DELETE to "Удалить",
    StringKey.EDIT to "Изменить",
    StringKey.CREATE to "Создать",
    StringKey.LOADING to "Загрузка...",
    StringKey.SETTINGS to "Настройки",
    StringKey.CLOSE to "Закрыть",
    StringKey.REFRESH to "Обновить",
    StringKey.SEARCH to "Поиск",
    StringKey.BACK to "Назад",
    StringKey.DONE to "Готово",
    StringKey.ERROR to "Ошибка",
    StringKey.SUCCESS to "Успешно",
    
    // Auth
    StringKey.LOGIN to "Вход",
    StringKey.EMAIL to "Email",
    StringKey.PASSWORD to "Пароль",
    StringKey.SIGN_IN to "Войти",
    StringKey.SIGN_IN_WITH_EMAIL to "Вход по email",
    StringKey.SIGN_IN_WITH_QR to "Вход по QR-коду",
    StringKey.SIGNING_IN to "Входим...",
    StringKey.LOGIN_FAILED to "Ошибка входа",
    StringKey.INVALID_CREDENTIALS to "Неверный email или пароль",
    
    // Events
    StringKey.EVENTS to "Мероприятия",
    StringKey.NO_EVENTS to "Мероприятия не найдены",
    StringKey.SELECT_EVENT to "Выберите мероприятие",
    StringKey.EVENT_DETAILS to "Детали мероприятия",
    
    // Attendees
    StringKey.ATTENDEES to "Участники",
    StringKey.NO_ATTENDEES to "Участники не найдены",
    StringKey.SEARCH_ATTENDEE to "Поиск участника",
    StringKey.SEARCH_BY_NAME_EMAIL_CODE to "Поиск по имени, email или коду...",
    StringKey.ATTENDEE_NOT_FOUND to "Участник не найден",
    StringKey.VIEW_ALL_ATTENDEES to "Все участники",
    
    // Check-in
    StringKey.CHECK_IN to "Зарегистрировать",
    StringKey.CHECKED_IN to "Зарегистрирован",
    StringKey.ALREADY_CHECKED_IN to "Уже зарегистрирован",
    StringKey.CHECK_IN_SUCCESS to "Регистрация успешна!",
    StringKey.CHECK_IN_FAILED to "Ошибка регистрации",
    StringKey.CHECKIN_TIME to "Время регистрации",
    StringKey.CHECKED_IN_BY to "Зарегистрировал",
    StringKey.BLOCKED to "Заблокирован",
    
    // Zones
    StringKey.SELECT_ZONE to "Выберите зону",
    StringKey.SELECT_EVENT_DAY to "Выберите день мероприятия",
    StringKey.ZONES to "Зоны",
    StringKey.NO_ZONES to "Зоны не доступны",
    StringKey.ZONE to "Зона",
    StringKey.REGISTRATION to "Регистрация",
    StringKey.GENERAL to "Общая",
    StringKey.WORKSHOP to "Семинар",
    StringKey.TODAY to "Сегодня",
    StringKey.TOTAL to "Всего",
    StringKey.UNIQUE to "Уникальных",
    StringKey.RETRY to "Повторить",
    StringKey.PACKET_DELIVERED to "Пакет выдан",
    StringKey.SCAN_ZONE_QR to "Сканировать QR-код зоны",
    
    // Printing
    StringKey.PRINT_BADGE to "Печать бейджа",
    StringKey.PRINTING to "Печатаем...",
    StringKey.PRINT_SETTINGS to "Настройки печати",
    StringKey.PRINT_ON_CHECKIN to "Печать при чекине",
    StringKey.PRINT_ON_CHECKIN_DESC to "Автоматически печатать бейдж при регистрации",
    StringKey.PRINT_BY_BUTTON to "Печать по кнопке",
    StringKey.PRINT_BY_BUTTON_DESC to "Показывать кнопку печати вместо автопечати",
    
    // Settings
    StringKey.APPEARANCE to "Внешний вид",
    StringKey.LANGUAGE to "Язык",
    StringKey.THEME to "Тема",
    StringKey.THEME_LIGHT to "Светлая",
    StringKey.THEME_DARK to "Тёмная",
    StringKey.THEME_SYSTEM to "Системная",
    StringKey.LANGUAGE_ENGLISH to "English",
    StringKey.LANGUAGE_RUSSIAN to "Русский",
    StringKey.LANGUAGE_SYSTEM to "Системный",
    StringKey.PRINTER_SETTINGS to "Настройки принтера",
    StringKey.SCANNER_SETTINGS to "Настройки сканера",
    StringKey.BLUETOOTH_PRINTER to "Bluetooth принтер",
    StringKey.ETHERNET_PRINTER to "Ethernet принтер",
    StringKey.ADD_PRINTER_QR to "Добавить принтер по QR",
    StringKey.TEST_PRINT to "Тестовая печать",
    StringKey.HARDWARE_SCANNER to "Аппаратный сканер",
    StringKey.CHECK_CONNECTION to "Проверить подключение",
    StringKey.CONNECTED to "Подключен",
    StringKey.DISCONNECTED to "Отключен",
    StringKey.NOT_CONFIGURED to "Не настроен",
    
    // Template
    StringKey.DISPLAY_SETTINGS to "Настройки отображения",
    StringKey.DISPLAY_TEMPLATE to "Шаблон отображения",
    StringKey.TEMPLATE_EDITOR to "Редактор шаблонов",
    StringKey.BADGE_TEMPLATE to "Шаблон бейджа",
    
    // Scanner
    StringKey.TERMINAL_MODE to "Терминальный режим",
    StringKey.QR_SCANNER to "QR сканер",
    StringKey.SCAN_QR_CODE to "Сканировать QR-код",
    
    // Misc
    StringKey.ABOUT to "О приложении",
    StringKey.VERSION to "Версия",
)

/**
 * Composable helper to get localized string
 */
@Composable
fun stringResource(key: StringKey): String = LocalizationManager.getString(key)

/**
 * Non-composable helper to get localized string
 */
fun getString(key: StringKey): String = LocalizationManager.getString(key)

/**
 * Strings object for easy access to localized strings
 */
object Strings {
    // Common
    val welcome get() = getString(StringKey.WELCOME)
    val logout get() = getString(StringKey.LOGOUT)
    val cancel get() = getString(StringKey.CANCEL)
    val save get() = getString(StringKey.SAVE)
    val delete get() = getString(StringKey.DELETE)
    val edit get() = getString(StringKey.EDIT)
    val create get() = getString(StringKey.CREATE)
    val loading get() = getString(StringKey.LOADING)
    val settings get() = getString(StringKey.SETTINGS)
    val close get() = getString(StringKey.CLOSE)
    val refresh get() = getString(StringKey.REFRESH)
    val search get() = getString(StringKey.SEARCH)
    val back get() = getString(StringKey.BACK)
    val done get() = getString(StringKey.DONE)
    val error get() = getString(StringKey.ERROR)
    val success get() = getString(StringKey.SUCCESS)
    
    // Auth
    val login get() = getString(StringKey.LOGIN)
    val email get() = getString(StringKey.EMAIL)
    val password get() = getString(StringKey.PASSWORD)
    val signIn get() = getString(StringKey.SIGN_IN)
    val signInWithEmail get() = getString(StringKey.SIGN_IN_WITH_EMAIL)
    val signInWithQR get() = getString(StringKey.SIGN_IN_WITH_QR)
    val signingIn get() = getString(StringKey.SIGNING_IN)
    val loginFailed get() = getString(StringKey.LOGIN_FAILED)
    val invalidCredentials get() = getString(StringKey.INVALID_CREDENTIALS)
    
    // Events
    val events get() = getString(StringKey.EVENTS)
    val noEvents get() = getString(StringKey.NO_EVENTS)
    val selectEvent get() = getString(StringKey.SELECT_EVENT)
    val eventDetails get() = getString(StringKey.EVENT_DETAILS)
    
    // Attendees
    val attendees get() = getString(StringKey.ATTENDEES)
    val noAttendees get() = getString(StringKey.NO_ATTENDEES)
    val searchAttendee get() = getString(StringKey.SEARCH_ATTENDEE)
    val searchByNameEmailCode get() = getString(StringKey.SEARCH_BY_NAME_EMAIL_CODE)
    val attendeeNotFound get() = getString(StringKey.ATTENDEE_NOT_FOUND)
    val viewAllAttendees get() = getString(StringKey.VIEW_ALL_ATTENDEES)
    
    // Check-in
    val checkIn get() = getString(StringKey.CHECK_IN)
    val checkedIn get() = getString(StringKey.CHECKED_IN)
    val alreadyCheckedIn get() = getString(StringKey.ALREADY_CHECKED_IN)
    val checkInSuccess get() = getString(StringKey.CHECK_IN_SUCCESS)
    val checkInFailed get() = getString(StringKey.CHECK_IN_FAILED)
    val checkinTime get() = getString(StringKey.CHECKIN_TIME)
    val checkedInBy get() = getString(StringKey.CHECKED_IN_BY)
    val blocked get() = getString(StringKey.BLOCKED)
    
    // Zones
    val selectZone get() = getString(StringKey.SELECT_ZONE)
    val selectEventDay get() = getString(StringKey.SELECT_EVENT_DAY)
    val zones get() = getString(StringKey.ZONES)
    val noZones get() = getString(StringKey.NO_ZONES)
    val zone get() = getString(StringKey.ZONE)
    val registration get() = getString(StringKey.REGISTRATION)
    val general get() = getString(StringKey.GENERAL)
    val workshop get() = getString(StringKey.WORKSHOP)
    val today get() = getString(StringKey.TODAY)
    val total get() = getString(StringKey.TOTAL)
    val unique get() = getString(StringKey.UNIQUE)
    val retry get() = getString(StringKey.RETRY)
    val packetDelivered get() = getString(StringKey.PACKET_DELIVERED)
    val scanZoneQR get() = getString(StringKey.SCAN_ZONE_QR)
    
    // Printing
    val printBadge get() = getString(StringKey.PRINT_BADGE)
    val printing get() = getString(StringKey.PRINTING)
    val printSettings get() = getString(StringKey.PRINT_SETTINGS)
    val printOnCheckin get() = getString(StringKey.PRINT_ON_CHECKIN)
    val printOnCheckinDesc get() = getString(StringKey.PRINT_ON_CHECKIN_DESC)
    val printByButton get() = getString(StringKey.PRINT_BY_BUTTON)
    val printByButtonDesc get() = getString(StringKey.PRINT_BY_BUTTON_DESC)
}
