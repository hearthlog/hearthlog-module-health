import type { ServerModule } from '@hearthlog/sdk/server';
import { FOOD_CATALOG_PREFIX, handleFoodCatalogRequest } from './food-catalog.js';
import { buildStepsAppend, parseStepsBody, parseStepsDate } from './steps.js';

/**
 * Health's part of the gateway Worker: the iPhone step count, one `activity_entry` per day, and the food
 * catalog behind the site's Access login.
 */
const health: ServerModule<Env> = {
    id: 'org.stor.health',
    routes: [{ prefix: FOOD_CATALOG_PREFIX, handle: (request, env) => handleFoodCatalogRequest(request, env) }],
    integrations: {
        async steps({ integration, segment, body, now, upsertEntity }) {
            const date = parseStepsDate(segment, now);
            const steps = parseStepsBody(body);
            const status = await upsertEntity(async (base) =>
                (await buildStepsAppend({ integrationId: integration.id, date, steps, base, now })).append);
            return { status, date, steps };
        },
    },
};

export default health;
