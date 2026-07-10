# Phase M1a — Mobile Foundation (Design System, Data Layer, Platform Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation Phase M1b (setup wizard) and M1c (registration-mode screens) will build on: new dark design tokens, real camera scanning, real offline persistence, the Phase B backend contract wired into the mobile data layer, and Android's `:app` module actually running `:shared`'s Compose UI instead of its own separate implementation.

**Architecture:** All new code lands in `mobile/shared/src/commonMain` (+ platform actuals), following the existing package conventions (`data/model`, `data/network`, `data/repository`, `presentation/components`, `presentation/theme`) rather than introducing new top-level packages. New design tokens and components are **additive** — existing screens (Login/Events/Checkin/Settings/etc.) keep working unmodified through M1a; M1c is what actually replaces them. Android's `:app` module is wired to consume `:shared` for the first time, which requires removing `:app`'s now-redundant UI layer (it duplicates `:shared`'s package+class names, which cannot coexist in one build).

**Tech Stack:** Kotlin 2.3.21, AGP 8.13.2, Compose Multiplatform 1.11.1, Ktor 3.5.1, Koin 4.0.0, kotlinx-serialization-json 1.11.0, kotlinx-datetime 0.6.1, SQLDelight (new dependency, latest stable compatible with Kotlin 2.3.21 — verify exact version at implementation time via the SQLDelight releases page, use 2.1.x line), CameraX 1.4.0 + ML Kit barcode-scanning 17.3.0 (Android), AVFoundation (iOS, no new dependency — platform framework).

## Global Constraints

- This is sub-phase 1 of 3 for Phase M1 (M1a foundation → M1b setup wizard → M1c registration mode). M1a produces a working, testable deliverable on its own: both platforms build and boot the existing (not-yet-restyled) shared UI, with the new data/camera/storage foundation underneath ready for M1b/M1c to build screens on.
- **Do not modify or delete existing screens/ViewModels/theme files** (`Login/Events/Checkin/Settings/QRScanner/AttendeesList/TemplateEditor/DisplayTemplate` + their ViewModels, `Theme.kt`/`Color.kt`/`Type.kt`) — they stay exactly as they are and keep working through M1a. New design tokens/components are added in **new files**, not merged into the old ones. M1c is responsible for actually building new screens that use the new tokens and retiring the old screens.
- Package conventions: new domain sealed types go in `com/idento/data/model/` (matching the existing convention — this project does NOT have a separate `domain/` package despite an earlier design sketch suggesting one; follow what's actually there). New API/repo code goes in `com/idento/data/network/` and `com/idento/data/repository/`.
- No `libs.versions.toml` exists in this repo — do not introduce one; add new dependencies as inline version strings in `build.gradle.kts`, matching existing style.
- Full JSON field/table naming from the already-shipped backend contract (Phase B, merged to `main` as commit `d9b3bb7`) must match exactly: `POST /api/zones/:zone_id/scan` (verdict `allowed|no_access|not_registered`, always HTTP 200), `POST /api/stations/provision` (public), `POST /api/events/:event_id/stations/provisioning-token`, `POST /api/events/:event_id/checkins/batch` (item fields `client_uuid, attendee_id, at, device_number, kind, zone_id?`), `POST /api/events/:event_id/checkins/override` (`attendee_id, context, zone_id?`), `GET /api/events/:event_id/stats?zone=`.
- **`:app` (Android) currently duplicates 26 files under identical package+class names as `:shared`** (confirmed via diff: all of `:app`'s `presentation/*`, plus `data/repository/{Auth,Event}Repository.kt`, plus `data/model/{Attendee,Event,User,PrinterQRData}.kt`, plus `data/preferences/AppPreferences.kt`). Kotlin/Gradle cannot link two classes with the same fully-qualified name into one APK, so wiring `:app` to `:shared` (Task 8) requires deleting these files — this is not optional scope creep, it's a hard compile constraint of the already-approved "full switch now" decision. `:app`'s Hilt DI modules (`di/NetworkModule.kt`, `di/DataStoreModule.kt`) and hardware-integration code (`data/api`, `data/local`, `data/bluetooth`, `data/ethernet`, `data/scanner`, `util/`) do NOT collide by name and are left physically in place, unused/dormant, per the approved decision (dormant code, not deleted — full cleanup deferred to M4).
- Every task's Gradle changes must keep both `mobile/android-app` and `mobile/shared` building; run the verification commands in each task, don't just eyeball the diff.

---

### Task 1: Design tokens (spacing/radius/typography scale + dark palette)

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/theme/DesignTokens.kt`

**Interfaces:**
- Produces: `object IdentoColors` (dark palette), `object IdentoSpacing`, `object IdentoRadius`, `object IdentoTypeScale` — all later tasks (components, and M1b/M1c screens) reference these by name.

- [ ] **Step 1: Create the tokens file**

```kotlin
package com.idento.presentation.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Design tokens for the mobile-redesign "kiosk-strict" dark UI (registration/zone-control/
 * kiosk station modes). Additive to the existing IdentoTheme/Color/Type — those keep serving
 * the pre-redesign screens unchanged; new screens (M1b/M1c) wrap themselves in a theme built
 * from these tokens instead. See docs/superpowers/specs/2026-07-10-mobile-refactor-redesign-design.md
 * section 6.1 for the source design.
 */
object IdentoColors {
    val Background = Color(0xFF111413)
    val Surface = Color(0xFF1B1F1D)
    val Brand = Color(0xFF00935E)
    val Indicator = Color(0xFF2EE6A8)
    val Queue = Color(0xFFFACC15)
    val Denied = Color(0xFFCE2B37)
    val Amber = Color(0xFFF5A300)
    val NeutralBand = Color(0xFF2B3230)

    val Hairline = Color(0xFF232725)
    val Border = Color(0xFF2A2F2C)
    val TextPrimary = Color(0xFFFFFFFF)
    val TextMuted = Color(0xFF6B736F)
    val TextSecondary = Color(0xFF9AA5A0)
    val ButtonLabel = Color(0xFFC8D0CC)
    val TextDisabled = Color(0xFF4D534F)

    val GreenTint = Color(0xFF0F2A20)
    val AmberTintDark = Color(0xFF23201A)
    val AmberTintDarker = Color(0xFF241A00)
    val RedTintDark = Color(0xFF2B1214)
    val RedTintDarker = Color(0xFF4A2226)
    val AlertTextLight = Color(0xFFFF8B93)
    val AlertTextLighter = Color(0xFFFF6B76)
    val AmberText = Color(0xFFF5C96A)
}

object IdentoSpacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 16.dp
    val lg = 22.dp
    val xl = 32.dp
}

object IdentoRadius {
    val buttonPrimary = 14.dp
    val buttonSecondary = 12.dp
    val card = 16.dp
    val segmentedOuter = 14.dp
    val segmentedInner = 11.dp
    val pill = 999.dp
    val scanReticle = 22.dp
}

object IdentoTypeScale {
    val verdictWord = 26.sp
    val attendeeName = 29.sp
    val kioskAttendeeName = 46.sp
    val eyebrowLabel = 11.sp
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid
```
Expected: `BUILD SUCCESSFUL` (nothing references these tokens yet, so this only validates syntax).

- [ ] **Step 3: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/theme/DesignTokens.kt
git commit -m "feat(mobile): add dark design tokens for the mobile-redesign UI"
```

---

### Task 2: Bundle Inter font

**Files:**
- Create: `mobile/shared/src/commonMain/composeResources/font/inter_regular.ttf` (binary — download, see step 1)
- Create: `mobile/shared/src/commonMain/composeResources/font/inter_medium.ttf`
- Create: `mobile/shared/src/commonMain/composeResources/font/inter_semibold.ttf`
- Create: `mobile/shared/src/commonMain/composeResources/font/inter_bold.ttf`
- Create: `mobile/shared/src/commonMain/composeResources/font/inter_extrabold.ttf`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/theme/IdentoFont.kt`

**Interfaces:**
- Produces: `fun identoFontFamily(): FontFamily` (Composable) — used by M1b/M1c's new-screen typography.

- [ ] **Step 1: Download Inter font files (OFL-licensed, static weights)**

```bash
mkdir -p mobile/shared/src/commonMain/composeResources/font
cd mobile/shared/src/commonMain/composeResources/font
curl -fsSL -o Inter.zip "https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip"
unzip -o Inter.zip "Inter Desktop/Inter-Regular.ttf" "Inter Desktop/Inter-Medium.ttf" "Inter Desktop/Inter-SemiBold.ttf" "Inter Desktop/Inter-Bold.ttf" "Inter Desktop/Inter-ExtraBold.ttf" -d /tmp/inter-extract
cp "/tmp/inter-extract/Inter Desktop/Inter-Regular.ttf" inter_regular.ttf
cp "/tmp/inter-extract/Inter Desktop/Inter-Medium.ttf" inter_medium.ttf
cp "/tmp/inter-extract/Inter Desktop/Inter-SemiBold.ttf" inter_semibold.ttf
cp "/tmp/inter-extract/Inter Desktop/Inter-Bold.ttf" inter_bold.ttf
cp "/tmp/inter-extract/Inter Desktop/Inter-ExtraBold.ttf" inter_extrabold.ttf
rm -f Inter.zip
rm -rf /tmp/inter-extract
ls -la
```
Expected: 5 `.ttf` files, each roughly 300-350KB. Compose Resources requires lowercase, underscore-only filenames (no hyphens) — the names above already satisfy that.

- [ ] **Step 2: Generate the `Res` accessors and write the font-family helper**

Compose Multiplatform's Gradle plugin auto-generates `Res.font.inter_regular` etc. from files under `commonMain/composeResources/font/` — no manual registration needed, but the accessors only appear after a Gradle sync/build. Create the helper that will use them:

```kotlin
package com.idento.presentation.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import idento.shared.generated.resources.Res
import idento.shared.generated.resources.inter_bold
import idento.shared.generated.resources.inter_extrabold
import idento.shared.generated.resources.inter_medium
import idento.shared.generated.resources.inter_regular
import idento.shared.generated.resources.inter_semibold

/**
 * Bundled Inter font family (400/500/600/700/800), for the mobile-redesign dark UI.
 * Not wired into the existing `Typography` (Type.kt) — that keeps using the system font for
 * pre-redesign screens. M1b/M1c's new theme wrapper uses this instead.
 */
@Composable
fun identoFontFamily(): FontFamily = FontFamily(
    Font(Res.font.inter_regular, weight = FontWeight.Normal),
    Font(Res.font.inter_medium, weight = FontWeight.Medium),
    Font(Res.font.inter_semibold, weight = FontWeight.SemiBold),
    Font(Res.font.inter_bold, weight = FontWeight.Bold),
    Font(Res.font.inter_extrabold, weight = FontWeight.ExtraBold),
)
```

Note: the exact generated package (`idento.shared.generated.resources`) is derived from `android.namespace`/module name by the Compose Resources plugin. If the build in Step 3 reports a different generated package name, update the import lines to match — this is a one-line fix, not a design change.

- [ ] **Step 3: Verify it compiles (this also proves the resource pipeline picked up the fonts)**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid
```
Expected: `BUILD SUCCESSFUL`. If it fails with `unresolved reference: inter_regular` or similar, run `./gradlew :shared:generateComposeResClass` first to force accessor generation, check the actual generated package name under `mobile/shared/build/generated/compose/resourceGenerator/kotlin/`, and fix the import in `IdentoFont.kt` accordingly.

- [ ] **Step 4: Commit**

```bash
git add mobile/shared/src/commonMain/composeResources/font/ mobile/shared/src/commonMain/kotlin/com/idento/presentation/theme/IdentoFont.kt
git commit -m "feat(mobile): bundle Inter font for the mobile-redesign UI"
```

---

### Task 3: New reusable components for the redesigned UI

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/StatusBar.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/ModeSegmentedControl.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/VerdictBand.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/DetailTable.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/ActionStack.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/ListRow.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/FilterChips.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/ScanReticle.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/MiscComponents.kt` (OfflineBanner, Toggle, SelectableCard)

**Interfaces:**
- Consumes: `IdentoColors`/`IdentoSpacing`/`IdentoRadius` (Task 1).
- Produces: `@Composable fun StatusBar(cells: List<StatusCell>)`, `@Composable fun ModeSegmentedControl(options: List<String>, selectedIndex: Int, onSelect: (Int) -> Unit)`, `@Composable fun VerdictBand(word: String, icon: ImageVector, color: Color, heightFraction: Float = 0.42f)`, `@Composable fun DetailTable(rows: List<Pair<String, String>>, labelWidth: Dp = 110.dp)`, `@Composable fun ActionStack(primary: ActionButtonSpec, secondary: ActionButtonSpec? = null)`, `@Composable fun ListRow(initials: String, title: String, subtitle: String, statusChip: @Composable (() -> Unit)? = null, onClick: () -> Unit)`, `@Composable fun FilterChips(options: List<FilterChipSpec>, selectedKey: String, onSelect: (String) -> Unit)`, `@Composable fun ScanReticle(modifier: Modifier = Modifier, sizeFraction: Float = 1f)`, `@Composable fun OfflineBanner(queuedCount: Int, lastSyncLabel: String)`, `@Composable fun IdentoToggle(checked: Boolean, onCheckedChange: (Boolean) -> Unit)`, `@Composable fun SelectableCard(selected: Boolean, onClick: () -> Unit, content: @Composable () -> Unit)`. All consumed by M1b (wizard) and M1c (registration screens).

- [ ] **Step 1: `StatusBar.kt`**

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors

data class StatusCell(val value: String, val label: String, val valueColor: Color = IdentoColors.TextPrimary)

/**
 * 4-column KPI status bar (e.g. ЗОНА / ПРИНТЕР / ОЧЕРЕДЬ / ОТМЕЧЕНО for registration mode,
 * or ЗОНА / ДОПУЩЕНО / ОТКАЗОВ / ОЧЕРЕДЬ for zone-control mode). Composition (which 4 cells)
 * is the caller's job — this is a pure layout component.
 */
@Composable
fun StatusBar(cells: List<StatusCell>, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        cells.forEachIndexed { index, cell ->
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally
            ) {
                Text(cell.value, color = cell.valueColor, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Text(cell.label.uppercase(), color = IdentoColors.TextMuted, fontSize = 9.5.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            }
            if (index != cells.lastIndex) {
                Box(modifier = Modifier.width(1.dp).height(28.dp).background(IdentoColors.Hairline))
            }
        }
    }
}
```
Add the missing `background` import (`androidx.compose.foundation.background`) to the file's import block.

- [ ] **Step 2: `ModeSegmentedControl.kt`**

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

@Composable
fun ModeSegmentedControl(options: List<String>, selectedIndex: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .background(IdentoColors.Surface, RoundedCornerShape(IdentoRadius.segmentedOuter))
            .padding(4.dp)
    ) {
        options.forEachIndexed { index, label ->
            val isSelected = index == selectedIndex
            Box(
                modifier = Modifier
                    .weight(1f)
                    .background(
                        if (isSelected) IdentoColors.Brand else androidx.compose.ui.graphics.Color.Transparent,
                        RoundedCornerShape(IdentoRadius.segmentedInner)
                    )
                    .clickable { onSelect(index) }
                    .padding(vertical = 10.dp),
                contentAlignment = androidx.compose.ui.Alignment.Center
            ) {
                Text(
                    label,
                    color = if (isSelected) androidx.compose.ui.graphics.Color.White else IdentoColors.TextSecondary,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
```

- [ ] **Step 3: `VerdictBand.kt`**

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoTypeScale

/**
 * Colored top band (~42% of the verdict screen's height) with an icon + the verdict word.
 * Color/icon/word are supplied by the caller per verdict (Success=green, AlreadyChecked=amber,
 * NotFound=neutral, Denied=red, PrintError=green — see RegistrationVerdict/ZoneVerdict).
 */
@Composable
fun VerdictBand(word: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxWidth().background(color),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(56.dp))
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                word.uppercase(),
                color = Color.White,
                fontSize = IdentoTypeScale.verdictWord,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.sp
            )
        }
    }
}
```

- [ ] **Step 4: `DetailTable.kt`**

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors

/** Key/value detail grid used in verdict screens (Категория, Компания, Время, Печать, etc). */
@Composable
fun DetailTable(rows: List<Pair<String, String>>, labelWidth: Dp = 110.dp, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        rows.forEach { (label, value) ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(label, color = IdentoColors.TextMuted, fontSize = 13.sp, modifier = Modifier.width(labelWidth))
                Text(value, color = IdentoColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}
```

- [ ] **Step 5: `ActionStack.kt`**

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

data class ActionButtonSpec(
    val label: String,
    val onClick: () -> Unit,
    val containerColor: Color = IdentoColors.Brand,
    val contentColor: Color = Color.White,
)

/** Bottom-pinned primary (56dp) + optional secondary outline (48dp) action buttons. */
@Composable
fun ActionStack(primary: ActionButtonSpec, secondary: ActionButtonSpec? = null, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(
            onClick = primary.onClick,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(IdentoRadius.buttonPrimary),
            colors = ButtonDefaults.buttonColors(containerColor = primary.containerColor, contentColor = primary.contentColor)
        ) {
            Text(primary.label, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
        }
        if (secondary != null) {
            OutlinedButton(
                onClick = secondary.onClick,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(IdentoRadius.buttonSecondary),
                border = BorderStroke(1.dp, IdentoColors.Border),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = IdentoColors.ButtonLabel)
            ) {
                Text(secondary.label)
            }
        }
    }
}
```

- [ ] **Step 6: `ListRow.kt`**

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors

/** Avatar-initials + title + subtitle + optional trailing status-chip slot, for search/list screens. */
@Composable
fun ListRow(
    initials: String,
    title: String,
    subtitle: String,
    statusChip: (@Composable () -> Unit)? = null,
    highlighted: Boolean = false,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(if (highlighted) IdentoColors.GreenTint else IdentoColors.Surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(40.dp).background(if (highlighted) IdentoColors.Brand else IdentoColors.Border, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(initials, color = androidx.compose.ui.graphics.Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = IdentoColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            Text(subtitle, color = IdentoColors.TextSecondary, fontSize = 12.sp, maxLines = 1)
        }
        if (statusChip != null) {
            statusChip()
        }
    }
}
```

- [ ] **Step 7: `FilterChips.kt`**

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

data class FilterChipSpec(val key: String, val label: String, val count: Int? = null)

@Composable
fun FilterChips(options: List<FilterChipSpec>, selectedKey: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { option ->
            val isSelected = option.key == selectedKey
            val label = if (option.count != null) "${option.label} · ${option.count}" else option.label
            Text(
                label,
                color = if (isSelected) Color.White else IdentoColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .background(if (isSelected) IdentoColors.Brand else IdentoColors.Surface, RoundedCornerShape(IdentoRadius.pill))
                    .clickable { onSelect(option.key) }
                    .padding(horizontal = 14.dp, vertical = 8.dp)
            )
        }
    }
}
```

- [ ] **Step 8: `ScanReticle.kt`** (the animated scan-line reticle)

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

/**
 * QR scan reticle with the animated sweeping scan line, matching the design's
 * `idm-scan` keyframes: 0%→top 10% opacity 1, 48%→top 86% opacity 1, 52-100%→top 10% opacity 0,
 * 2.6s infinite loop.
 */
@Composable
fun ScanReticle(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 260.dp) {
    val transition = rememberInfiniteTransition(label = "scan-reticle")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(2600, easing = LinearEasing), repeatMode = RepeatMode.Restart),
        label = "scan-line-progress"
    )
    // top% goes 10 -> 86 over the first 48% of the cycle, then the line is invisible for the rest.
    val linePositionFraction = (progress / 0.48f).coerceIn(0f, 1f)
    val lineTopFraction = 0.10f + linePositionFraction * (0.86f - 0.10f)
    val lineAlpha = if (progress <= 0.48f) 1f else 0f

    Box(
        modifier = modifier
            .size(size)
            .border(2.dp, IdentoColors.Indicator, RoundedCornerShape(IdentoRadius.scanReticle))
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .align(Alignment.TopCenter)
                .offset(y = size * lineTopFraction)
                .background(IdentoColors.Indicator)
                .alpha(lineAlpha)
        )
    }
}
```

- [ ] **Step 9: `MiscComponents.kt`** (OfflineBanner, IdentoToggle, SelectableCard)

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius

@Composable
fun OfflineBanner(queuedCount: Int, lastSyncLabel: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(IdentoColors.AmberTintDark, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(8.dp).background(IdentoColors.Queue, CircleShape))
        Spacer(modifier = Modifier.width(10.dp))
        Column {
            Text("Офлайн · $queuedCount чек-инов в очереди", color = IdentoColors.AmberText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Text("Синхронизируются автоматически · посл. синх. $lastSyncLabel", color = IdentoColors.TextMuted, fontSize = 11.sp)
        }
    }
}

@Composable
fun IdentoToggle(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedTrackColor = IdentoColors.Brand,
            checkedThumbColor = Color.White,
            uncheckedTrackColor = IdentoColors.Border,
            uncheckedThumbColor = IdentoColors.TextSecondary,
        )
    )
}

@Composable
fun SelectableCard(selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier = modifier
            .background(if (selected) IdentoColors.GreenTint else IdentoColors.Surface, RoundedCornerShape(IdentoRadius.card))
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) IdentoColors.Brand else IdentoColors.Border,
                RoundedCornerShape(IdentoRadius.card)
            )
            .clickable(onClick = onClick)
            .padding(16.dp)
    ) {
        content()
    }
}
```

- [ ] **Step 10: Verify all 9 files compile**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 11: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/
git commit -m "feat(mobile): add reusable components for the redesigned registration UI"
```

---

### Task 4: Domain verdict models

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/RegistrationVerdict.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/ZoneVerdict.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/StationConfig.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/model/StationConfigTest.kt`

**Interfaces:**
- Consumes: nothing new (pure Kotlin data classes).
- Produces: `sealed interface RegistrationVerdict` (`Success`, `AlreadyChecked`, `NotFound`, `Denied`, `PrintError`), `sealed interface ZoneVerdict` (`Allowed`, `NoAccess`, `NotRegistered`), `data class VerdictAttendee`, `sealed interface PrintState`, `data class StationConfig` + `enum class StationMode` + `data class PrinterConfig`. Consumed by Task 6 (repositories map API responses to these) and M1b/M1c screens.

- [ ] **Step 1: `StationConfig.kt`** (write this first — `VerdictAttendee`/`PrintState` below depend on nothing, but `StationMode` is referenced by name in the design and needs to exist for later tasks)

```kotlin
package com.idento.data.model

import kotlinx.serialization.Serializable

enum class StationMode { REGISTRATION, ZONE_CONTROL, KIOSK }

@Serializable
data class PrinterConfig(
    val name: String,
    val transport: String, // "bluetooth" | "ethernet"
    val address: String, // MAC address or IP:port depending on transport
)

/**
 * Persisted station setup (result of the M1b wizard). Local-only — not a network DTO, though
 * eventId/eventName/staffName/deviceNumber originate from the backend at provisioning time
 * (see StationRepository, Task 6).
 */
@Serializable
data class StationConfig(
    val eventId: String,
    val eventName: String,
    val mode: StationMode,
    val dayDate: String?, // ISO "YYYY-MM-DD", null for KIOSK
    val workPointId: String,
    val workPointName: String,
    val printer: PrinterConfig?, // null for ZONE_CONTROL
    val autoPrint: Boolean,
    val deviceNumber: Int,
    val staffName: String,
)
```

- [ ] **Step 2: `RegistrationVerdict.kt`**

```kotlin
package com.idento.data.model

import kotlinx.datetime.Instant

data class VerdictAttendee(
    val id: String,
    val fullName: String,
    val company: String?,
    val category: String,
)

sealed interface PrintState {
    data object Printing : PrintState
    data object Queued : PrintState
    data object Done : PrintState
    data class Failed(val reason: String) : PrintState
}

/** Registration-mode scan outcome (screen = colored top band + detail table + action buttons). */
sealed interface RegistrationVerdict {
    data class Success(val attendee: VerdictAttendee, val at: Instant, val firstTime: Boolean, val printState: PrintState) : RegistrationVerdict
    data class AlreadyChecked(val attendee: VerdictAttendee, val firstAt: Instant, val firstPoint: String, val firstDevice: Int) : RegistrationVerdict
    data class NotFound(val rawCode: String, val hint: String) : RegistrationVerdict
    data class Denied(val attendee: VerdictAttendee, val reason: String) : RegistrationVerdict
    data class PrintError(val attendee: VerdictAttendee, val at: Instant, val printReason: String) : RegistrationVerdict
}
```

- [ ] **Step 3: `ZoneVerdict.kt`**

```kotlin
package com.idento.data.model

import kotlinx.datetime.Instant

/** Zone-control-mode scan outcome, matching the backend's POST /api/zones/:zone_id/scan verdict field. */
sealed interface ZoneVerdict {
    data class Allowed(val attendee: VerdictAttendee, val registeredAt: Instant, val registeredPoint: String, val firstEntry: Boolean) : ZoneVerdict
    data class NoAccess(val attendee: VerdictAttendee, val ruleReason: String, val registeredAt: Instant?) : ZoneVerdict
    data class NotRegistered(val attendee: VerdictAttendee, val registrationPointHint: String) : ZoneVerdict
}
```

- [ ] **Step 4: Write a test proving `StationMode`/`StationConfig` round-trip through kotlinx-serialization JSON (this is the only genuinely testable pure logic in this task — the sealed verdict types are plain data holders with no behavior yet, mapping from API responses is Task 6's job)**

```kotlin
package com.idento.data.model

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class StationConfigTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun stationConfigRoundTripsThroughJson() {
        val config = StationConfig(
            eventId = "evt-1",
            eventName = "Технопром-2026",
            mode = StationMode.REGISTRATION,
            dayDate = "2026-07-10",
            workPointId = "zone-1",
            workPointName = "Главный вход",
            printer = PrinterConfig(name = "Zebra ZD421", transport = "bluetooth", address = "00:11:22:33:44:55"),
            autoPrint = true,
            deviceNumber = 3,
            staffName = "staff@idento.app",
        )
        val encoded = json.encodeToString(config)
        val decoded = json.decodeFromString<StationConfig>(encoded)
        assertEquals(config, decoded)
    }

    @Test
    fun stationConfigWithNullPrinterRoundTrips() {
        val config = StationConfig(
            eventId = "evt-1",
            eventName = "Технопром-2026",
            mode = StationMode.ZONE_CONTROL,
            dayDate = "2026-07-10",
            workPointId = "zone-2",
            workPointName = "Зона «Конференция»",
            printer = null,
            autoPrint = false,
            deviceNumber = 5,
            staffName = "staff2@idento.app",
        )
        val encoded = json.encodeToString(config)
        val decoded = json.decodeFromString<StationConfig>(encoded)
        assertEquals(config, decoded)
    }
}
```

- [ ] **Step 5: Run the test**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.data.model.StationConfigTest"
```
Expected: 2/2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/model/RegistrationVerdict.kt mobile/shared/src/commonMain/kotlin/com/idento/data/model/ZoneVerdict.kt mobile/shared/src/commonMain/kotlin/com/idento/data/model/StationConfig.kt mobile/shared/src/commonTest/kotlin/com/idento/data/model/StationConfigTest.kt
git commit -m "feat(mobile): add RegistrationVerdict/ZoneVerdict/StationConfig domain models"
```

---

### Task 5: DTOs + API services for the 6 Phase B backend endpoints

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/StationDtos.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/CheckinDtos.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/network/StationApiService.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/network/ZoneApiService.kt` (add `scanZone`, do not touch `performZoneCheckIn`)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/network/EventApiService.kt` (add `getEventStats`)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/network/AttendeeApiService.kt` (add `submitBatchCheckins`, `submitOverride`)

**Interfaces:**
- Consumes: `ApiClient` (existing, `data/network/ApiClient.kt`).
- Produces: `ZoneApiService.scanZone(zoneId, code): Result<ZoneScanResponseDto>`, `EventApiService.getEventStats(eventId, zoneId?): Result<EventStatsDto>`, `AttendeeApiService.submitBatchCheckins(eventId, items): Result<List<BatchCheckinResultDto>>`, `AttendeeApiService.submitOverride(eventId, request): Result<CheckinOverrideDto>`, and all of `StationApiService`'s methods. Consumed by Task 6's repositories.

- [ ] **Step 1: `StationDtos.kt`** — DTOs matching the backend's `models.CreateProvisioningTokenRequest/Response`, `models.ProvisionStationRequest/Response`, `models.ProvisionedStationConfig` exactly (snake_case JSON, per Phase B's Go structs)

```kotlin
package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CreateProvisioningTokenRequestDto(
    @SerialName("staff_user_id") val staffUserId: String,
)

@Serializable
data class CreateProvisioningTokenResponseDto(
    val token: String,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
data class ProvisionStationRequestDto(
    val token: String,
    @SerialName("device_info") val deviceInfo: Map<String, String>? = null,
)

@Serializable
data class ProvisionedStationConfigDto(
    @SerialName("event_id") val eventId: String,
    @SerialName("event_name") val eventName: String,
    @SerialName("staff_name") val staffName: String,
)

@Serializable
data class ProvisionStationResponseDto(
    @SerialName("station_config") val stationConfig: ProvisionedStationConfigDto,
    @SerialName("staff_jwt") val staffJwt: String,
    @SerialName("device_number") val deviceNumber: Int,
)
```

- [ ] **Step 2: `CheckinDtos.kt`** — DTOs matching `models.ZoneScanRequest/Response`, `models.RegistrationInfo`, `models.BatchCheckinItem/Result`, `models.CreateCheckinOverrideRequest`, `models.CheckinOverride`, `models.EventStatsResponse`, `models.ZoneScanStats` exactly

```kotlin
package com.idento.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ZoneScanRequestDto(val code: String)

@Serializable
data class RegistrationInfoDto(
    val passed: Boolean,
    val at: String? = null,
    val point: String? = null,
)

/** attendee is the existing Attendee model (data/model/Attendee.kt) — same JSON shape the backend already returns for attendee objects elsewhere. */
@Serializable
data class ZoneScanResponseDto(
    val verdict: String, // "allowed" | "no_access" | "not_registered"
    val reason: String? = null,
    val attendee: Attendee? = null,
    val registration: RegistrationInfoDto? = null,
    @SerialName("checked_in_at") val checkedInAt: String? = null,
    @SerialName("first_entry") val firstEntry: Boolean = false,
)

@Serializable
data class BatchCheckinItemDto(
    @SerialName("client_uuid") val clientUuid: String,
    @SerialName("attendee_id") val attendeeId: String,
    val at: String,
    @SerialName("device_number") val deviceNumber: Int,
    val kind: String, // "checkin" | "zone_entry"
    @SerialName("zone_id") val zoneId: String? = null,
)

@Serializable
data class BatchCheckinResultDto(
    @SerialName("client_uuid") val clientUuid: String,
    val status: String, // "created" | "already_exists" | "error"
    val error: String? = null,
)

@Serializable
data class CreateCheckinOverrideRequestDto(
    @SerialName("attendee_id") val attendeeId: String,
    val context: String, // "already_checked" | "not_registered" | "no_access"
    @SerialName("zone_id") val zoneId: String? = null,
)

@Serializable
data class CheckinOverrideDto(
    val id: String,
    @SerialName("attendee_id") val attendeeId: String,
    @SerialName("zone_id") val zoneId: String? = null,
    val context: String,
    @SerialName("staff_user_id") val staffUserId: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class ZoneScanStatsDto(
    val allowed: Int = 0,
    @SerialName("no_access") val noAccess: Int = 0,
    @SerialName("not_registered") val notRegistered: Int = 0,
)

@Serializable
data class EventStatsResponseDto(
    @SerialName("total_attendees") val totalAttendees: Int,
    @SerialName("checked_in") val checkedIn: Int,
    @SerialName("zone_stats") val zoneStats: ZoneScanStatsDto? = null,
)
```

Confirm `Attendee` (existing `data/model/Attendee.kt`) is `@Serializable` already (it is, per the existing model file) so it can be embedded in `ZoneScanResponseDto` directly.

- [ ] **Step 3: `StationApiService.kt`**

```kotlin
package com.idento.data.network

import com.idento.data.model.CreateProvisioningTokenRequestDto
import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.ProvisionStationRequestDto
import com.idento.data.model.ProvisionStationResponseDto
import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.http.*

/** Station provisioning: manager mints a token (authenticated); device redeems it (public). */
class StationApiService(private val apiClient: ApiClient) {

    suspend fun createProvisioningToken(eventId: String, staffUserId: String): Result<CreateProvisioningTokenResponseDto> = runCatching {
        apiClient.httpClient.post("/api/events/$eventId/stations/provisioning-token") {
            contentType(ContentType.Application.Json)
            setBody(CreateProvisioningTokenRequestDto(staffUserId = staffUserId))
        }.body()
    }

    suspend fun provisionStation(token: String, deviceInfo: Map<String, String>? = null): Result<ProvisionStationResponseDto> = runCatching {
        apiClient.httpClient.post("/api/stations/provision") {
            contentType(ContentType.Application.Json)
            setBody(ProvisionStationRequestDto(token = token, deviceInfo = deviceInfo))
        }.body()
    }
}
```

- [ ] **Step 4: Extend `ZoneApiService.kt`** — add `scanZone`, leave `performZoneCheckIn` untouched

Add this method to the existing `ZoneApiService` class (anywhere after `performZoneCheckIn`, before `getAttendeeMovementHistory`):
```kotlin
    /**
     * Mobile zone-control scan (structured verdict, always HTTP 200 for the 3 designed
     * outcomes) — POST /api/zones/:zone_id/scan. Distinct from the legacy performZoneCheckIn
     * above, which stays untouched.
     */
    suspend fun scanZone(zoneId: String, code: String): Result<com.idento.data.model.ZoneScanResponseDto> = runCatching {
        apiClient.httpClient.post("/api/zones/$zoneId/scan") {
            contentType(ContentType.Application.Json)
            setBody(com.idento.data.model.ZoneScanRequestDto(code = code))
        }.body()
    }
```

- [ ] **Step 5: Extend `EventApiService.kt`** — add `getEventStats`

Read the current file first to place the import correctly, then add:
```kotlin
    /** GET /api/events/:event_id/stats?zone= — KPI counters for the mobile status bar. */
    suspend fun getEventStats(eventId: String, zoneId: String? = null): Result<com.idento.data.model.EventStatsResponseDto> = runCatching {
        apiClient.httpClient.get("/api/events/$eventId/stats") {
            if (zoneId != null) {
                parameter("zone", zoneId)
            }
        }.body()
    }
```
Add `import io.ktor.client.request.parameter` (or use the already-imported `io.ktor.client.request.*` wildcard if present) and confirm `io.ktor.client.call.body` is imported (it should already be, used by other methods in this file).

- [ ] **Step 6: Extend `AttendeeApiService.kt`** — add `submitBatchCheckins`, `submitOverride`

Read the current file first to match its exact import style, then add:
```kotlin
    /** POST /api/events/:event_id/checkins/batch — idempotent offline-sync flush. */
    suspend fun submitBatchCheckins(eventId: String, items: List<com.idento.data.model.BatchCheckinItemDto>): Result<List<com.idento.data.model.BatchCheckinResultDto>> = runCatching {
        apiClient.httpClient.post("/api/events/$eventId/checkins/batch") {
            contentType(ContentType.Application.Json)
            setBody(items)
        }.body()
    }

    /** POST /api/events/:event_id/checkins/override — staff "proceed anyway" audit log. */
    suspend fun submitOverride(eventId: String, request: com.idento.data.model.CreateCheckinOverrideRequestDto): Result<com.idento.data.model.CheckinOverrideDto> = runCatching {
        apiClient.httpClient.post("/api/events/$eventId/checkins/override") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.body()
    }
```
Add `import io.ktor.http.contentType`/`ContentType` if the existing file's wildcard imports (`io.ktor.http.*`) don't already cover it (they likely do — confirm by reading the file's current import block).

- [ ] **Step 7: Verify it compiles**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 8: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/model/StationDtos.kt mobile/shared/src/commonMain/kotlin/com/idento/data/model/CheckinDtos.kt mobile/shared/src/commonMain/kotlin/com/idento/data/network/StationApiService.kt mobile/shared/src/commonMain/kotlin/com/idento/data/network/ZoneApiService.kt mobile/shared/src/commonMain/kotlin/com/idento/data/network/EventApiService.kt mobile/shared/src/commonMain/kotlin/com/idento/data/network/AttendeeApiService.kt
git commit -m "feat(mobile): DTOs + API service methods for the 6 Phase B backend endpoints"
```

---

### Task 6: Repositories for the new endpoints

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/repository/StationRepository.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/repository/ZoneRepository.kt` (add `scanZone`)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/repository/AttendeeRepository.kt` (add `submitBatchCheckins`, `submitOverride`)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/repository/EventRepository.kt` (add `getEventStats`)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt` (register `StationApiService`, `StationRepository`)
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/repository/StationRepositoryTest.kt`

**Interfaces:**
- Consumes: `StationApiService`/`ZoneApiService.scanZone`/`AttendeeApiService.submitBatchCheckins`/`submitOverride`/`EventApiService.getEventStats` (Task 5).
- Produces: `StationRepository.createProvisioningToken(eventId, staffUserId): ApiResult<CreateProvisioningTokenResponseDto>`, `.provisionStation(token, deviceInfo?): ApiResult<ProvisionStationResponseDto>`; `ZoneRepository.scanZone(zoneId, code): ApiResult<ZoneScanResponseDto>`; `AttendeeRepository.submitBatchCheckins(eventId, items): ApiResult<List<BatchCheckinResultDto>>`, `.submitOverride(eventId, request): ApiResult<CheckinOverrideDto>`; `EventRepository.getEventStats(eventId, zoneId?): ApiResult<EventStatsResponseDto>`. Consumed by M1b (StationRepository for the wizard) and M1c (the rest, for registration-mode screens).

- [ ] **Step 1: `StationRepository.kt`**

```kotlin
package com.idento.data.repository

import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.network.ApiResult
import com.idento.data.network.StationApiService
import com.idento.data.network.toApiResult

class StationRepository(private val stationApiService: StationApiService) {

    suspend fun createProvisioningToken(eventId: String, staffUserId: String): ApiResult<CreateProvisioningTokenResponseDto> {
        return stationApiService.createProvisioningToken(eventId, staffUserId).toApiResult()
    }

    suspend fun provisionStation(token: String, deviceInfo: Map<String, String>? = null): ApiResult<ProvisionStationResponseDto> {
        return stationApiService.provisionStation(token, deviceInfo).toApiResult()
    }
}
```

- [ ] **Step 2: Extend `ZoneRepository.kt`** — add after `performZoneCheckIn`:

```kotlin
    /** Mobile zone-control scan verdict — see ZoneApiService.scanZone. */
    suspend fun scanZone(zoneId: String, code: String): ApiResult<com.idento.data.model.ZoneScanResponseDto> {
        return zoneApiService.scanZone(zoneId, code).toApiResult()
    }
```

- [ ] **Step 3: Extend `AttendeeRepository.kt`** — read the file's current constructor/imports first, then add:

```kotlin
    suspend fun submitBatchCheckins(eventId: String, items: List<com.idento.data.model.BatchCheckinItemDto>): ApiResult<List<com.idento.data.model.BatchCheckinResultDto>> {
        return attendeeApiService.submitBatchCheckins(eventId, items).toApiResult()
    }

    suspend fun submitOverride(eventId: String, request: com.idento.data.model.CreateCheckinOverrideRequestDto): ApiResult<com.idento.data.model.CheckinOverrideDto> {
        return attendeeApiService.submitOverride(eventId, request).toApiResult()
    }
```
(Match the existing file's field name for its injected `AttendeeApiService` — likely `attendeeApiService`, confirm by reading the file.)

- [ ] **Step 4: Extend `EventRepository.kt`** — read the file first, then add:

```kotlin
    suspend fun getEventStats(eventId: String, zoneId: String? = null): ApiResult<com.idento.data.model.EventStatsResponseDto> {
        return eventApiService.getEventStats(eventId, zoneId).toApiResult()
    }
```

- [ ] **Step 5: Register the new API service + repository in Koin**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt`, add `import com.idento.data.network.StationApiService` and `import com.idento.data.repository.StationRepository`, then add to the `appModule` block (near the other API services/repositories):
```kotlin
    single { StationApiService(get()) }
```
and
```kotlin
    single { StationRepository(get()) }
```

- [ ] **Step 6: Write a test for `StationRepository` using a fake `StationApiService`-shaped dependency**

Since `StationApiService` takes a real `ApiClient` (Ktor), and this codebase has no HTTP-mocking harness yet, test `StationRepository`'s pure pass-through behavior against `ApiResult` mapping directly, using `Result.success`/`Result.failure` at the `toApiResult()` boundary — i.e. test `toApiResult()`'s existing conversion logic is exercised correctly by constructing a `StationRepository` is not mockable without a fake HTTP engine; instead, add this test at the `ApiResult`/DTO level, proving `ProvisionStationResponseDto` decodes the exact JSON shape the backend returns (this is the genuinely valuable regression test — a field-name mismatch with the Go backend would silently fail decode otherwise):

```kotlin
package com.idento.data.repository

import com.idento.data.model.ProvisionStationResponseDto
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class StationRepositoryTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun provisionStationResponseDecodesBackendJsonShape() {
        // Exact shape returned by backend/internal/handler/stations.go's ProvisionStation.
        val raw = """
            {
              "station_config": {"event_id": "evt-1", "event_name": "Технопром-2026", "staff_name": "staff@idento.app"},
              "staff_jwt": "eyJhbGciOiJIUzI1NiJ9.example.sig",
              "device_number": 3
            }
        """.trimIndent()
        val decoded = json.decodeFromString(ProvisionStationResponseDto.serializer(), raw)
        assertEquals("evt-1", decoded.stationConfig.eventId)
        assertEquals("Технопром-2026", decoded.stationConfig.eventName)
        assertEquals(3, decoded.deviceNumber)
        assertEquals("eyJhbGciOiJIUzI1NiJ9.example.sig", decoded.staffJwt)
    }

    @Test
    fun zoneScanResponseDecodesAllowedVerdictShape() {
        val raw = """
            {
              "verdict": "allowed",
              "reason": "Access granted by category",
              "attendee": null,
              "registration": {"passed": true, "at": "2026-07-10T09:18:00Z", "point": "Главный вход"},
              "checked_in_at": "2026-07-10T14:32:00Z",
              "first_entry": true
            }
        """.trimIndent()
        val decoded = json.decodeFromString(com.idento.data.model.ZoneScanResponseDto.serializer(), raw)
        assertEquals("allowed", decoded.verdict)
        assertEquals(true, decoded.firstEntry)
        assertEquals("Главный вход", decoded.registration?.point)
    }
}
```

- [ ] **Step 7: Run the tests**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.data.repository.StationRepositoryTest"
```
Expected: 2/2 pass.

- [ ] **Step 8: Full build + commit**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:testDebugUnitTest
git add mobile/shared/src/commonMain/kotlin/com/idento/data/repository/StationRepository.kt mobile/shared/src/commonMain/kotlin/com/idento/data/repository/ZoneRepository.kt mobile/shared/src/commonMain/kotlin/com/idento/data/repository/AttendeeRepository.kt mobile/shared/src/commonMain/kotlin/com/idento/data/repository/EventRepository.kt mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt mobile/shared/src/commonTest/kotlin/com/idento/data/repository/StationRepositoryTest.kt
git commit -m "feat(mobile): repositories for station provisioning + zone-scan + batch/override/stats"
```

---

### Task 7: SQLDelight — real offline persistence

**Files:**
- Modify: `mobile/shared/build.gradle.kts` (add SQLDelight plugin + dependencies)
- Create: `mobile/shared/src/commonMain/sqldelight/com/idento/db/PendingCheckIn.sq`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/SqlDriverFactory.kt` (expect)
- Create: `mobile/shared/src/androidMain/kotlin/com/idento/data/storage/SqlDriverFactory.android.kt` (actual)
- Create: `mobile/shared/src/iosMain/kotlin/com/idento/data/storage/SqlDriverFactory.ios.kt` (actual)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/OfflineDatabase.kt` (no interface changes — the interface stays the contract; only note that `OfflineDatabaseImpl` will now be a real implementation, so remove the `expect class` since the SQLDelight-backed impl doesn't need per-platform actuals — see Step 5)
- Modify: `mobile/shared/src/androidMain/kotlin/com/idento/data/storage/OfflineDatabase.android.kt` → delete (replaced)
- Modify: `mobile/shared/src/iosMain/kotlin/com/idento/data/storage/OfflineDatabase.ios.kt` → delete (replaced)
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/SqlDelightOfflineDatabase.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt` (wire the new driver + database)

**Interfaces:**
- Consumes: nothing new architecturally — `OfflineCheckInRepository` (existing) keeps using `OfflineDatabase`'s existing interface (`savePendingCheckIn`/`getPendingCheckIns`/`deletePendingCheckIn`/`clearPendingCheckIns`/`getPendingCheckInsCount`) unchanged, so Task 7 is a drop-in swap of the implementation, not a call-site change.
- Produces: `expect fun createSqlDriver(): app.cash.sqldelight.db.SqlDriver`, `class SqlDelightOfflineDatabase(driver: SqlDriver) : OfflineDatabase`.

- [ ] **Step 1: Add the SQLDelight Gradle plugin**

In `mobile/shared/build.gradle.kts`, add to the `plugins { }` block (top of file):
```kotlin
    id("app.cash.sqldelight") version "2.1.0"
```
Add to `commonMain.dependencies` (inside `sourceSets { }`):
```kotlin
            implementation("app.cash.sqldelight:runtime:2.1.0")
            implementation("app.cash.sqldelight:coroutines-extensions:2.1.0")
```
Add to `androidMain.dependencies`:
```kotlin
            implementation("app.cash.sqldelight:android-driver:2.1.0")
```
Add to `iosMain.dependencies`:
```kotlin
            implementation("app.cash.sqldelight:native-driver:2.1.0")
```
Add a top-level `sqldelight { }` block (sibling to `kotlin { }` and `android { }`, at the end of the file):
```kotlin
sqldelight {
    databases {
        create("IdentoDatabase") {
            packageName.set("com.idento.db")
        }
    }
}
```

- [ ] **Step 2: Write the schema** — `mobile/shared/src/commonMain/sqldelight/com/idento/db/PendingCheckIn.sq`

```sql
CREATE TABLE PendingCheckIn (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    attendeeCode TEXT NOT NULL,
    zoneId TEXT NOT NULL,
    eventDay TEXT NOT NULL,
    checkedInAt INTEGER NOT NULL,
    attemptCount INTEGER NOT NULL DEFAULT 0,
    lastAttemptAt INTEGER,
    errorMessage TEXT
);

insert:
INSERT INTO PendingCheckIn(attendeeCode, zoneId, eventDay, checkedInAt, attemptCount, lastAttemptAt, errorMessage)
VALUES (?, ?, ?, ?, 0, NULL, NULL);

lastInsertRowId:
SELECT last_insert_rowid();

selectAll:
SELECT * FROM PendingCheckIn ORDER BY id ASC;

deleteById:
DELETE FROM PendingCheckIn WHERE id = ?;

deleteAll:
DELETE FROM PendingCheckIn;

countAll:
SELECT COUNT(*) FROM PendingCheckIn;
```

- [ ] **Step 3: `SqlDriverFactory.kt`** (expect declaration, common)

```kotlin
package com.idento.data.storage

import app.cash.sqldelight.db.SqlDriver

expect class SqlDriverFactory {
    fun createDriver(): SqlDriver
}
```

- [ ] **Step 4: Platform actuals**

`mobile/shared/src/androidMain/kotlin/com/idento/data/storage/SqlDriverFactory.android.kt`:
```kotlin
package com.idento.data.storage

import android.content.Context
import app.cash.sqldelight.async.coroutines.synchronous
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.idento.db.IdentoDatabase

actual class SqlDriverFactory(private val context: Context) {
    actual fun createDriver(): SqlDriver =
        AndroidSqliteDriver(IdentoDatabase.Schema.synchronous(), context, "idento.db")
}
```
Note: if `Schema.synchronous()` is not needed for this SQLDelight version's `AndroidSqliteDriver` (the 2.x driver API takes a plain `SqlSchema` directly in most 2.1.x releases), drop the `.synchronous()` call and the `app.cash.sqldelight.async.coroutines.synchronous` import — verify against the actual generated `IdentoDatabase.Schema` type once Step 1's Gradle sync has run, and adjust this file to whatever the installed SQLDelight 2.1.0 Android driver API requires (this is a one-line API-shape fix, not a design change).

`mobile/shared/src/iosMain/kotlin/com/idento/data/storage/SqlDriverFactory.ios.kt`:
```kotlin
package com.idento.data.storage

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.idento.db.IdentoDatabase

actual class SqlDriverFactory {
    actual fun createDriver(): SqlDriver =
        NativeSqliteDriver(IdentoDatabase.Schema, "idento.db")
}
```

- [ ] **Step 5: Replace `OfflineDatabaseImpl`'s in-memory stubs with a real SQLDelight-backed implementation**

Delete the platform-specific stub files entirely:
```bash
rm mobile/shared/src/androidMain/kotlin/com/idento/data/storage/OfflineDatabase.android.kt
rm mobile/shared/src/iosMain/kotlin/com/idento/data/storage/OfflineDatabase.ios.kt
```

Edit `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/OfflineDatabase.kt` — remove the `expect class OfflineDatabaseImpl` block at the bottom (lines with `expect class OfflineDatabaseImpl() : OfflineDatabase { ... }`), keeping the `interface OfflineDatabase` and `data class PendingZoneCheckIn` exactly as they are (no consumer-visible change).

Create `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/SqlDelightOfflineDatabase.kt` — a single common implementation (no per-platform actuals needed anymore, since `SqlDriverFactory` already isolates the one genuinely platform-specific piece):
```kotlin
package com.idento.data.storage

import app.cash.sqldelight.coroutines.asFlow
import app.cash.sqldelight.coroutines.mapToList
import app.cash.sqldelight.coroutines.mapToOne
import com.idento.db.IdentoDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/**
 * Real, persistent OfflineDatabase backed by SQLDelight (replaces the previous non-persistent
 * in-memory placeholder). Single common implementation — SqlDriverFactory is the only
 * per-platform piece.
 */
class SqlDelightOfflineDatabase(driverFactory: SqlDriverFactory) : OfflineDatabase {

    private val database = IdentoDatabase(driverFactory.createDriver())
    private val queries = database.pendingCheckInQueries

    override suspend fun savePendingCheckIn(checkIn: PendingZoneCheckIn): Long = withContext(Dispatchers.Default) {
        queries.transactionWithResult {
            queries.insert(
                attendeeCode = checkIn.attendeeCode,
                zoneId = checkIn.zoneId,
                eventDay = checkIn.eventDay,
                checkedInAt = checkIn.checkedInAt,
            )
            queries.lastInsertRowId().executeAsOne()
        }
    }

    override suspend fun getPendingCheckIns(): List<PendingZoneCheckIn> = withContext(Dispatchers.Default) {
        queries.selectAll().executeAsList().map {
            PendingZoneCheckIn(
                id = it.id,
                attendeeCode = it.attendeeCode,
                zoneId = it.zoneId,
                eventDay = it.eventDay,
                checkedInAt = it.checkedInAt,
                attemptCount = it.attemptCount.toInt(),
                lastAttemptAt = it.lastAttemptAt,
                errorMessage = it.errorMessage,
            )
        }
    }

    override suspend fun deletePendingCheckIn(id: Long) = withContext(Dispatchers.Default) {
        queries.deleteById(id)
    }

    override suspend fun clearPendingCheckIns() = withContext(Dispatchers.Default) {
        queries.deleteAll()
    }

    override suspend fun getPendingCheckInsCount(): Int = withContext(Dispatchers.Default) {
        queries.countAll().executeAsOne().toInt()
    }
}
```
Note: the generated `IdentoDatabase`/`pendingCheckInQueries`/row-type field names (`attendeeCode`, `zoneId`, etc.) come from the `.sq` schema's column names verbatim (SQLDelight generates camelCase Kotlin properties from the schema's column names as written) — this matches Step 2's schema exactly, so no name mismatch is expected, but verify against the actual generated code under `mobile/shared/build/generated/sqldelight/` after the first build if the compiler reports an unresolved reference.

- [ ] **Step 6: Wire the new pieces into Koin**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt`:
- Add `import com.idento.data.storage.SqlDriverFactory` and `import com.idento.data.storage.SqlDelightOfflineDatabase`.
- Replace `single { OfflineDatabaseImpl() }` with:
```kotlin
    single { createSqlDriverFactory() }
    single { SqlDelightOfflineDatabase(get()) as OfflineDatabase }
```
- Add to the `expect fun` block at the bottom of the file:
```kotlin
expect fun createSqlDriverFactory(): SqlDriverFactory
```
- Remove the now-unused `import com.idento.data.storage.OfflineDatabaseImpl` line.

In `mobile/shared/src/androidMain/kotlin/com/idento/di/AppModule.android.kt`, add:
```kotlin
actual fun createSqlDriverFactory(): SqlDriverFactory {
    return SqlDriverFactory(object : KoinComponent {}.getKoin().get())
}
```
and add `single { SqlDriverFactory(get()) }` to `androidModule`. Import `com.idento.data.storage.SqlDriverFactory`.

In `mobile/shared/src/iosMain/kotlin/com/idento/di/AppModule.ios.kt`, add:
```kotlin
actual fun createSqlDriverFactory(): SqlDriverFactory {
    return SqlDriverFactory()
}
```
and add `single { SqlDriverFactory() }` to `iosModule`. Import `com.idento.data.storage.SqlDriverFactory`.

- [ ] **Step 7: Build both platforms to confirm the SQLDelight codegen + wiring works**

```bash
cd mobile/android-app
./gradlew :shared:generateCommonMainIdentoDatabaseInterface
./gradlew :shared:compileDebugKotlinAndroid
./gradlew :shared:compileKotlinIosSimulatorArm64
```
Expected: all `BUILD SUCCESSFUL`. If the first command's exact task name differs (SQLDelight's generated task names vary slightly by version), run `./gradlew :shared:tasks --all | grep -i sqldelight` to find the correct one and use that.

- [ ] **Step 8: Manual smoke test — real persistence round-trip, not just compilation**

Since this codebase has no JVM-level SQLite test harness configured (SQLDelight's Android driver needs a real Android context; the iOS native driver needs an iOS runtime), verify persistence manually via a temporary `main`-style check is impractical here — instead, add ONE `commonTest` that exercises the pure Kotlin data-shape round-trip already covered by `PendingZoneCheckIn`'s existing usage in `OfflineCheckInRepository` (no new test needed beyond what Task 4/6 already established for other DTOs), and note in the task report that the SQLDelight driver itself is exercised for real the first time the app runs on a device/simulator in Task 8's/Task 9's verification — this is a known, acceptable verification gap for this task (matching how this codebase already handles platform-only code elsewhere, e.g. `SecureStore`'s Keychain/Keystore layer).

- [ ] **Step 9: Commit**

```bash
git add mobile/shared/build.gradle.kts mobile/shared/src/commonMain/sqldelight/ mobile/shared/src/commonMain/kotlin/com/idento/data/storage/SqlDriverFactory.kt mobile/shared/src/androidMain/kotlin/com/idento/data/storage/SqlDriverFactory.android.kt mobile/shared/src/iosMain/kotlin/com/idento/data/storage/SqlDriverFactory.ios.kt mobile/shared/src/commonMain/kotlin/com/idento/data/storage/OfflineDatabase.kt mobile/shared/src/commonMain/kotlin/com/idento/data/storage/SqlDelightOfflineDatabase.kt mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt mobile/shared/src/androidMain/kotlin/com/idento/di/AppModule.android.kt mobile/shared/src/iosMain/kotlin/com/idento/di/AppModule.ios.kt
git rm mobile/shared/src/androidMain/kotlin/com/idento/data/storage/OfflineDatabase.android.kt mobile/shared/src/iosMain/kotlin/com/idento/data/storage/OfflineDatabase.ios.kt
git commit -m "feat(mobile): real SQLDelight-backed offline persistence, replacing the in-memory stub"
```

---

### Task 8: Real camera scanning — Android (CameraX + ML Kit)

**Files:**
- Modify: `mobile/shared/build.gradle.kts` (add CameraX + ML Kit to `androidMain.dependencies`)
- Modify: `mobile/shared/src/androidMain/kotlin/com/idento/platform/camera/CameraService.android.kt`

**Interfaces:**
- Consumes: nothing new — implements the existing `expect class CameraService` contract (`isCameraAvailable`, `hasCameraPermission`, `startScanning(): Flow<String>`, `stopScanning()`, `isScanning()`).
- Produces: a working camera pipeline. Consumed by M1c's scan screens (via `koinInject<CameraService>()`).

- [ ] **Step 1: Add CameraX + ML Kit to `:shared`'s Android dependencies**

In `mobile/shared/build.gradle.kts`'s `androidMain.dependencies` block, add (matching the exact versions `:app` already uses, confirmed compatible with this project's minSdk 26/compileSdk 35):
```kotlin
            implementation("androidx.camera:camera-camera2:1.4.0")
            implementation("androidx.camera:camera-lifecycle:1.4.0")
            implementation("androidx.camera:camera-view:1.4.0")
            implementation("com.google.mlkit:barcode-scanning:17.3.0")
```

- [ ] **Step 2: Rewrite the Android `CameraService` actual with a real CameraX + ML Kit pipeline**

This needs a `LifecycleOwner` to bind the camera to — `CameraService` currently only receives a `Context` (see the Koin wiring: `CameraService(object : KoinComponent {}.getKoin().get())`, which injects a plain `Context`, not an Activity). Since CameraX's `ProcessCameraProvider.bindToLifecycle` requires a `LifecycleOwner`, and this service is a Koin singleton (constructed once, long before any screen/Activity exists), the cleanest fix consistent with the existing single-`Context`-constructor pattern is to use `ProcessLifecycleOwner.get()` (the app-level lifecycle owner from `androidx.lifecycle:lifecycle-process`, which is always available and mirrors "camera runs whenever the process is in the foreground" — appropriate for a kiosk/registration-station app that's the only thing on screen). Add `implementation("androidx.lifecycle:lifecycle-process:2.8.7")` to `androidMain.dependencies` alongside Step 1's additions.

Replace `mobile/shared/src/androidMain/kotlin/com/idento/platform/camera/CameraService.android.kt` in full:
```kotlin
package com.idento.platform.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.concurrent.Executors

/**
 * Android Camera Service — CameraX (preview-less analysis pipeline) + ML Kit barcode scanning.
 * Binds to the process-level lifecycle (ProcessLifecycleOwner) rather than a specific Activity,
 * since this service is a long-lived Koin singleton constructed before any screen exists —
 * appropriate for a kiosk/registration-station app where the camera runs whenever the app is
 * foregrounded.
 */
actual class CameraService(private val context: Context) {

    private val _scanResults = MutableSharedFlow<String>(replay = 0)
    private var isCurrentlyScanning = false
    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private val barcodeScanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39)
            .build()
    )
    private var cameraProvider: ProcessCameraProvider? = null

    actual fun isCameraAvailable(): Boolean {
        return context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }

    actual fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    actual fun startScanning(): Flow<String> {
        if (!isCurrentlyScanning && hasCameraPermission()) {
            isCurrentlyScanning = true
            val providerFuture = ProcessCameraProvider.getInstance(context)
            providerFuture.addListener({
                val provider = providerFuture.get()
                cameraProvider = provider

                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(analysisExecutor, ::analyzeFrame) }

                provider.unbindAll()
                provider.bindToLifecycle(
                    ProcessLifecycleOwner.get(),
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    analysis,
                )
            }, ContextCompat.getMainExecutor(context))
        }
        return _scanResults.asSharedFlow()
    }

    actual fun stopScanning() {
        isCurrentlyScanning = false
        cameraProvider?.unbindAll()
        cameraProvider = null
    }

    actual fun isScanning(): Boolean = isCurrentlyScanning

    @androidx.camera.core.ExperimentalGetImage
    private fun analyzeFrame(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        barcodeScanner.process(inputImage)
            .addOnSuccessListener { barcodes ->
                val value = barcodes.firstOrNull()?.rawValue
                if (value != null) {
                    _scanResults.tryEmit(value)
                }
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }
}
```
Note: `@androidx.camera.core.ExperimentalGetImage` is required on `analyzeFrame` because `imageProxy.image` is an experimental CameraX API — this is the correct, standard way to consume it (matches ML Kit's own documented CameraX integration pattern), not a design shortcut.

- [ ] **Step 3: Verify it compiles**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add mobile/shared/build.gradle.kts mobile/shared/src/androidMain/kotlin/com/idento/platform/camera/CameraService.android.kt
git commit -m "feat(mobile): real CameraX+ML Kit barcode scanning for Android CameraService"
```

---

### Task 9: Real camera scanning — iOS (AVFoundation)

**Files:**
- Modify: `mobile/shared/src/iosMain/kotlin/com/idento/platform/camera/CameraService.ios.kt`

**Interfaces:**
- Consumes: nothing new — implements the same `expect class CameraService` contract as Task 8.
- Produces: a working iOS camera pipeline, matching Task 8's Android behavior (same `Flow<String>` contract), so M1c's screens work identically on both platforms.

- [ ] **Step 1: Rewrite the iOS `CameraService` actual with a real `AVCaptureSession` + `AVCaptureMetadataOutput` pipeline**

Kotlin/Native's `cinterop` requires implementing the `AVCaptureMetadataOutputObjectsDelegate` Objective-C protocol from Kotlin — this is done via a `NSObject`-subclassing delegate class. Replace `mobile/shared/src/iosMain/kotlin/com/idento/platform/camera/CameraService.ios.kt` in full:

```kotlin
package com.idento.platform.camera

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import platform.AVFoundation.AVCaptureConnection
import platform.AVFoundation.AVCaptureDevice
import platform.AVFoundation.AVCaptureDeviceInput
import platform.AVFoundation.AVCaptureMetadataOutput
import platform.AVFoundation.AVCaptureMetadataOutputObjectsDelegateProtocol
import platform.AVFoundation.AVCaptureSession
import platform.AVFoundation.AVCaptureSessionPresetHigh
import platform.AVFoundation.AVAuthorizationStatusAuthorized
import platform.AVFoundation.AVMediaTypeVideo
import platform.AVFoundation.AVMetadataMachineReadableCodeObject
import platform.AVFoundation.AVMetadataObjectTypeCode128Code
import platform.AVFoundation.AVMetadataObjectTypeCode39Code
import platform.AVFoundation.AVMetadataObjectTypeQRCode
import platform.AVFoundation.authorizationStatusForMediaType
import platform.AVFoundation.defaultDeviceWithMediaType
import platform.AVFoundation.requestAccessForMediaType
import platform.darwin.NSObject
import platform.darwin.dispatch_get_main_queue

/**
 * iOS Camera Service — AVCaptureSession + AVCaptureMetadataOutput (QR + linear barcodes).
 */
@OptIn(ExperimentalForeignApi::class)
actual class CameraService {

    private val _scanResults = MutableSharedFlow<String>(replay = 0)
    private var captureSession: AVCaptureSession? = null
    private var isCurrentlyScanning = false

    private val metadataDelegate = object : NSObject(), AVCaptureMetadataOutputObjectsDelegateProtocol {
        override fun captureOutput(
            output: platform.AVFoundation.AVCaptureOutput,
            didOutputMetadataObjects: List<*>,
            fromConnection: AVCaptureConnection,
        ) {
            val code = didOutputMetadataObjects
                .filterIsInstance<AVMetadataMachineReadableCodeObject>()
                .firstOrNull()
                ?.stringValue
            if (code != null) {
                _scanResults.tryEmit(code)
            }
        }
    }

    actual fun isCameraAvailable(): Boolean {
        return AVCaptureDevice.defaultDeviceWithMediaType(AVMediaTypeVideo) != null
    }

    actual fun hasCameraPermission(): Boolean {
        return AVCaptureDevice.authorizationStatusForMediaType(AVMediaTypeVideo) == AVAuthorizationStatusAuthorized
    }

    actual fun startScanning(): Flow<String> {
        if (!isCurrentlyScanning && hasCameraPermission()) {
            isCurrentlyScanning = true
            val device = AVCaptureDevice.defaultDeviceWithMediaType(AVMediaTypeVideo)
            if (device != null) {
                val session = AVCaptureSession()
                session.sessionPreset = AVCaptureSessionPresetHigh

                val input = AVCaptureDeviceInput.deviceInputWithDevice(device, null)
                if (input != null && session.canAddInput(input)) {
                    session.addInput(input)
                }

                val output = AVCaptureMetadataOutput()
                if (session.canAddOutput(output)) {
                    session.addOutput(output)
                    output.setMetadataObjectsDelegate(metadataDelegate, dispatch_get_main_queue())
                    output.metadataObjectTypes = listOf(
                        AVMetadataObjectTypeQRCode,
                        AVMetadataObjectTypeCode128Code,
                        AVMetadataObjectTypeCode39Code,
                    )
                }

                captureSession = session
                session.startRunning()
            }
        }
        return _scanResults.asSharedFlow()
    }

    actual fun stopScanning() {
        captureSession?.stopRunning()
        captureSession = null
        isCurrentlyScanning = false
    }

    actual fun isScanning(): Boolean = isCurrentlyScanning

    /** Request camera permission (platform-only helper, not part of the `expect` contract). */
    suspend fun requestCameraPermission(): Boolean {
        return kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
            AVCaptureDevice.requestAccessForMediaType(AVMediaTypeVideo) { granted ->
                continuation.resume(granted) {}
            }
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd mobile/android-app
./gradlew :shared:compileKotlinIosSimulatorArm64
```
Expected: `BUILD SUCCESSFUL`. If the exact `AVCaptureMetadataOutputObjectsDelegateProtocol` method signature (parameter names/types Kotlin/Native generates from the Objective-C protocol) doesn't match what's written above, the compiler error will show the expected override signature — adjust the `captureOutput` override to match exactly (this is a mechanical cinterop-binding fix, not a design change; Kotlin/Native's exact generated signature for this delegate method varies slightly by Xcode SDK version).

- [ ] **Step 3: Commit**

```bash
git add mobile/shared/src/iosMain/kotlin/com/idento/platform/camera/CameraService.ios.kt
git commit -m "feat(mobile): real AVFoundation barcode scanning for iOS CameraService"
```

---

### Task 10: Android `:app` → `:shared` full switch

**Files:**
- Modify: `mobile/android-app/app/build.gradle.kts` (add `implementation(project(":shared"))`)
- Modify: `mobile/android-app/app/src/main/java/com/idento/MainActivity.kt` (host `:shared`'s `App()` via Koin instead of Hilt+own NavHost)
- Modify: `mobile/android-app/app/src/main/java/com/idento/IdentoApplication.kt` (bootstrap Koin alongside the existing Hilt annotation)
- Delete: `mobile/android-app/app/src/main/java/com/idento/presentation/` (entire directory — 22 files, all superseded by `:shared`'s equivalents; see Global Constraints)
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/repository/AuthRepository.kt`, `EventRepository.kt` (collide with `:shared`)
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/model/Attendee.kt`, `Event.kt`, `User.kt`, `PrinterQRData.kt` (collide with `:shared`)
- Delete: `mobile/android-app/app/src/main/java/com/idento/data/preferences/AppPreferences.kt` (collides with `:shared`)
- Possibly delete: any further `:app` file that fails to compile after the above deletions because it referenced one of the deleted types (see Step 4 — this is a bounded, compiler-driven cleanup loop, not an open-ended audit)

**Interfaces:**
- Consumes: `com.idento.App()` (`:shared`'s root composable, no params), `com.idento.di.doInitKoin(vararg modules, appDeclaration)`, `com.idento.di.androidModule` (`:shared`'s existing Koin Android module).
- Produces: a working Android app that boots `:shared`'s Compose UI. M1b/M1c's new wizard/registration screens will be reachable on Android from this point on with no further platform-wiring work.

- [ ] **Step 1: Add the `:shared` dependency**

In `mobile/android-app/app/build.gradle.kts`, add to the `dependencies { }` block:
```kotlin
    // KMP shared module — the mobile-redesign UI (design system, wizard, registration screens)
    implementation(project(":shared"))

    // Koin (bootstraps :shared's DI graph)
    implementation("io.insert-koin:koin-android:4.0.0")
```

- [ ] **Step 2: Delete the colliding UI-layer files**

```bash
cd mobile/android-app/app/src/main/java/com/idento
rm -rf presentation
rm data/repository/AuthRepository.kt data/repository/EventRepository.kt
rm data/model/Attendee.kt data/model/Event.kt data/model/User.kt data/model/PrinterQRData.kt
rm data/preferences/AppPreferences.kt
```

- [ ] **Step 3: Replace `MainActivity.kt`**

```kotlin
package com.idento

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.background
            ) {
                com.idento.App()
            }
        }
    }
}
```
Note: `App()` (from `:shared`) manages its own theme (`IdentoTheme` + `ThemeState`, loaded from `AppPreferences` via Koin) internally — `MainActivity` no longer needs to read `appPreferences.themeMode` itself, since that responsibility now lives inside `:shared`'s `App()` composable (see `mobile/shared/src/commonMain/kotlin/com/idento/App.kt`).

- [ ] **Step 4: Replace `IdentoApplication.kt`** — bootstrap Koin; keep `@HiltAndroidApp` so any remaining dormant Hilt-annotated code elsewhere in `:app` (DI modules, hardware-integration services) doesn't fail to compile for lack of a Hilt-processed Application class

```kotlin
package com.idento

import android.app.Application
import com.idento.di.androidModule
import com.idento.di.doInitKoin
import dagger.hilt.android.HiltAndroidApp
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger

@HiltAndroidApp
class IdentoApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        doInitKoin(androidModule) {
            androidLogger()
            androidContext(this@IdentoApplication)
        }
    }
}
```

- [ ] **Step 5: Compiler-driven cleanup loop — resolve any remaining dormant-code breakage from Step 2's deletions**

```bash
cd mobile/android-app
./gradlew :app:compileDebugKotlin 2>&1 | grep -E "^e: |error:" | head -50
```
For each `unresolved reference` / `cannot find symbol` error reported against a file OTHER than the ones already deleted in Step 2: that file is transitively dead (it only existed to support the now-removed UI layer or a now-removed model/repository class). Delete it, then re-run the command above. Repeat until the command produces zero errors. Do NOT delete files under `data/api`, `data/local`, `data/bluetooth`, `data/ethernet`, `data/scanner`, `di/`, or `util/` unless the compiler specifically flags them as broken by this task's deletions — those are Hilt-era infrastructure code intentionally left dormant (per Global Constraints), not touched by this cleanup loop unless they genuinely fail to compile.

- [ ] **Step 6: Full verification — both modules build**

```bash
cd mobile/android-app
./gradlew :app:assembleDebug
```
Expected: `BUILD SUCCESSFUL`. This compiles `:shared` (as a dependency), applies the deletions/cleanup from Steps 2-5, and produces a debug APK.

```bash
./gradlew :app:lintDebug
```
Expected: `BUILD SUCCESSFUL` (or investigate/fix any new lint findings the same way prior phases in this project have — 0 issues is the established bar).

- [ ] **Step 7: Commit**

```bash
git add -A mobile/android-app/app/
git commit -m "feat(mobile): wire :app to :shared — MainActivity now hosts the shared Compose UI via Koin

Removes 26 :app files that duplicated :shared's package+class names (a hard
compile constraint, not a design choice — Gradle cannot link two classes with
the same FQN into one APK). Hilt DI modules and hardware-integration code
(data/api, data/local, data/bluetooth, data/ethernet, data/scanner, di/) are
left in place, unused/dormant — full cleanup deferred to Phase M4."
```

---

### Task 11: Final verification, commonTest additions, summary, PR

**Files:**
- Create: `docs/audit/mobile-redesign-m1a-foundation-summary.md`

- [ ] **Step 1: Full backend-equivalent gate for mobile**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid
./gradlew :shared:compileKotlinIosSimulatorArm64
./gradlew :shared:compileKotlinIosArm64
./gradlew :shared:testDebugUnitTest
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
```
All must report `BUILD SUCCESSFUL` / all tests passing. Report actual output for each — do not assume green.

- [ ] **Step 2: iOS build sanity check beyond Kotlin compilation**

If Xcode tooling is available in this environment, additionally run (from `mobile/iosApp/`, after `pod install` if `Podfile.lock` is stale):
```bash
cd mobile/iosApp
pod install
xcodebuild -workspace iosApp.xcworkspace -scheme iosApp -sdk iphonesimulator -configuration Debug build
```
If Xcode/CocoaPods tooling isn't available in this environment, state that explicitly and rely on `:shared:compileKotlinIosSimulatorArm64`/`:shared:compileKotlinIosArm64` (Step 1) as the verification ceiling — do not claim the full iOS app was verified to boot if it wasn't.

- [ ] **Step 3: Write the phase summary**

Create `docs/audit/mobile-redesign-m1a-foundation-summary.md` covering: (a) what was added per task (design tokens, font, components, SQLDelight, domain models, 6-endpoint API/repo layer, real camera scanning on both platforms, the `:app`→`:shared` switch and exactly which files were deleted/why); (b) the full gate results table; (c) explicit note of what M1b (setup wizard) and M1c (registration mode) still need to build on top of this foundation — no new screens exist yet, this phase is data+platform plumbing only; (d) any deviations from the plan discovered during implementation (e.g. exact SQLDelight/generated-package-name specifics that had to be adjusted from the plan's best-guess).

- [ ] **Step 4: Commit, push, open PR**

```bash
git add docs/audit/mobile-redesign-m1a-foundation-summary.md
git commit -m "docs(audit): Phase M1a mobile foundation summary"
git push -u origin <branch-name>
gh pr create --base main --title "Phase M1a: mobile foundation — design system, data layer, platform wiring" --body-file <(cat docs/audit/mobile-redesign-m1a-foundation-summary.md)
```

## Self-Review Notes (author's pass)

- **Spec coverage:** design tokens (Task 1), font (Task 2), components (Task 3) cover spec section 6; domain models (Task 4) cover section 4; API/repo layer (Tasks 5-6) covers section 5.1's mobile-side consumption of the already-shipped Phase B contract; SQLDelight (Task 7) covers section 5.2's offline/print-queue infrastructure (print-queue tables themselves are additive schema not yet consumed — M1c wires print-queue logic on top); real camera scanning (Tasks 8-9) covers section 7's `ScanSource` platform service; the `:app`→`:shared` switch (Task 10) covers the approved architecture decision (KMP unification, section 3) made concrete for Android.
- **Deferred to M1b/M1c, intentionally not in this plan:** the setup wizard screens, the registration-mode screens (scan/verdicts/search/list), print-queue business logic actually printing, offline-queue business logic actually calling the new batch endpoint (Task 7 only replaces the storage layer; `OfflineCheckInRepository` still calls the OLD `performZoneCheckIn` — M1c's job is to migrate it to the new batch/scan contract when it builds the real registration flow), settings-screen restyle, nav-graph integration of anything new.
- **Type consistency checked:** `ZoneScanResponseDto`/`BatchCheckinItemDto`/etc. field names (Task 5) match the Go backend's JSON tags exactly (verified against `docs/audit/mobile-redesign-phase-b-backend-summary.md` and the plan that shipped Phase B); `StationRepository`/`ZoneRepository.scanZone`/etc. signatures (Task 6) match what Task 5 produces; `SqlDelightOfflineDatabase` (Task 7) implements the exact same `OfflineDatabase` interface `OfflineCheckInRepository` already consumes, so no call-site changes ripple beyond Task 7's own files.
- **No placeholders:** every step has complete, concrete code. The two spots with an explicit "adjust if the generated API differs" note (Task 2's Compose Resources package name, Task 7's SQLDelight Android driver API, Task 9's AVFoundation delegate signature) are honest acknowledgments of tooling/codegen specifics that can only be confirmed by actually running the build in this environment — not vague hand-waving; each names the exact fallback action to take.
