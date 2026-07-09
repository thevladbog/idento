# Mobile: инвентарь зависимостей (Gradle)

Источники: mobile/android-app/gradle/libs.versions.toml,
mobile/android-app/build.gradle.kts, mobile/android-app/app/build.gradle.kts,
mobile/shared/build.gradle.kts (+ mobile/android-app/settings.gradle.kts,
mobile/shared/settings.gradle.kts — проверены на предмет версий/каталогов, версий не объявляют).

**Важная находка:** каталог `libs.versions.toml` существует и синтаксически корректен
(19 записей `[versions]`, 27 записей `[libraries]`, 7 записей `[plugins]`), но **ни один**
`build.gradle.kts` в модулях `mobile/android-app` или `mobile/shared` не ссылается на него
(проверено: `grep -rn "libs\." mobile --include="*.kts"` → 0 совпадений). Ни `android-app/settings.gradle.kts`,
ни `shared/settings.gradle.kts` не содержат блока `dependencyResolutionManagement { versionCatalogs { ... } }`,
но т.к. файл лежит в дефолтном месте (`gradle/libs.versions.toml` относительно root проекта
`android-app`), Gradle всё равно неявно зарегистрировал бы каталог как `libs` — просто он нигде
не используется. Все зависимости объявлены буквенными строковыми версиями напрямую в `build.gradle.kts`.
Это отдельная находка для итогового отчёта (мёртвый/неиспользуемый каталог, риск рассинхронизации —
см. раздел 6).

`mobile/shared` — независимый Gradle-проект (свой `settings.gradle.kts`, `rootProject.name = "shared"`),
одновременно подключаемый как модуль `:shared` из `android-app/settings.gradle.kts`
(`project(":shared").projectDir = file("../shared")`) — для сборки Android-таргета, и собираемый
отдельно для iOS-таргета (Xcode/KMP). У него нет собственного `libs.versions.toml` — версии только
литералами в `shared/build.gradle.kts`.

---

## 1. Каталог: `[versions]` (mobile/android-app/gradle/libs.versions.toml) — 19 записей

| Ключ версии | Версия в toml | Где объявлена |
|---|---|---|
| kotlin | 2.1.0 | libs.versions.toml [versions] |
| android-gradle-plugin | 8.7.2 | libs.versions.toml [versions] |
| compose | 1.7.6 | libs.versions.toml [versions] |
| compose-compiler | 2.1.0 | libs.versions.toml [versions] |
| compose-plugin | 1.7.3 | libs.versions.toml [versions] |
| core-ktx | 1.15.0 | libs.versions.toml [versions] |
| lifecycle | 2.8.7 | libs.versions.toml [versions] |
| activity-compose | 1.9.3 | libs.versions.toml [versions] |
| compose-bom | 2024.12.01 | libs.versions.toml [versions] |
| compose-navigation | 2.8.5 | libs.versions.toml [versions] |
| ktor | 3.0.2 | libs.versions.toml [versions] |
| kotlinx-serialization | 1.7.3 | libs.versions.toml [versions] |
| koin | 4.0.0 | libs.versions.toml [versions] |
| koin-compose | 4.0.0 | libs.versions.toml [versions] |
| hilt | 2.54 | libs.versions.toml [versions] |
| ksp | 2.1.0-1.0.29 | libs.versions.toml [versions] |
| datastore | 1.1.1 | libs.versions.toml [versions] |
| coroutines | 1.9.0 | libs.versions.toml [versions] |
| room | 2.6.1 | libs.versions.toml [versions] |

Примечание: ключи `compose` (1.7.6) и `hilt`/`ksp`/`room` не имеют ни одной ссылки `version.ref`
в секции `[libraries]` каталога (см. раздел 2) — `compose` не используется вообще нигде (ни в
каталоге, ни в build.gradle.kts), `hilt`/`ksp` используются только как версии плагинов в
`android-app/build.gradle.kts` (напрямую, не через каталог), `room` — только как локальная
переменная `roomVersion` в `app/build.gradle.kts` (напрямую).

