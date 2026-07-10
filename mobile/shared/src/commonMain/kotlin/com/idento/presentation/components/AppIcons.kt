package com.idento.presentation.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * Vendored subset of the Material Design icons used across the shared Compose UI.
 *
 * Compose Multiplatform stopped publishing the Material icons artifacts after 1.7.3, so rather than
 * pinning the frozen `material-icons-extended:1.7.3` dependency we ship the ~24 icons we actually
 * use as plain [ImageVector]s built from the upstream 24dp `filled` path data.
 *
 * Icon path data comes from the Material Design icons, licensed under Apache-2.0.
 * https://github.com/google/material-design-icons
 *
 * Migration from the old `androidx.compose.material.icons.Icons.*` API:
 *   `Icons.Default.X`             -> `AppIcons.X`
 *   `Icons.AutoMirrored.Filled.X` -> `AppIcons.AutoMirrored.X`
 */
object AppIcons {

    val Build: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Build",
            "M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9c-2-2-5-2.4-7.4-1.3L9 6L6 9L1.6 4.7C.4 7.1.9 " +
                "10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-" +
                "1.1.1-1.4z",
        )
    }

    val Check: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon("Check", "M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41z")
    }

    val CheckCircle: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "CheckCircle",
            "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5l1.41-" +
                "1.41L10 14.17l7.59-7.59L19 8l-9 9z",
        )
    }

    val Close: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Close",
            "M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L1" +
                "9 17.59L13.41 12z",
        )
    }

    val Create: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon("Create", CREATE_PATH)
    }

    val DateRange: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "DateRange",
            "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9" +
                "-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z",
        )
    }

    val Delete: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Delete",
            "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
        )
    }

    val Edit: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon("Edit", CREATE_PATH)
    }

    val Face: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Face",
            "M9 11.75a1.25 1.25 0 1 0 0 2.5a1.25 1.25 0 0 0 0-2.5zm6 0a1.25 1.25 0 1 0 0 2.5a1.25 " +
                "1.25 0 0 0 0-2.5zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 1" +
                "2 2zm0 18c-4.41 0-8-3.59-8-8c0-.29.02-.58.05-.86c2.36-1.05 4.23-2.98 5.21-5.37a" +
                "9.974 9.974 0 0 0 10.41 3.97c.21.71.33 1.47.33 2.26c0 4.41-3.59 8-8 8z",
        )
    }

    val Info: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Info",
            "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0" +
                "-8h-2V7h2v2z",
        )
    }

    val KeyboardArrowRight: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon("KeyboardArrowRight", KEYBOARD_ARROW_RIGHT_PATH)
    }

    val LocationOn: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon("LocationOn", PLACE_PATH)
    }

    val MoreVert: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "MoreVert",
            "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9" +
                " 2-2s-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2z",
        )
    }

    val Person: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Person",
            "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4s-4 1.79-4 4s1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v" +
                "2h16v-2c0-2.66-5.33-4-8-4z",
        )
    }

    val Phone: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Phone",
            "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24c1.12.37 2." +
                "33.57 3.57.57c.55 0 1 .45 1 1V20c0 .55-.45 1-1 1c-9.39 0-17-7.61-17-17c0-.55.45" +
                "-1 1-1h3.5c.55 0 1 .45 1 1c0 1.25.2 2.45.57 3.57c.11.35.03.74-.25 1.02l-2.2 2.2z",
        )
    }

    val Place: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon("Place", PLACE_PATH)
    }

    val Refresh: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Refresh",
            "M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84" +
                "-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3" +
                ".14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
        )
    }

    val Search: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Search",
            "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59" +
                " 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 " +
                "5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z",
        )
    }

    val Settings: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Settings",
            "M19.14 12.94c.04-.3.06-.61.06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-." +
                "61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.5" +
                "4a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1" +
                ".62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58" +
                "c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12" +
                ".22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c" +
                ".24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59" +
                "-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-" +
                "3.6s1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6s-1.62 3.6-3.6 3.6z",
        )
    }

    val Star: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon(
            "Star",
            "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2L9.19 8.63L2 9.24l5.46 4.73L5.82" +
                " 21z",
        )
    }

    val Warning: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
        materialIcon("Warning", "M1 21h22L12 2L1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z")
    }

    /**
     * Icons that are visually flipped in right-to-left layouts. Mirrors the old
     * `Icons.AutoMirrored.Filled.*` accessors — same path data, `autoMirror = true`.
     */
    object AutoMirrored {

        val ArrowBack: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
            materialIcon(
                "AutoMirrored.ArrowBack",
                "M20 11H7.83l5.59-5.59L12 4l-8 8l8 8l1.41-1.41L7.83 13H20v-2z",
                autoMirror = true,
            )
        }

        val ExitToApp: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
            materialIcon(
                "AutoMirrored.ExitToApp",
                "M10.09 15.59L11.5 17l5-5l-5-5l-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 " +
                    "2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9" +
                    "-2-2-2z",
                autoMirror = true,
            )
        }

        val KeyboardArrowRight: ImageVector by lazy(LazyThreadSafetyMode.NONE) {
            materialIcon(
                "AutoMirrored.KeyboardArrowRight",
                KEYBOARD_ARROW_RIGHT_PATH,
                autoMirror = true,
            )
        }
    }
}

// Path data shared by icons that Material defines identically.
private const val CREATE_PATH =
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a" +
        ".996.996 0 0 0-1.41 0l-1.83 1.83l3.75 3.75l1.83-1.83z"

private const val PLACE_PATH =
    "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0" +
        "-5a2.5 2.5 0 0 1 0 5z"

private const val KEYBOARD_ARROW_RIGHT_PATH =
    "M8.59 16.59L13.17 12L8.59 7.41L10 6l6 6l-6 6l-1.41-1.41z"

/**
 * Builds a 24dp Material-style [ImageVector] from an SVG path string, mirroring the geometry the
 * old `material-icons` `materialIcon { materialPath { ... } }` helper produced.
 */
private fun materialIcon(
    name: String,
    pathData: String,
    autoMirror: Boolean = false,
): ImageVector =
    ImageVector.Builder(
        name = "Idento.$name",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
        autoMirror = autoMirror,
    ).apply {
        addPath(
            pathData = PathParser().parsePathString(pathData).toNodes(),
            fill = SolidColor(Color.Black),
        )
    }.build()
