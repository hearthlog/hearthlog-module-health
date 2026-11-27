import { describe, expect, it, vi } from 'vitest';
import { LedgerAdminAuthorizationError } from '@hearthlog/sdk/server';
import { handleFoodCatalogRequest } from './food-catalog';

const storAccess = {
    CF_ACCESS_APP_AUD: 'app-audience',
    CF_ACCESS_TEAM_DOMAIN: 'https://stor.cloudflareaccess.com',
    STOR_AUTHORIZED_EMAILS: 'user@example.com',
};
const allow = async () => ({ email: 'user@example.com' });

describe('food catalog route', () => {
    it('forwards a verified request without browser credentials and keeps answers out of shared caches', async () => {
        const fetch = vi.fn(async (request: Request) => {
            const url = new URL(request.url);
            expect(url.pathname).toBe('/v1/foods');
            expect(url.searchParams.get('q')).toBe('nutella');
            expect(request.headers.get('cookie')).toBeNull();
            expect(request.headers.get('cf-access-jwt-assertion')).toBeNull();
            expect(request.headers.get('if-none-match')).toBe('"abc"');
            return Response.json({ items: [] }, { headers: { 'Cache-Control': 'public, max-age=60', ETag: '"abd"' } });
        });
        const response = await handleFoodCatalogRequest(
            new Request('https://stor.example/api/food-catalog/v1/foods?q=nutella', {
                headers: {
                    Cookie: 'CF_Authorization=browser',
                    'Cf-Access-Jwt-Assertion': 'jwt',
                    'If-None-Match': '"abc"',
                    Origin: 'https://stor.example',
                },
            }),
            { ...storAccess, KAL: { fetch } },
            allow,
        );
        expect(fetch).toHaveBeenCalledOnce();
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, max-age=60');
        expect(response.headers.get('etag')).toBe('"abd"');
    });

    it('refuses without an Access identity, cross-origin, or for writes', async () => {
        const fetch = vi.fn();
        const env = { ...storAccess, KAL: { fetch } };
        const deny = async () => { throw new LedgerAdminAuthorizationError(); };
        expect((await handleFoodCatalogRequest(new Request('https://stor.example/api/food-catalog/v1/foods'), env, deny)).status).toBe(403);
        expect((await handleFoodCatalogRequest(
            new Request('https://stor.example/api/food-catalog/v1/foods', { headers: { Origin: 'https://evil.example' } }), env, allow,
        )).status).toBe(403);
        expect((await handleFoodCatalogRequest(
            new Request('https://stor.example/api/food-catalog/v1/foods', { method: 'POST' }), env, allow,
        )).status).toBe(405);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('answers 503 when the site binds no catalog', async () => {
        const response = await handleFoodCatalogRequest(new Request('https://stor.example/api/food-catalog/v1/foods'), storAccess, allow);
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: 'food_catalog_unconfigured' });
    });
});
