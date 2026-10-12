import type { ServerModule } from '@hearthlog/sdk/server';
import { buildStepsAppend, parseStepsBody, parseStepsDate } from './steps.js';

/** Health's part of the gateway Worker: the iPhone step count, one `activity_entry` per day. */
const health: ServerModule<Env> = {
    id: 'org.stor.health',
    routes: [],
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
