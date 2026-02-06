package com.idento.presentation.theme

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.idento.data.preferences.AppPreferences

/**
 * Global theme state holder for instant theme switching
 * Without app restart
 */
object ThemeState {
    var currentTheme by mutableStateOf(AppPreferences.THEME_SYSTEM)
        private set
    
    fun setTheme(theme: String) {
        currentTheme = theme
    }
}

