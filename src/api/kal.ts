import { tenant } from '@hearthlog/sdk/runtime';

/**
 * The external food catalog's origin: the operator's `infrastructure.kalApiOrigin`
 * (compiled into the tenant), or `VITE_KAL_API_BASE_URL` for local development.
 * Empty means there is none, and catalog requests fail as unavailable.
 */
export const KAL_API_BASE_URL = (import.meta.env.VITE_KAL_API_BASE_URL ?? tenant.kalApiOrigin ?? '').replace(/\/$/, '');

export type KalEanConfidence = 'HIGH' | 'LOW';

export interface KalFood {
    slug: string;
    guid: string;
    name: string;
    brand: string;
    energyKcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
}

export interface KalServing {
    label: string | null;
    title: string;
    amount: number;
    unit: 'g' | 'ml';
}

export interface KalFoodEan {
    ean: string;
    confidence: KalEanConfidence;
    resolvedAt: string;
}

export interface KalFoodDetail extends KalFood {
    eans: KalFoodEan[];
    servings: KalServing[];
}

export interface KalFoodServingsResponse {
    slug: string;
    servings: KalServing[];
}

export interface KalSearchResponse {
    items: KalFood[];
    total: number;
    limit: number;
    offset: number;
}

export interface KalEanLookupResponse {
    ean: string;
    confidence: KalEanConfidence;
    resolvedAt: string;
    food: KalFood;
}

export interface KalMeta {
    dataVersion: string;
    builtAt: string;
    counts: {
        foods: number;
        eanMappings: number;
        servings: number;
        foodsWithServings: number;
    };
}

export class KalApiError extends Error {
    readonly status: number;
    readonly code: string | null;

    constructor(message: string, status: number, code: string | null = null) {
        super(message);
        this.name = 'KalApiError';
        this.status = status;
        this.code = code;
    }
}

const REQUEST_TIMEOUT_MS = 8000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new Error(`Invalid kal API field: ${field}`);
    return value;
}

function requiredNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid kal API field: ${field}`);
    }
    return value;
}

function optionalNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown, field: string): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid kal API field: ${field}`);
    }
    return value;
}

function parseFood(value: unknown): KalFood {
    if (!isRecord(value)) throw new Error('Invalid kal API food item');
    return {
        slug: requiredString(value.slug, 'slug'),
        guid: requiredString(value.guid, 'guid'),
        name: requiredString(value.name, 'name'),
        brand: requiredString(value.brand, 'brand'),
        energyKcal: nullableNumber(value.energyKcal, 'energyKcal'),
        proteinG: nullableNumber(value.proteinG, 'proteinG'),
        carbsG: nullableNumber(value.carbsG, 'carbsG'),
        fatG: nullableNumber(value.fatG, 'fatG'),
        fiberG: nullableNumber(value.fiberG, 'fiberG'),
    };
}

function parseServing(value: unknown): KalServing {
    if (!isRecord(value)) throw new Error('Invalid kal API serving');
    const label = value.label === null ? null : requiredString(value.label, 'label');
    const title = requiredString(value.title, 'title');
    const amount = requiredNumber(value.amount, 'amount');
    if (amount < 0) throw new Error('Invalid kal API field: amount');
    const unit = requiredString(value.unit, 'unit');
    if (unit !== 'g' && unit !== 'ml') throw new Error('Invalid kal API field: unit');
    return { label, title, amount, unit };
}

function parseServings(value: unknown): KalServing[] {
    // Tolerate a missing or non-array `servings` field: an import without
    // servings is still useful, it just falls back to the generic 100 g unit.
    return Array.isArray(value) ? value.map(parseServing) : [];
}

function parseFoodEan(value: unknown): KalFoodEan {
    if (!isRecord(value)) throw new Error('Invalid kal API barcode mapping');
    const confidence = requiredString(value.confidence, 'confidence');
    if (confidence !== 'HIGH' && confidence !== 'LOW') {
        throw new Error('Invalid kal API field: confidence');
    }
    return {
        ean: requiredString(value.ean, 'ean'),
        confidence,
        resolvedAt: requiredString(value.resolvedAt, 'resolvedAt'),
    };
}

function parseSearchResponse(value: unknown): KalSearchResponse {
    if (!isRecord(value) || !Array.isArray(value.items)) {
        throw new Error('Invalid kal API search response');
    }
    if (
        typeof value.total !== 'number' ||
        typeof value.limit !== 'number' ||
        typeof value.offset !== 'number'
    ) {
        throw new Error('Invalid kal API search pagination');
    }
    return {
        items: value.items.map(parseFood),
        total: value.total,
        limit: value.limit,
        offset: value.offset,
    };
}

function parseEanLookupResponse(value: unknown): KalEanLookupResponse {
    if (!isRecord(value) || !isRecord(value.food)) {
        throw new Error('Invalid kal API barcode lookup response');
    }
    const confidence = requiredString(value.confidence, 'confidence');
    if (confidence !== 'HIGH' && confidence !== 'LOW') {
        throw new Error('Invalid kal API field: confidence');
    }
    const resolvedAt = requiredString(value.resolvedAt, 'resolvedAt');
    if (!Number.isFinite(Date.parse(resolvedAt))) {
        throw new Error('Invalid kal API field: resolvedAt');
    }
    return {
        ean: requiredString(value.ean, 'ean'),
        confidence,
        resolvedAt,
        food: parseFood(value.food),
    };
}