## 2. Каталог: `[libraries]` (алиасы модулей) — 27 записей

| Алиас | Модуль (module) | Версия (через version.ref) | Где объявлена |
|---|---|---|---|
| kotlin-stdlib | org.jetbrains.kotlin:kotlin-stdlib | 2.1.0 (kotlin) | libs.versions.toml [libraries] |
| androidx-core-ktx | androidx.core:core-ktx | 1.15.0 (core-ktx) | libs.versions.toml [libraries] |
| androidx-lifecycle-runtime | androidx.lifecycle:lifecycle-runtime-ktx | 2.8.7 (lifecycle) | libs.versions.toml [libraries] |
| androidx-lifecycle-viewmodel | androidx.lifecycle:lifecycle-viewmodel-ktx | 2.8.7 (lifecycle) | libs.versions.toml [libraries] |
| androidx-lifecycle-viewmodel-compose | androidx.lifecycle:lifecycle-viewmodel-compose | 2.8.7 (lifecycle) | libs.versions.toml [libraries] |
| androidx-activity-compose | androidx.activity:activity-compose | 1.9.3 (activity-compose) | libs.versions.toml [libraries] |
| compose-bom | androidx.compose:compose-bom | 2024.12.01 (compose-bom) | libs.versions.toml [libraries] |
| compose-ui | androidx.compose.ui:ui | (без версии, из BOM) | libs.versions.toml [libraries] |
| compose-ui-graphics | androidx.compose.ui:ui-graphics | (без версии, из BOM) | libs.versions.toml [libraries] |
| compose-ui-tooling-preview | androidx.compose.ui:ui-tooling-preview | (без версии, из BOM) | libs.versions.toml [libraries] |
| compose-material3 | androidx.compose.material3:material3 | (без версии, из BOM) | libs.versions.toml [libraries] |
| compose-navigation | androidx.navigation:navigation-compose | 2.8.5 (compose-navigation) | libs.versions.toml [libraries] |
| ktor-client-core | io.ktor:ktor-client-core | 3.0.2 (ktor) | libs.versions.toml [libraries] |
| ktor-client-okhttp | io.ktor:ktor-client-okhttp | 3.0.2 (ktor) | libs.versions.toml [libraries] |
| ktor-client-darwin | io.ktor:ktor-client-darwin | 3.0.2 (ktor) | libs.versions.toml [libraries] |
| ktor-client-content-negotiation | io.ktor:ktor-client-content-negotiation | 3.0.2 (ktor) | libs.versions.toml [libraries] |
| ktor-client-logging | io.ktor:ktor-client-logging | 3.0.2 (ktor) | libs.versions.toml [libraries] |
| ktor-client-auth | io.ktor:ktor-client-auth | 3.0.2 (ktor) | libs.versions.toml [libraries] |
| ktor-serialization-json | io.ktor:ktor-serialization-kotlinx-json | 3.0.2 (ktor) | libs.versions.toml [libraries] |
| kotlinx-serialization-json | org.jetbrains.kotlinx:kotlinx-serialization-json | 1.7.3 (kotlinx-serialization) | libs.versions.toml [libraries] |
| koin-core | io.insert-koin:koin-core | 4.0.0 (koin) | libs.versions.toml [libraries] |
| koin-android | io.insert-koin:koin-android | 4.0.0 (koin) | libs.versions.toml [libraries] |
| koin-compose | io.insert-koin:koin-androidx-compose | 4.0.0 (koin-compose) | libs.versions.toml [libraries] |
| androidx-datastore-preferences-core | androidx.datastore:datastore-preferences-core | 1.1.1 (datastore) | libs.versions.toml [libraries] |
| androidx-datastore-preferences | androidx.datastore:datastore-preferences | 1.1.1 (datastore) | libs.versions.toml [libraries] |
| kotlinx-coroutines-core | org.jetbrains.kotlinx:kotlinx-coroutines-core | 1.9.0 (coroutines) | libs.versions.toml [libraries] |
| kotlinx-coroutines-android | org.jetbrains.kotlinx:kotlinx-coroutines-android | 1.9.0 (coroutines) | libs.versions.toml [libraries] |

