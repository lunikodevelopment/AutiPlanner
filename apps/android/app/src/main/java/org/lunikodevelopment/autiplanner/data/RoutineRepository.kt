package org.lunikodevelopment.autiplanner.data

import android.content.Context
import org.lunikodevelopment.autiplanner.ha.HomeAssistantClient
import org.lunikodevelopment.autiplanner.model.NewRoutine
import org.lunikodevelopment.autiplanner.model.RoutineCommand
import org.lunikodevelopment.autiplanner.model.RoutineItem
import kotlinx.coroutines.delay

class RoutineRepository(context: Context, private val client: HomeAssistantClient) {
    private val cache = RoutineCache(context)

    suspend fun cachedItems(): List<RoutineItem> = cache.read()

    suspend fun refresh(): List<RoutineItem> {
        val items = client.getItems()
        cache.write(items)
        return items
    }

    suspend fun execute(command: RoutineCommand): List<RoutineItem> {
        client.execute(command)
        return refreshAfterMutation()
    }

    suspend fun create(routine: NewRoutine): List<RoutineItem> {
        client.create(routine)
        return refreshAfterMutation { items ->
            items.any { item ->
                item.title == routine.title && item.date == routine.date && item.dayPart == routine.dayPart
            }
        }
    }

    private suspend fun refreshAfterMutation(
        appears: (List<RoutineItem>) -> Boolean = { true },
    ): List<RoutineItem> {
        var items = refresh()
        repeat(3) {
            if (appears(items)) return items
            delay(250)
            items = refresh()
        }
        return items
    }
}
