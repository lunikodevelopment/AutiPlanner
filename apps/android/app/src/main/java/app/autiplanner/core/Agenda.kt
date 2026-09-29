package app.autiplanner.core

/**
 * The next state a control should apply.
 *
 * Only completion is a single tap. Missed and skipped are destructive enough
 * that they stay in a secondary menu, and tapping the current state resets it
 * so no state change is a one-tap dead end.
 */
data class OutcomeControl(
    val status: RoutineStatus,
    val symbol: String,
    val accessibleLabel: String,
    /** Minimum target in dp. 48dp is comfortable on a phone. */
    val minTouchTargetDp: Int,
    val next: RoutineStatus?,
    val destructive: Boolean,
)

const val MIN_TOUCH_TARGET_DP = 48

fun outcomeControls(current: RoutineStatus, canUndo: Boolean = true): List<OutcomeControl> =
    OUTCOMES.map { status ->
        val base = OutcomeControl(
            status = status,
            symbol = status.symbol,
            accessibleLabel = status.accessibleLabel,
            minTouchTargetDp = MIN_TOUCH_TARGET_DP,
            next = null,
            destructive = status == RoutineStatus.MISSED || status == RoutineStatus.SKIPPED,
        )
        when {
            status == current && canUndo && current != RoutineStatus.PENDING ->
                base.copy(next = RoutineStatus.PENDING)
            status == RoutineStatus.COMPLETED && status != current ->
                base.copy(next = RoutineStatus.COMPLETED)
            else -> base
        }
    }

data class OutcomeSummary(
    val pending: Int,
    val completed: Int,
    val missed: Int,
    val skipped: Int,
) {
    /** The four counts stay separate; there is no single "done" number. */
    val total: Int get() = pending + completed + missed + skipped
}

fun summarize(items: List<RoutineItem>): OutcomeSummary = OutcomeSummary(
    pending = items.count { it.status == RoutineStatus.PENDING },
    completed = items.count { it.status == RoutineStatus.COMPLETED },
    missed = items.count { it.status == RoutineStatus.MISSED },
    skipped = items.count { it.status == RoutineStatus.SKIPPED },
)