## 3. Каталог: `[plugins]` — 7 записей

| Плагин (алиас) | Plugin ID | Версия |
|---|---|---|
| androidApplication | com.android.application | 8.7.2 (android-gradle-plugin) |
| androidLibrary | com.android.library | 8.7.2 (android-gradle-plugin) |
| kotlinAndroid | org.jetbrains.kotlin.android | 2.1.0 (kotlin) |
| kotlinMultiplatform | org.jetbrains.kotlin.multiplatform | 2.1.0 (kotlin) |
| kotlinSerialization | org.jetbrains.kotlin.plugin.serialization | 2.1.0 (kotlin) |
| jetbrainsCompose | org.jetbrains.compose | 1.7.3 (compose-plugin) |
| composeCompiler | org.jetbrains.kotlin.plugin.compose | 2.1.0 (kotlin) |

---

## 4. Прямые версии вне каталога — mobile/android-app/build.gradle.kts (top-level plugins)

Ни один плагин здесь не ссылается на каталог — все версии — строковые литералы:

| Плагин | Версия | Где объявлена |
|---|---|---|
| com.android.application | 8.7.2 | android-app/build.gradle.kts (plugins, apply false) |
| com.android.library | 8.7.2 | android-app/build.gradle.kts (plugins, apply false) |
| org.jetbrains.kotlin.android | 2.1.0 | android-app/build.gradle.kts (plugins, apply false) |
| org.jetbrains.kotlin.multiplatform | 2.1.0 | android-app/build.gradle.kts (plugins, apply false) |
| org.jetbrains.kotlin.plugin.compose | 2.1.0 | android-app/build.gradle.kts (plugins, apply false) |
| org.jetbrains.compose | 1.7.3 | android-app/build.gradle.kts (plugins, apply false) |
| com.google.dagger.hilt.android | 2.54 | android-app/build.gradle.kts (plugins, apply false) — не в каталоге как плагин |
| com.google.devtools.ksp | 2.1.0-1.0.29 | android-app/build.gradle.kts (plugins, apply false) — не в каталоге как плагин |
| kotlin("plugin.serialization") | 2.1.0 | android-app/build.gradle.kts (plugins, apply false) |

## 5. Прямые версии вне каталога — mobile/android-app/app/build.gradle.kts

Плагины без явной версии (наследуют версию из root, apply false выше) не перечислены повторно,
кроме `kotlin("plugin.serialization") version "2.1.0"` — версия продублирована явно.

