/** Health's read repositories, added to `queryDatabase` by the composer. */

import type { ReadModelSession } from '@hearthlog/sdk/data';
import { createActivityRepository } from './activities.js';
import { createCalorieRepository } from './calories.js';
import { createHealthDayRepository } from './health-day.js';
import { createWeightLogRepository } from './weight-logs.js';

export function createRepositories(session: ReadModelSession) {
    return {
        activities: createActivityRepository(session),
        calories: createCalorieRepository(session),
        healthDay: createHealthDayRepository(session),
        weightLogs: createWeightLogRepository(session),
    };
}
