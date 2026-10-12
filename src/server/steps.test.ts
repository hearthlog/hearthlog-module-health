import { describe, expect, it } from 'vitest';
import { handleIntegrationRequest, type IntegrationsEnv } from '@hearthlog/sdk/server-testing';
import { LedgerAdminAuthorizationError } from '@hearthlog/sdk/server';
import healthServer from './index';

const LOG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT = 'abcdef0123456789abcdef0123456789.access';
const NOW = Date.UTC(2026, 9, 4, 12, 0, 30);
const BASE = 'https://stor.example/api/integrations/v1/iphone-steps/steps';

interface StoredEvent { type: string; entityId: string; baseEntityVersion?: number; payload: Record<string, unknown> }

/** A Ledger that enforces the same version chain, idempotency and error bodies the real one returns. */
function ledger(options: { raceOnce?: boolean } = {}) {
    const versions = new Map<string, number>();
    const answered = new Map<string, { hash: string; status: number }>();
    const log: Array<{ actor: string | null; replay: string | null; body: { requestId: string; events: StoredEvent[] } }> = [];
    let raced = false;
    return {
        log,
        versions,
        fetch: async (request: Request) => {
            const body = await request.json() as { requestId: string; events: StoredEvent[] };
            log.push({ actor: request.headers.get('X-Ledger-Actor'), replay: request.headers.get('X-Ledger-Replay-Version'), body });
            const hash = JSON.stringify(body);
            const prior = answered.get(body.requestId);
            if (prior) {
                return prior.hash === hash
                    ? Response.json({ replayed: true }, { status: 200 })
                    : Response.json({ code: 'idempotency_mismatch' }, { status: 409 });
            }
            const [event] = body.events;
            const current = versions.get(event!.entityId);
            if (options.raceOnce && !raced && current !== undefined) {
                raced = true;
                versions.set(event!.entityId, current + 1);
            }
            const live = versions.get(event!.entityId);
            if (live !== undefined && event!.baseEntityVersion === undefined) {
                return Response.json({ code: 'invalid_entity_version_chain', expectedBaseEntityVersion: live }, { status: 409 });
            }
            if (live !== undefined && event!.baseEntityVersion !== live) {
                return Response.json({ code: 'entity_conflict', currentEntityVersion: live }, { status: 409 });
            }
            versions.set(event!.entityId, (live ?? 0) + 1);
            answered.set(body.requestId, { hash, status: 200 });
            return Response.json({ newVersion: 1 });
        },
    };
}

function env(ledgerFake = ledger(), overrides: Partial<IntegrationsEnv> = {}): IntegrationsEnv {
    return {
        CF_ACCESS_INTEGRATIONS_AUD: 'integrations-aud',
        CF_ACCESS_TEAM_DOMAIN: 'https://team.example',
        INTEGRATIONS: JSON.stringify([{ id: 'iphone-steps', kind: 'steps', logId: LOG, clientId: CLIENT }]),
        LEDGER: ledgerFake,
        LEDGER_AUTH_TOKEN: 'token',
        ...overrides,
    } as IntegrationsEnv;
}

const asClient = (clientId = CLIENT) => async () => ({ clientId });
const deny = async () => { throw new LedgerAdminAuthorizationError(); };