| Библиотека / модуль | Версия в проекте | Где объявлена |
|---|---|---|
| androidx.core:core-ktx | 1.15.0 | app/build.gradle.kts (dependencies) |
| androidx.lifecycle:lifecycle-runtime-ktx | 2.8.7 | app/build.gradle.kts (dependencies) |
| androidx.lifecycle:lifecycle-viewmodel-compose | 2.8.7 | app/build.gradle.kts (dependencies) |
| androidx.lifecycle:lifecycle-runtime-compose | 2.8.7 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.compose:compose-bom (platform) | 2024.11.00 | app/build.gradle.kts (dependencies) |
| androidx.compose.ui:ui | из BOM 2024.11.00 | app/build.gradle.kts (dependencies) |
| androidx.compose.ui:ui-graphics | из BOM 2024.11.00 | app/build.gradle.kts (dependencies) |
| androidx.compose.ui:ui-tooling-preview | из BOM 2024.11.00 | app/build.gradle.kts (dependencies) |
| androidx.compose.material3:material3 | из BOM 2024.11.00 | app/build.gradle.kts (dependencies) |
| androidx.compose.material:material-icons-extended | из BOM 2024.11.00 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.compose.animation:animation | из BOM 2024.11.00 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.compose.foundation:foundation | из BOM 2024.11.00 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.activity:activity-compose | 1.9.3 | app/build.gradle.kts (dependencies) |
| androidx.navigation:navigation-compose | 2.8.4 | app/build.gradle.kts (dependencies) |
| com.google.dagger:hilt-android | 2.54 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.google.dagger:hilt-compiler (ksp) | 2.54 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.hilt:hilt-navigation-compose | 1.2.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.squareup.retrofit2:retrofit | 2.11.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.squareup.retrofit2:converter-gson | 2.11.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.squareup.okhttp3:okhttp | 4.12.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.squareup.okhttp3:logging-interceptor | 4.12.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.google.code.gson:gson | 2.11.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| org.jetbrains.kotlinx:kotlinx-serialization-json | 1.7.3 | app/build.gradle.kts (dependencies) |
| androidx.room:room-runtime | 2.6.1 (val roomVersion) | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.room:room-ktx | 2.6.1 (val roomVersion) | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.room:room-compiler (ksp) | 2.6.1 (val roomVersion) | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.datastore:datastore-preferences | 1.1.1 | app/build.gradle.kts (dependencies) |
| androidx.camera:camera-camera2 | 1.4.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.camera:camera-lifecycle | 1.4.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.camera:camera-view | 1.4.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.google.mlkit:barcode-scanning | 17.3.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| org.jetbrains.kotlinx:kotlinx-coroutines-android | 1.9.0 | app/build.gradle.kts (dependencies) |
| org.jetbrains.kotlinx:kotlinx-coroutines-core | 1.9.0 | app/build.gradle.kts (dependencies) |
| io.coil-kt:coil-compose | 2.7.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.google.accompanist:accompanist-permissions | 0.36.0 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| com.google.zxing:core | 3.5.3 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| androidx.core:core-splashscreen | 1.0.1 | app/build.gradle.kts (dependencies) — нет алиаса в каталоге |
| junit:junit (test) | 4.13.2 | app/build.gradle.kts (testImplementation) — нет алиаса в каталоге |
| org.jetbrains.kotlinx:kotlinx-coroutines-test (test) | 1.9.0 | app/build.gradle.kts (testImplementation) — нет алиаса в каталоге |
| androidx.test.ext:junit (androidTest) | 1.2.1 | app/build.gradle.kts (androidTestImplementation) — нет алиаса в каталоге |
| androidx.test.espresso:espresso-core (androidTest) | 3.6.1 | app/build.gradle.kts (androidTestImplementation) — нет алиаса в каталоге |
| androidx.compose.ui:ui-test-junit4 (androidTest) | из BOM 2024.11.00 | app/build.gradle.kts (androidTestImplementation) — нет алиаса в каталоге |
| androidx.compose.ui:ui-tooling (debug) | из BOM 2024.11.00 | app/build.gradle.kts (debugImplementation) — нет алиаса в каталоге |
| androidx.compose.ui:ui-test-manifest (debug) | из BOM 2024.11.00 | app/build.gradle.kts (debugImplementation) — нет алиаса в каталоге |

Примечание: закомментированные зависимости `com.halilibo.compose-richtext:*:1.0.0-alpha01` (строки
120–123, "Markdown rendering — temporarily disabled") не подключены — не включены в таблицу как
активные зависимости, упоминаются здесь для полноты информации.

## 6. Прямые версии вне каталога — mobile/shared/build.gradle.kts (KMP source sets)

Плагины (`plugins { ... }` в shared/build.gradle.kts):

| Плагин | Версия | Где объявлена |
|---|---|---|
| kotlin("multiplatform") | 2.1.0 | shared/build.gradle.kts (plugins) |
| com.android.library | 8.7.2 | shared/build.gradle.kts (plugins) |
| org.jetbrains.compose | 1.7.3 | shared/build.gradle.kts (plugins) |
| org.jetbrains.kotlin.plugin.compose | 2.1.0 | shared/build.gradle.kts (plugins) |
| kotlin("plugin.serialization") | 2.1.0 | shared/build.gradle.kts (plugins) |