function parseFoodDetail(value: unknown): KalFoodDetail {
    if (!isRecord(value)) throw new Error('Invalid kal API food detail');
    const eans = Array.isArray(value.eans) ? value.eans.map(parseFoodEan) : [];
    return { ...parseFood(value), eans, servings: parseServings(value.servings) };
}

function parseFoodServingsResponse(value: unknown): KalFoodServingsResponse {
    if (!isRecord(value)) throw new Error('Invalid kal API servings response');
    return {
        slug: requiredString(value.slug, 'slug'),
        servings: parseServings(value.servings),
    };
}

function parseMeta(value: unknown): KalMeta {
    if (!isRecord(value) || !isRecord(value.counts)) {
        throw new Error('Invalid kal API metadata response');
    }
    if (
        typeof value.counts.foods !== 'number' ||
        typeof value.counts.eanMappings !== 'number'
    ) {
        throw new Error('Invalid kal API metadata counts');
    }
    return {
        dataVersion: requiredString(value.dataVersion, 'dataVersion'),
        builtAt: requiredString(value.builtAt, 'builtAt'),
        counts: {
            foods: value.counts.foods,
            eanMappings: value.counts.eanMappings,
            servings: optionalNumber(value.counts.servings),
            foodsWithServings: optionalNumber(value.counts.foodsWithServings),
        },
    };
}

async function requestJson<T>(path: string, parser: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    let response: Response;
    const requestController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        requestController.abort();
    }, REQUEST_TIMEOUT_MS);
    const forwardAbort = () => requestController.abort();
    if (signal?.aborted) requestController.abort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    if (!KAL_API_BASE_URL) throw new KalApiError('The external food catalog is not configured.', 0);
    try {
        response = await fetch(`${KAL_API_BASE_URL}${path}`, {
            headers: { Accept: 'application/json' },
            signal: requestController.signal,
        });
    } catch (error) {
        if (signal?.aborted) throw error;
        if (timedOut) throw new KalApiError('The external food catalog request timed out.', 408);
        throw new KalApiError('The external food catalog is unavailable.', 0);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', forwardAbort);
    }

    if (!response.ok) {
        let message = `The external food catalog returned HTTP ${response.status}.`;
        let code: string | null = null;
        try {
            const problem = await response.json() as unknown;
            if (isRecord(problem)) {
                if (typeof problem.detail === 'string') message = problem.detail;
                else if (typeof problem.title === 'string') message = problem.title;
                if (typeof problem.code === 'string') code = problem.code;
            }
        } catch {
            // Keep the status-based message when the problem body is unavailable.
        }
        throw new KalApiError(message, response.status, code);
    }

    try {
        return parser(await response.json());
    } catch (error) {
        if (error instanceof KalApiError) throw error;
        throw new KalApiError(
            error instanceof Error ? error.message : 'The external food catalog returned invalid data.',
            response.status,
        );
    }
}

export async function searchKalFoods(
    query: string,
    options: { signal?: AbortSignal; limit?: number } = {},
): Promise<KalSearchResponse> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { items: [], total: 0, limit: 0, offset: 0 };
    const params = new URLSearchParams({
        q: trimmed.slice(0, 128),
        limit: String(Math.min(Math.max(options.limit ?? 20, 1), 100)),
        offset: '0',
    });
    return requestJson(`/v1/foods?${params}`, parseSearchResponse, options.signal);
}

export function getKalFood(
    slug: string,
    options: { signal?: AbortSignal } = {},
): Promise<KalFoodDetail> {
    const trimmed = slug.trim();
    if (!trimmed) {
        return Promise.reject(new KalApiError('A food slug is required.', 400, 'invalid_slug'));
    }
    return requestJson(`/v1/foods/${encodeURIComponent(trimmed)}`, parseFoodDetail, options.signal);
}

export function getKalFoodServings(
    slug: string,
    options: { signal?: AbortSignal } = {},
): Promise<KalFoodServingsResponse> {
    const trimmed = slug.trim();
    if (!trimmed) {
        return Promise.reject(new KalApiError('A food slug is required.', 400, 'invalid_slug'));
    }
    return requestJson(
        `/v1/foods/${encodeURIComponent(trimmed)}/servings`,
        parseFoodServingsResponse,
        options.signal,
    );
}

export function lookupKalFoodByEan(
    ean: string,
    options: { signal?: AbortSignal } = {},
): Promise<KalEanLookupResponse> {
    if (!/^\d{8,14}$/.test(ean)) {
        return Promise.reject(new KalApiError('Enter 8 to 14 barcode digits.', 400, 'invalid_ean'));
    }
    return requestJson(
        `/v1/eans/${encodeURIComponent(ean)}`,
        parseEanLookupResponse,
        options.signal,
    );
}

export function getKalMeta(options: { signal?: AbortSignal } = {}): Promise<KalMeta> {
    return requestJson('/v1/meta', parseMeta, options.signal);
}
