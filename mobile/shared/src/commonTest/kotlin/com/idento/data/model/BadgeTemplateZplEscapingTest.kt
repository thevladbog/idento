package com.idento.data.model

import kotlin.test.Test
import kotlin.test.assertEquals

class BadgeTemplateZplEscapingTest {

    private val attendee = Attendee(
        id = "att-1", eventId = "evt-1", code = "ABC-123",
        firstName = "O'Brien^Test", lastName = "Smith~Co",
        company = "A\\B Corp", position = null,
    )

    @Test
    fun escapesCaretTildeAndBackslashInFieldData() {
        val template = BadgeTemplate(zplTemplate = "^XA^FD{firstName} {lastName} {company}^FS^XZ")
        val zpl = template.generateZPL(attendee)
        assertEquals("^XA^FDO'Brien\\^Test Smith\\~Co A\\\\B Corp^FS^XZ", zpl)
    }

    @Test
    fun leavesPlainTextUnescaped() {
        val plain = attendee.copy(firstName = "John", lastName = "Doe", company = "Acme")
        val template = BadgeTemplate(zplTemplate = "^FD{firstName} {lastName} {company}^FS")
        assertEquals("^FDJohn Doe Acme^FS", template.generateZPL(plain))
    }
}