Зависимости (`kotlin { sourceSets { ... } }`):

| Библиотека / модуль | Версия в проекте | Где объявлена |
|---|---|---|
| org.jetbrains.kotlinx:kotlinx-coroutines-core | 1.9.0 | shared/build.gradle.kts (commonMain) |
| org.jetbrains.kotlinx:kotlinx-serialization-json | 1.7.3 | shared/build.gradle.kts (commonMain) |
| org.jetbrains.kotlinx:kotlinx-datetime | 0.6.1 | shared/build.gradle.kts (commonMain) — нет алиаса в каталоге |
| org.jetbrains.kotlinx:atomicfu | 0.27.0 | shared/build.gradle.kts (commonMain) — нет алиаса в каталоге |
| io.ktor:ktor-client-core | 3.0.2 | shared/build.gradle.kts (commonMain) |
| io.ktor:ktor-client-content-negotiation | 3.0.2 | shared/build.gradle.kts (commonMain) |
| io.ktor:ktor-serialization-kotlinx-json | 3.0.2 | shared/build.gradle.kts (commonMain) |
| io.ktor:ktor-client-logging | 3.0.2 | shared/build.gradle.kts (commonMain) |
| io.ktor:ktor-client-auth | 3.0.2 | shared/build.gradle.kts (commonMain) |
| io.insert-koin:koin-core | 4.0.0 | shared/build.gradle.kts (commonMain) |
| io.insert-koin:koin-compose | 4.0.0 | shared/build.gradle.kts (commonMain) |
| androidx.datastore:datastore-preferences-core | 1.1.1 | shared/build.gradle.kts (commonMain) |
| androidx.lifecycle:lifecycle-viewmodel | 2.8.7 | shared/build.gradle.kts (commonMain) — нет точного алиаса (каталог даёт lifecycle-viewmodel-ktx, не KMP-артефакт) |
| org.jetbrains.androidx.navigation:navigation-compose | 2.8.0-alpha10 | shared/build.gradle.kts (commonMain) — **другая группа артефакта**, см. раздел 7 |
| io.ktor:ktor-client-okhttp | 3.0.2 | shared/build.gradle.kts (androidMain) |
| io.insert-koin:koin-android | 4.0.0 | shared/build.gradle.kts (androidMain) |
| androidx.datastore:datastore-preferences | 1.1.1 | shared/build.gradle.kts (androidMain) |
| io.ktor:ktor-client-darwin | 3.0.2 | shared/build.gradle.kts (iosMain) |
| org.jetbrains.kotlinx:kotlinx-coroutines-test (test) | 1.9.0 | shared/build.gradle.kts (commonTest) |

`compose.runtime`, `compose.foundation`, `compose.material3`, `compose.ui`,
`compose.components.resources`, `compose.components.uiToolingPreview` (Compose Multiplatform DSL,
commonMain) не имеют отдельного строкового литерала версии — версия управляется плагином
`org.jetbrains.compose` (1.7.3, см. выше). `kotlin("test")` (commonTest) версии не имеет — привязан
к плагину Kotlin (2.1.0).

`mobile/android-app/settings.gradle.kts` и `mobile/shared/settings.gradle.kts` версий не объявляют
(только repositories/includes).

---

## 7. Расхождения версий каталог vs фактическое использование (для Задачи 5/10)

