package org.lunikodevelopment.autiplanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.lunikodevelopment.autiplanner.model.RoutineStatus
import org.lunikodevelopment.autiplanner.model.routineItemOrNull

class RoutineModelsTest {
    @Test
    fun parsesAllFourOutcomesAndRejectsIncompleteCompletedRecords() {
        val outcomes = listOf("PENDING", "COMPLETED", "MISSED", "SKIPPED")
        val parsed = outcomes.map { outcome ->
            routineItemOrNull(
                uid = outcome,
                title = outcome,
                date = "2026-08-11",
                dayPartValue = "morning",
                statusValue = outcome,
                completedAt = if (outcome == "COMPLETED") "2026-08-11T08:00:00Z" else null,
            )
        }
        assertEquals(listOf(RoutineStatus.PENDING, RoutineStatus.COMPLETED, RoutineStatus.MISSED, RoutineStatus.SKIPPED), parsed.map { it?.status })
        assertNull(routineItemOrNull("bad", "Bad", "2026-08-11", "morning", "COMPLETED"))
    }
}
