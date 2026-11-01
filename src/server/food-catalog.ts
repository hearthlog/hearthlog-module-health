import {
    authorizeStorRequest,
    LedgerAdminConfigurationError,
    type LedgerAdminIdentity,
    type StorAuthEnv,
} from '@hearthlog/sdk/server';

/** Where the site serves the food catalog; the client prefixes the catalog's `/v1/...` paths with it. */
export const FOOD_CATALOG_PREFIX = '/api/food-catalog';

/**
 * The food catalog Worker, bound as `KAL` from the `catalogWorker` setting. It needs no public hostname:
 * this route, behind the site's own Access session, is the way in.
 */
export type FoodCatalogEnv = StorAuthEnv & {
    KAL?: { fetch(request: Request): Promise<Response> };
};
type Authorizer = (request: Request, env: StorAuthEnv) => Promise<LedgerAdminIdentity>;

export async function handleFoodCatalogRequest(
    request: Request,
    env: FoodCatalogEnv,
    authorize: Authorizer = authorizeStorRequest,
): Promise<Response> {
    if (!env.KAL) {
        return Response.json(
            { error: 'The food catalog is not configured', code: 'food_catalog_unconfigured' },
            { status: 503 },
        );
    }
    // The catalog is read-only; nothing else is forwarded.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return Response.json(
            { error: 'The food catalog is read-only', code: 'method_not_allowed' },
            { status: 405, headers: { Allow: 'GET, HEAD' } },
        );
    }
    let publicUrl: URL;
    try {
        publicUrl = new URL(request.url);
    } catch {
        return Response.json({ error: 'The request URL is invalid', code: 'invalid_request_url' }, { status: 400 });
    }
    const browserOrigin = request.headers.get('Origin');
    if (browserOrigin !== null && browserOrigin !== publicUrl.origin) {
        return Response.json(
            { error: 'Cross-origin food catalog requests are not allowed', code: 'origin_not_allowed' },
            { status: 403 },
        );
    }
    try {
        await authorize(request, env);
    } catch (error) {
        if (error instanceof LedgerAdminConfigurationError) {
            return Response.json(
                { error: 'The food catalog is not configured', code: 'food_catalog_unconfigured' },
                { status: 503 },
            );
        }
        return Response.json({ error: 'Hearthlog access is required', code: 'food_catalog_forbidden' }, { status: 403 });
    }

    publicUrl.protocol = 'https:';
    publicUrl.host = 'food-catalog.internal';
    publicUrl.pathname = publicUrl.pathname === FOOD_CATALOG_PREFIX ? '/' : publicUrl.pathname.slice(FOOD_CATALOG_PREFIX.length);
    // Only what the catalog revalidates on goes upstream; browser credentials stay here.
    const headers = new Headers();
    for (const name of ['Accept', 'Accept-Encoding', 'If-None-Match', 'If-Modified-Since']) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    const response = await env.KAL.fetch(new Request(publicUrl, { method: request.method, headers }));
    // The catalog marks its answers public; behind a login they may sit in the browser's cache only.
    const cacheControl = response.headers.get('Cache-Control');
    if (cacheControl === null || !/\bpublic\b/i.test(cacheControl)) return response;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Cache-Control', cacheControl.replace(/\bpublic\b/i, 'private'));
    return new Response(response.body, { headers: responseHeaders, status: response.status, statusText: response.statusText });
}