| Библиотека | В libs.versions.toml | Фактически используется | Комментарий |
|---|---|---|---|
| compose-bom | 2024.12.01 | 2024.11.00 (android-app/app/build.gradle.kts) | Дрейф версии: каталог новее, чем фактически подключённый BOM. Каталог не используется, поэтому обновление toml не влияет на билд. |
| compose-navigation | 2.8.5 (androidx.navigation:navigation-compose) | 2.8.4 (android-app/app/build.gradle.kts, androidx.navigation:navigation-compose) | Дрейф версии на один патч в сторону меньшей версии, чем в каталоге. |
| compose-navigation | 2.8.5 (androidx.navigation:navigation-compose) | 2.8.0-alpha10 (mobile/shared/build.gradle.kts, **org.jetbrains.androidx.navigation:navigation-compose**) | Другой groupId (KMP-совместимый форк Compose Multiplatform Navigation) и существенно более старая/alpha-версия — не просто дрейф версии, а другой артефакт. Требует внимания в Задаче 6/8 (безопасность/актуальность alpha-зависимости в shared-модуле, который также используется для iOS). |
| kotlin, android-gradle-plugin, compose-plugin, hilt, ksp, room, core-ktx, lifecycle, activity-compose, ktor, kotlinx-serialization, koin, koin-compose, datastore, coroutines | как в toml | совпадает по значению во всех build.gradle.kts, где используются | Версии совпадают "случайно" (или по факту синхронизировались вручную) — но т.к. каталог физически не подключён (`libs.` нигде не встречается), нет никакой автоматической защиты от рассинхронизации в будущем. |
| compose | 1.7.6 | не используется нигде (ни в каталоге, ни в build.gradle.kts) | Мёртвая запись каталога. |

---

## Плагины (сводная таблица по всем источникам)

| Плагин (Plugin ID) | Версия | Источник |
|---|---|---|
| com.android.application | 8.7.2 | libs.versions.toml [plugins] (androidApplication) + android-app/build.gradle.kts (буквально) |
| com.android.library | 8.7.2 | libs.versions.toml [plugins] (androidLibrary) + android-app/build.gradle.kts + shared/build.gradle.kts (буквально) |
| org.jetbrains.kotlin.android | 2.1.0 | libs.versions.toml [plugins] (kotlinAndroid) + android-app/build.gradle.kts (буквально) |
| org.jetbrains.kotlin.multiplatform | 2.1.0 | libs.versions.toml [plugins] (kotlinMultiplatform) + android-app/build.gradle.kts + shared/build.gradle.kts (буквально) |
| org.jetbrains.kotlin.plugin.serialization | 2.1.0 | libs.versions.toml [plugins] (kotlinSerialization) + android-app/build.gradle.kts + app/build.gradle.kts + shared/build.gradle.kts (буквально, через kotlin("plugin.serialization")) |
| org.jetbrains.compose | 1.7.3 | libs.versions.toml [plugins] (jetbrainsCompose) + android-app/build.gradle.kts + shared/build.gradle.kts (буквально) |
| org.jetbrains.kotlin.plugin.compose | 2.1.0 | libs.versions.toml [plugins] (composeCompiler) + android-app/build.gradle.kts + app/build.gradle.kts + shared/build.gradle.kts (буквально) |
| com.google.dagger.hilt.android | 2.54 | android-app/build.gradle.kts + app/build.gradle.kts (буквально, отсутствует в [plugins] каталога) |
| com.google.devtools.ksp | 2.1.0-1.0.29 | android-app/build.gradle.kts + app/build.gradle.kts (буквально, отсутствует в [plugins] каталога) |

---

## Итоговые счётчики (для Шага 2 / Задачи 10)

- `libs.versions.toml`: 19 записей `[versions]` + 27 записей `[libraries]` + 7 записей `[plugins]` = 53 строки с `=` (`grep -c '=' libs.versions.toml` → 53).
- Строк таблиц (`grep -c '^|'`) в этом файле: см. вывод команды из Шага 2 ниже — таблицы разделов 1–7 и сводная таблица плагинов суммарно дают более 53 строк, что покрывает полноту каталога с запасом (плюс отдельно перечислены ~45 прямых зависимостей вне каталога из app/build.gradle.kts и shared/build.gradle.kts).
