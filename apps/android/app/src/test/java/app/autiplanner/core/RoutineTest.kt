package app.autiplanner.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class RoutineTest {

    private fun item(
        uid: String = "item@autiplanner.local",
        title: String = "Take medication",
        status: RoutineStatus = RoutineStatus.PENDING,
        dayPart: DayPart = DayPart.MORNING,
        start: String? = null,
        routineId: String? = null,
    ) = RoutineItem(
        uid = uid,
        title = title,
        date = "2026-08-11",
        dayPart = dayPart,
        status = status,
        start = start,
        routineId = routineId,
    )

    @Test
    fun `the four outcomes keep distinct symbols and labels`() {
        assertEquals(listOf("○", "✓", "✕", "—"), OUTCOMES.map { it.symbol })
        assertEquals(
            listOf("Pending", "Completed", "Missed", "Skipped"),
            OUTCOMES.map { it.accessibleLabel },
        )
        assertFalse(RoutineStatus.MISSED.isComplete)
        assertFalse(RoutineStatus.SKIPPED.isComplete)
        assertTrue(RoutineStatus.COMPLETED.isComplete)
    }

    @Test
    fun `day part is not inferred from the clock`() {
        val evening = item(dayPart = DayPart.EVENING, start = "2026-08-11T11:30:00Z")
        assertEquals(DayPart.EVENING, evening.dayPart)
        assertEquals("11:30 UTC", evening.clock())
    }

    @Test
    fun `an item without a time has no clock`() {
        assertNull(item().clock())
    }

    @Test
    fun `accessible label names the outcome and the time`() {
        val missed = item(status = RoutineStatus.MISSED, start = "2026-08-11T13:30:00Z")
        assertEquals("Missed: Take medication, 13:30 UTC", missed.accessibleLabel())
        assertEquals("Pending: Take medication", item().accessibleLabel())
    }

    @Test
    fun `only completion is a single tap and mis taps are reversible`() {
        val pending = outcomeControls(RoutineStatus.PENDING).associateBy { it.status }
        assertEquals(RoutineStatus.COMPLETED, pending[RoutineStatus.COMPLETED]?.next)
        assertNull(pending[RoutineStatus.MISSED]?.next)
        assertNull(pending[RoutineStatus.SKIPPED]?.next)
        assertNull(pending[RoutineStatus.PENDING]?.next)
        assertTrue(pending[RoutineStatus.MISSED]?.destructive == true)
        assertTrue(pending[RoutineStatus.SKIPPED]?.destructive == true)

        val missed = outcomeControls(RoutineStatus.MISSED).associateBy { it.status }
        assertEquals(RoutineStatus.PENDING, missed[RoutineStatus.MISSED]?.next)
    }

    @Test
    fun `every control meets the touch target minimum`() {
        OUTCOMES.forEach { status ->
            outcomeControls(status).forEach {
                assertTrue(it.minTouchTargetDp >= 48)
            }
        }
    }

    @Test
    fun `agenda groups by explicit day part and keeps order`() {
        val items = listOf(
            item(uid = "b", title = "Breakfast", start = "2026-08-11T08:30:00Z", dayPart = DayPart.MORNING).copy(order = 20),
            item(uid = "a", title = "Medication", start = "2026-08-11T08:00:00Z", dayPart = DayPart.MORNING).copy(order = 10),
            item(uid = "c", title = "Wind down", start = "2026-08-11T22:00:00Z", dayPart = DayPart.NIGHT),
        )
        val day = Agenda(items = items).days().single()
        assertEquals(listOf("MORNING", "NIGHT"), day.sections.map { it.dayPart.heading })
        assertEquals(listOf("a", "b"), day.sections.first().items.map { it.uid })
    }

    @Test
    fun `summary never collapses the four states`() {
        val summary = summarize(
            listOf(
                item(status = RoutineStatus.PENDING),
                item(uid = "b", status = RoutineStatus.COMPLETED),
                item(uid = "c", status = RoutineStatus.MISSED),
                item(uid = "d", status = RoutineStatus.SKIPPED),
            ),
        )
        assertEquals(1, summary.pending)
        assertEquals(1, summary.completed)
        assertEquals(1, summary.missed)
        assertEquals(1, summary.skipped)
        assertEquals(4, summary.total)
    }

    @Test
    fun `an occurrence is identified by series and date`() {
        val occurrence = item(
            uid = "meds@autiplanner.local:2026-08-11",
            routineId = "meds@autiplanner.local",
        )
        assertTrue(occurrence.isOccurrence)
        // A one-off item is not an occurrence of anything.
        assertFalse(item().isOccurrence)
        // A one-off item that merely carries a series id is still not one.
        assertFalse(item(routineId = "meds@autiplanner.local").isOccurrence)
    }
}
