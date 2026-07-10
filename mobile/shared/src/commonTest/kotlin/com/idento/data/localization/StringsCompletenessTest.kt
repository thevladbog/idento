package com.idento.data.localization

import kotlin.test.Test
import kotlin.test.assertTrue

class StringsCompletenessTest {

    @Test
    fun everyStringKeyHasBothEnglishAndRussianEntries() {
        val missingEnglish = StringKey.entries.filterNot { englishStrings.containsKey(it) }
        val missingRussian = StringKey.entries.filterNot { russianStrings.containsKey(it) }
        assertTrue(
            missingEnglish.isEmpty() && missingRussian.isEmpty(),
            "Missing English: $missingEnglish\nMissing Russian: $missingRussian"
        )
    }
}