function put(date: string, body: unknown = { steps: 8421 }, init: RequestInit = {}) {
    return new Request(`${BASE}/${date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        ...init,
    });
}

const call = (request: Request, config = env(), authorize = asClient()) =>
    handleIntegrationRequest(request, config, [healthServer], authorize, () => NOW);

describe('steps ingest', () => {
    it('creates the day as the service, then updates it from the version Ledger names', async () => {
        const fake = ledger();
        const first = await call(put('2026-10-04'), env(fake));
        expect(first.status).toBe(200);
        expect(await first.json()).toEqual({ status: 'created', date: '2026-10-04', steps: 8421 });

        const second = await call(put('2026-10-04', { steps: 9100 }), env(fake));
        expect(await second.json()).toEqual({ status: 'updated', date: '2026-10-04', steps: 9100 });

        const sent = fake.log.map((entry) => entry.body.events[0]!);
        expect(sent.map((event) => event.type)).toEqual(['ACTIVITY_ENTRY_ADDED', 'ACTIVITY_ENTRY_ADDED', 'ACTIVITY_ENTRY_UPDATED']);
        expect(sent[0]!.payload).toMatchObject({ kind: 'steps', unit: 'steps', amount: 8421, loggedAt: '2026-10-04T00:00', source: 'iphone-steps', calorieSource: 'none' });
        expect(sent[2]).toMatchObject({ baseEntityVersion: 1, payload: { amount: 9100 } });
        expect(new Set(sent.map((event) => event.entityId)).size).toBe(1);
        expect(sent[0]!.entityId).toMatch(/^activity_entry:[0-9a-f-]{36}$/);
        expect(fake.log.every((entry) => entry.actor === 'service:iphone-steps' && entry.replay === '2')).toBe(true);
    });

    it('treats a retry inside the same minute as the same request', async () => {
        const fake = ledger();
        await call(put('2026-10-04'), env(fake));
        const retry = await call(put('2026-10-04'), env(fake));
        expect(retry.status).toBe(200);
        expect(fake.versions.size).toBe(1);
        expect([...fake.versions.values()]).toEqual([1]);
    });

    it('follows a concurrent edit to the version it finds', async () => {
        const fake = ledger({ raceOnce: true });
        await call(put('2026-10-04'), env(fake));
        const response = await call(put('2026-10-04', { steps: 9000 }), env(fake));
        expect(response.status).toBe(200);
        expect([...fake.versions.values()]).toEqual([3]);
    });

    it('only lets a token write the integration it belongs to', async () => {
        const fake = ledger();
        expect((await call(put('2026-10-04'), env(fake), asClient('another.access'))).status).toBe(404);
        const other = new Request('https://stor.example/api/integrations/v1/other/steps/2026-10-04', { method: 'PUT', body: '{}', headers: { 'Content-Type': 'application/json' } });
        expect((await call(other, env(fake))).status).toBe(404);
        expect((await call(put('2026-10-04'), env(fake, { INTEGRATIONS: '[]' }))).status).toBe(404);
        expect(fake.log).toHaveLength(0);
    });

    it('refuses anyone without a verified service token before reading the body', async () => {
        const fake = ledger();
        expect((await call(put('2026-10-04'), env(fake), deny)).status).toBe(403);
        expect(fake.log).toHaveLength(0);
    });

    it('is not a browser endpoint', async () => {
        const request = put('2026-10-04', { steps: 1 }, { headers: { 'Content-Type': 'application/json', Origin: 'https://stor.example' } });
        expect((await call(request)).status).toBe(403);
        expect((await call(new Request(`${BASE}/2026-10-04`, { method: 'POST', body: '{}' }))).status).toBe(405);
    });

    it('rejects values and dates that cannot be a day of steps', async () => {
        for (const body of [{ steps: -1 }, { steps: 1.5 }, { steps: '9' }, { steps: 200001 }, {}, [], 'x']) {
            expect((await call(put('2026-10-04', body))).status, JSON.stringify(body)).toBe(400);
        }
        expect((await call(put('2026-13-40'))).status).toBe(400);
        expect((await call(put('2026-09-01'))).status).toBe(422);
        expect((await call(put('2026-10-06'))).status).toBe(422);
        expect((await call(put('2026-10-05'))).status).toBe(200);
        expect((await call(put('2026-09-20'))).status).toBe(200);
        expect((await call(put('2026-10-04', 'x'.repeat(2000)))).status).toBe(413);
    });

    it('answers 429 when the rate limit refuses and does not write', async () => {
        const fake = ledger();
        const config = env(fake, { INTEGRATIONS_LIMITER: { limit: async () => ({ success: false }) } });
        expect((await call(put('2026-10-04'), config)).status).toBe(429);
        expect(fake.log).toHaveLength(0);
    });
});
