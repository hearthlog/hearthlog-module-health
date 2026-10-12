<script lang="ts">
    import { MediaQuery } from "svelte/reactivity";
    import IconStar from "~icons/mdi/star";
    import IconStarOutline from "~icons/mdi/star-outline";
    import { FoldLine } from "@hearthlog/sdk/ui";
    const phone = new MediaQuery("max-width: 767px");
    // The phone form layout is the form layout at every width (docs/design-concepts/desktop-backport-2026-10-05).
    const compactForm = true;
    import { formatNumber as formatCount } from "@hearthlog/sdk/format";
    const drawerId = $props.id();
    const drawerFormId0 = drawerId + "-0";
    let brandOpen = $state(false);

    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import { PageDataStatus } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";

    import { refreshPageData as invalidate } from "@hearthlog/sdk/runtime";
    import { tick } from "svelte";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { MobilePageAction } from "@hearthlog/sdk/ui";
    import { EmptyState } from "@hearthlog/sdk/ui";
    import HealthPageHeader from "../components/health/HealthPageHeader.svelte";
    import HealthHead from "../components/health/HealthHead.svelte";
    import FoodLibraryTable from "../components/calories/FoodLibraryTable.svelte";
    import { Button } from "@hearthlog/sdk/ui";
    import { Checkbox } from "@hearthlog/sdk/ui";
    import { Field } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Select } from "@hearthlog/sdk/ui";
    import { tenant } from "@hearthlog/sdk/runtime";
    import { CollectionToolbar } from "@hearthlog/sdk/ui";
    import {
        getKalFood,
        getKalMeta,
        searchKalFoods,
        type KalEanConfidence,
        type KalEanLookupResponse,
        type KalFood,
    } from "../api/kal.js";
    import FoodBarcodeScanner from "../components/calories/FoodBarcodeScanner.svelte";
    import {
        fetchImportedServingsUpdate,
        hasKnownCalories,
        loadMissingImportedServings,
        needsServingsRefresh,
        toExternalFoodImport,
        KAL_SOURCE_PROVIDER,
    } from "../calories/external-food.js";
    import {
        parseStoredServings,
        selectableServings,
        servingLabel,
        servingOptionLabel,
        type ImportedServingUpdate,
    } from "../calories/servings.js";
    import {
        DEFAULT_FOOD_PAGE_SIZE,
        FOOD_PAGE_SIZES,
        foodSortValue,
        parseFoodSort,
        validateFoodItemDraft,
        type FoodItemDraft,
        type FoodSort,
    } from "../calories/food-logic.js";
    import { parsePositiveInt } from "@hearthlog/sdk/runtime";
    import type { FoodItem } from "../data/calories.js";
    import {
        type AddFoodItemEvent,
        type RemoveFoodItemEvent,
        type UpdateFoodItemEvent,
    } from "@hearthlog/sdk/data";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { notify } from "@hearthlog/sdk/runtime";
    import IconFoodApple from "~icons/mdi/food-apple-outline";
    import IconBarcodeScan from "~icons/mdi/barcode-scan";
    import IconPlus from "~icons/mdi/plus";
    import IconRefresh from "~icons/mdi/refresh";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    const data = $derived(resource.data);
    providePageResource(() => resource);

    /** The whole library, for the lookups that need every food: scanning, editing, import detection, serving refresh. */
    let foodItems = $derived(data.foodItems as FoodItem[]);

    function sizeFromAddress(value: string | null): number {
        const size = parsePositiveInt(value, DEFAULT_FOOD_PAGE_SIZE);
        return (FOOD_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_FOOD_PAGE_SIZE;
    }

    let search = $state(page.url.searchParams.get('q') ?? '');
    let favoritesOnly = $state(page.url.searchParams.get('favorites') === '1');
    let sort = $state<FoodSort>(parseFoodSort(page.url.searchParams.get('sort')));
    let pageSize = $state(sizeFromAddress(page.url.searchParams.get('size')));
    let requestedPage = $state(parsePositiveInt(page.url.searchParams.get('page'), 1));
    const filtersActive = $derived(Boolean(search.trim()) || favoritesOnly);

    // SQLite filters, sorts and pages the library; the page on screen stays until the next one arrives.
    let foods = $state.raw<FoodItem[]>([]);
    let matchCount = $state(0);
    let foodsLoaded = $state(false);
    const pageCount = $derived(Math.max(1, Math.ceil(matchCount / pageSize)));
    // A page past the end, from an old address, reads as the last one once the count is known.
    const currentPage = $derived(foodsLoaded ? Math.min(requestedPage, pageCount) : requestedPage);

    /** Writes the state into the address: defaults leave it clean. */
    function writeAddress(history: 'push' | 'replace'): void {
        const url = new URL(window.location.href);
        const set = (key: string, value: string | null) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); };
        set('q', search.trim() || null);
        set('favorites', favoritesOnly ? '1' : null);
        set('sort', foodSortValue(sort));
        set('size', pageSize !== DEFAULT_FOOD_PAGE_SIZE ? String(pageSize) : null);
        set('page', requestedPage > 1 ? String(requestedPage) : null);
        if (history === 'push') goto(url, { shallow: true, state: page.state }); else goto(url, { shallow: true, replace: true, state: page.state });
    }

    /** A new search, filter or order starts again at the first page. */
    function setFilters(nextSearch: string, nextFavorites: boolean, history: 'push' | 'replace' = 'replace', nextSort: FoodSort = sort): void {
        search = nextSearch;
        favoritesOnly = nextFavorites;
        sort = nextSort;
        requestedPage = 1;
        writeAddress(history);
    }

    function setPage(next: number): void {
        requestedPage = Math.min(Math.max(1, next), pageCount);
        writeAddress('push');
    }

    function setPageSize(next: number): void {
        pageSize = next;
        requestedPage = 1;
        writeAddress('push');
    }

    function syncFiltersFromLocation(): void {
        const url = new URL(window.location.href);
        search = url.searchParams.get('q') ?? '';
        favoritesOnly = url.searchParams.get('favorites') === '1';
        sort = parseFoodSort(url.searchParams.get('sort'));
        pageSize = sizeFromAddress(url.searchParams.get('size'));
        requestedPage = parsePositiveInt(url.searchParams.get('page'), 1);
    }

    $effect(() => {
        const options = {
            search: search.trim(),
            favoritesOnly,
            sort: { column: sort.column, desc: sort.desc },
            limit: pageSize,
            offset: (currentPage - 1) * pageSize,
        };
        void resource.revision;
        if (resource.loading) return;
        let cancelled = false;
        void queryDatabase(async (repositories) => {
            const [rows, count] = await Promise.all([
                repositories.calories.searchFoodItems(options),
                repositories.calories.countFoodItems(options.search, options.favoritesOnly),
            ]);
            return { rows, count };
        })
            .then(({ rows, count }) => {
                if (cancelled) return;
                foods = rows;
                matchCount = count;
                foodsLoaded = true;
            })
            .catch((error) => { if (!cancelled) notify.error(error instanceof Error ? error.message : 'Could not search foods'); });
        return () => { cancelled = true; };
    });
    let externalFoods = $state<KalFood[]>([]);
    let externalLoading = $state(false);
    let externalError = $state("");
    let importingExternalId = $state<string | null>(null);
    let externalRequestId = 0;
    let drawerOpen = $state(false);
    let scannerOpen = $state(false);
    let editingId = $state<string | null>(null);
    let saving = $state(false);
    let errors = $state<Record<string, string>>({});
    let deleteId = $state<string | null>(null);
    let draft = $state<FoodItemDraft>(emptyDraft());
    let pendingManualEan = $state("");
    let servingsRefreshRequestId = 0;

    let editingFood = $derived(editingId ? foodItems.find((food) => food.id === editingId) ?? null : null);
    let editingSourceServings = $derived(parseStoredServings(editingFood?.source_servings_json ?? ""));
    let editingSelectableServings = $derived(selectableServings(editingSourceServings));
    let sourceServingValue = $derived.by(() => {
        const amount = Number(draft.defaultServingG ?? 0);
        const label = draft.servingLabel.trim();
        const index = editingSelectableServings.findIndex((serving) =>
            Math.abs(serving.amount - amount) < 0.001 && servingLabel(serving) === label);
        return index >= 0 ? String(index) : "";
    });

    let servingsRefreshRunning = $state(false);
    let servingsRefreshProgress = $state({ done: 0, total: 0 });
    let servingsUnavailable = $state<string[]>([]);
    let foodsNeedingServings = $derived(
        foodItems.filter((food) => needsServingsRefresh(food) && !servingsUnavailable.includes(food.id)),
    );

    $effect(() => {
        if (resource.loading) return;
        const query = search.trim();
        const requestId = ++externalRequestId;
        if (query.length < 2) {
            externalFoods = [];
            externalError = "";
            externalLoading = false;
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            externalLoading = true;
            externalError = "";
            void searchKalFoods(query, { signal: controller.signal })
                .then((result) => {
                    if (requestId === externalRequestId) externalFoods = result.items;
                })
                .catch((error) => {
                    if (error instanceof DOMException && error.name === "AbortError") return;
                    if (requestId !== externalRequestId) return;
                    externalFoods = [];
                    externalError = "Online food search is temporarily unavailable.";
                })
                .finally(() => {
                    if (requestId === externalRequestId) externalLoading = false;
                });
        }, 250);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    });

    function emptyDraft(): FoodItemDraft {
        return {
            name: "",
            brand: "",
            caloriesPer100g: null,
            proteinPer100g: 0,
            carbsPer100g: 0,
            fatPer100g: 0,
            defaultServingG: 100,
            servingLabel: "",
            favorite: false,
        };
    }

    function startCreate(ean = "") {
        editingId = null;
        draft = emptyDraft();
        pendingManualEan = ean;
        errors = {};
        drawerOpen = true;
    }

    function startEdit(food: FoodItem) {
        editingId = food.id;
        pendingManualEan = "";
        draft = {
            name: food.name,
            brand: food.brand,
            caloriesPer100g: food.calories_per_100g,
            proteinPer100g: food.protein_per_100g,
            carbsPer100g: food.carbs_per_100g,
            fatPer100g: food.fat_per_100g,
            defaultServingG: food.default_serving_g,
            servingLabel: food.serving_label,
            favorite: Boolean(food.favorite),
        };
        errors = {};
        drawerOpen = true;
        void refreshSourceServings(food);
    }

    function selectSourceServing(value: string) {
        const serving = editingSelectableServings[Number(value)];
        if (!serving) return;
        draft.defaultServingG = serving.amount;
        draft.servingLabel = servingLabel(serving);
    }

    /**
     * Backfill serving metadata for foods imported before the source API
     * exposed servings. Purely additive: the fetch never blocks the drawer,
     * the stored default is only replaced while it is still the 100 g placeholder,
     * and a failure leaves the food untouched.
     */
    async function refreshSourceServings(food: FoodItem) {
        const requestId = ++servingsRefreshRequestId;
        const update = await loadMissingImportedServings(food);
        if (!update) return;
        if (
            requestId === servingsRefreshRequestId
            && editingId === food.id
            && draft.defaultServingG === food.default_serving_g
            && draft.servingLabel === food.serving_label
        ) {
            if (update.defaultServingG !== undefined) draft.defaultServingG = update.defaultServingG;
            if (update.servingLabel !== undefined) draft.servingLabel = update.servingLabel;
        }
        try {
            const event: UpdateFoodItemEvent = {
                id: crypto.randomUUID(),
                type: "FOOD_ITEM_UPDATED",
                timestamp: Date.now(),
                payload: update,
            };
            await executeLocalCommand(event);
            await invalidate("app:foods", "app:calories");
        } catch (error) {
            console.error("Failed to refresh source servings:", error);
        }
    }

    const SERVINGS_REFRESH_CONCURRENCY = 4;
    const SERVINGS_REFRESH_BATCH_SIZE = 25;

    /**
     * Library-wide backfill: fetch servings for every kal import that still
     * lacks them, with bounded concurrency, and commit the updates in batches.
     * Foods the source has no picker servings for are skipped for this session;
     * failed lookups stay in the queue so the action can be retried.
     */
    async function refreshAllServings() {
        if (servingsRefreshRunning) return;
        const candidates = foodsNeedingServings;
        if (candidates.length === 0) return;

        servingsRefreshRunning = true;
        servingsRefreshProgress = { done: 0, total: candidates.length };

        const updates: ImportedServingUpdate[] = [];
        const unavailable: string[] = [];
        let cursor = 0;
        let failed = 0;

        try {
            const workers = Array.from(
                { length: Math.min(SERVINGS_REFRESH_CONCURRENCY, candidates.length) },
                async () => {
                    while (cursor < candidates.length) {
                        const food = candidates[cursor];
                        cursor += 1;
                        const result = await fetchImportedServingsUpdate(food);
                        if (result.status === "updated") updates.push(result.update);
                        else if (result.status === "empty") unavailable.push(food.id);
                        else failed += 1;
                        servingsRefreshProgress = {
                            done: servingsRefreshProgress.done + 1,
                            total: servingsRefreshProgress.total,
                        };
                    }
                },
            );
            await Promise.all(workers);

            for (let index = 0; index < updates.length; index += SERVINGS_REFRESH_BATCH_SIZE) {
                const events: UpdateFoodItemEvent[] = updates
                    .slice(index, index + SERVINGS_REFRESH_BATCH_SIZE)
                    .map((payload) => ({
                        id: crypto.randomUUID(),
                        type: "FOOD_ITEM_UPDATED",
                        timestamp: Date.now(),
                        payload,
                    }));
                await executeLocalCommand(events);
            }
            if (updates.length > 0) await invalidate("app:foods", "app:calories");
            if (unavailable.length > 0) servingsUnavailable = [...servingsUnavailable, ...unavailable];

            if (updates.length > 0) {
                notify.success(`Updated servings for ${updates.length} food${updates.length === 1 ? "" : "s"}`);
            }
            if (failed > 0) {
                notify.error(`${failed} food${failed === 1 ? "" : "s"} could not be loaded — try again later`);
            }
            if (updates.length === 0 && failed === 0) {
                notify.success("No extra source servings were available");
            }
        } catch (error) {
            console.error("Failed to refresh source servings:", error);
            notify.error("Could not refresh source servings");
        } finally {
            servingsRefreshRunning = false;
        }
    }

    function foodPayload() {
        return {
            name: draft.name.trim(),
            brand: draft.brand.trim(),
            caloriesPer100g: Number(draft.caloriesPer100g),
            proteinPer100g: Number(draft.proteinPer100g ?? 0),
            carbsPer100g: Number(draft.carbsPer100g ?? 0),
            fatPer100g: Number(draft.fatPer100g ?? 0),
            defaultServingG: Number(draft.defaultServingG),
            servingLabel: draft.servingLabel.trim(),
            favorite: draft.favorite,
        };
    }

    function importedFood(food: KalFood): FoodItem | undefined {
        return foodItems.find((item) =>
            item.source_provider === KAL_SOURCE_PROVIDER && item.source_id === food.guid);
    }

    async function importExternalFood(
        food: KalFood,
        provenance: { ean?: string; eanConfidence?: KalEanConfidence | "" } = {},
    ): Promise<boolean> {
        if (importingExternalId) return false;
        if (!hasKnownCalories(food)) {
            notify.error("This catalog item has no calorie value to import");
            return false;
        }
        if (importedFood(food)) {
            notify.success("This food is already in your library");
            return true;
        }

        importingExternalId = food.guid;
        try {
            const [metaResult, detailResult] = await Promise.allSettled([
                getKalMeta(),
                getKalFood(food.slug),
            ]);
            const dataVersion = metaResult.status === "fulfilled" ? metaResult.value.dataVersion : "";
            const servings = detailResult.status === "fulfilled" ? detailResult.value.servings : [];
            const imported = toExternalFoodImport(food, { dataVersion, ...provenance, servings });
            const event: AddFoodItemEvent = {
                id: crypto.randomUUID(),
                type: "FOOD_ITEM_ADDED",
                timestamp: Date.now(),
                payload: { ...imported },
            };
            await executeLocalCommand(event);
            notify.success("Food imported to your library");
            await invalidate("app:foods", "app:calories");
            return true;
        } catch (error) {
            console.error("Failed to import external food:", error);
            notify.error("Could not import this food");
            return false;
        } finally {
            importingExternalId = null;
        }
    }

    async function saveFood(event: SubmitEvent) {
        event.preventDefault();
        if (saving) return;
        errors = validateFoodItemDraft(draft);
        if (Object.keys(errors).length > 0) return;
        saving = true;
        try {
            if (editingId) {
                const updateEvent: UpdateFoodItemEvent = {
                    id: crypto.randomUUID(),
                    type: "FOOD_ITEM_UPDATED",
                    timestamp: Date.now(),
                    payload: { id: editingId, ...foodPayload() },
                };
                await executeLocalCommand(updateEvent);
                notify.success("Food updated");
            } else {
                const addEvent: AddFoodItemEvent = {
                    id: crypto.randomUUID(),
                    type: "FOOD_ITEM_ADDED",
                    timestamp: Date.now(),
                    payload: {
                        id: crypto.randomUUID(),
                        ...foodPayload(),
                        sourceProvider: "manual",
                        sourceId: "",
                        sourceSlug: "",
                        sourceDataVersion: "",
                        sourceMissingNutrients: "",
                        sourceEan: pendingManualEan,
                        sourceEanConfidence: "",
                        sourceServingsJson: "[]",
                    },
                };
                await executeLocalCommand(addEvent);
                notify.success("Food added to library");
            }
            drawerOpen = false;
            pendingManualEan = "";
            await invalidate("app:foods", "app:calories");
        } catch (error) {
            console.error("Failed to save food:", error);
            notify.error("Could not save the food");
        } finally {
            saving = false;
        }
    }

    function selectScannedLocalFood() {
        scannerOpen = false;
        notify.success("This food is already in your library");
    }

    async function importScannedFood(result: KalEanLookupResponse) {
        const imported = await importExternalFood(result.food, {
            ean: result.ean,
            eanConfidence: result.confidence,
        });
        if (imported) scannerOpen = false;
    }

    function searchAfterBarcodeScan() {
        scannerOpen = false;
        void tick().then(() => document.getElementById("food-library-page-search")?.focus());
    }

    function createAfterBarcodeScan(ean: string) {
        scannerOpen = false;
        startCreate(ean);
    }

    async function toggleFavorite(food: FoodItem) {
        try {
            const event: UpdateFoodItemEvent = {
                id: crypto.randomUUID(),
                type: "FOOD_ITEM_UPDATED",
                timestamp: Date.now(),
                payload: { id: food.id, favorite: !Boolean(food.favorite) },
            };
            await executeLocalCommand(event);
            await invalidate("app:foods", "app:calories");
        } catch (error) {
            console.error("Failed to update favorite:", error);
            notify.error("Could not update the favorite");
        }
    }

    async function removeFood() {
        if (!deleteId) return;
        const id = deleteId;
        deleteId = null;
        try {
            const event: RemoveFoodItemEvent = {
                id: crypto.randomUUID(),
                type: "FOOD_ITEM_REMOVED",
                timestamp: Date.now(),
                payload: { id },
            };
            await executeLocalCommand(event);
            notify.success("Food removed from library");
            await invalidate("app:foods", "app:calories");
        } catch (error) {
            console.error("Failed to remove food:", error);
            notify.error("Could not remove the food");
        }
    }

    function formatNumber(value: number): string {
        return formatCount(value, 1);
    }
</script>

<svelte:window onpopstate={syncFiltersFromLocation}></svelte:window>
<svelte:head><title>Food library | Health | {tenant.title}</title></svelte:head>
<PageDataStatus resource={resource} />

<div class="stor-refined w-full">
    <HealthPageHeader active="foods" />

    <div class="stor-page p-2.5 sm:p-3">
        <div class="max-md:hidden"><HealthHead title="Food library">
            {#snippet action()}
                <CommandOnly>
                    <Button onclick={() => startCreate()} disabled={saving}><IconPlus class="h-4 w-4" /> Add food</Button>
                </CommandOnly>
            {/snippet}
        </HealthHead></div>

        <CollectionToolbar count={foodsLoaded && !phone.current ? matchCount : null} noun="food" clearVisible={filtersActive} onClear={() => setFilters('', false, 'push')}>
        <div class="flex min-w-[min(100%,18rem)] flex-1 items-center gap-2"><div class="min-w-0 flex-1">
            <Input id="food-library-page-search" value={search} oninput={(event) => setFilters(event.currentTarget.value, favoritesOnly)} placeholder="Search foods or brands" aria-label="Search food library" /></div>
                <!-- Phones: Favorites is one toggle beside the search. -->
                <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl md:hidden {favoritesOnly ? 'bg-[var(--stor-accent-soft)] text-[var(--stor-accent-strong)]' : 'bg-[var(--stor-surface-raised)] text-[var(--stor-muted-text)] shadow-[var(--stor-elevation-1)]'}" aria-pressed={favoritesOnly} aria-label="Favorites only" onclick={() => setFilters(search, !favoritesOnly, 'push')}>
                    {#if favoritesOnly}<IconStar class="h-5 w-5" />{:else}<IconStarOutline class="h-5 w-5" />{/if}
                </button>
                <CommandOnly>
                <Button class="shrink-0" variant="secondary" onclick={() => scannerOpen = true} aria-label="Scan food barcode">
                        <IconBarcodeScan class="h-4 w-4" />
                        <span class="hidden sm:inline">Scan</span>
                    </Button>
                </CommandOnly>
                <CommandOnly>
                    {#if servingsRefreshRunning || foodsNeedingServings.length > 0}
                        <Button
                            class="shrink-0"
                            variant="secondary"
                            onclick={() => void refreshAllServings()}
                            disabled={servingsRefreshRunning}
                            aria-label={servingsRefreshRunning
                                ? `Refreshing source servings ${servingsRefreshProgress.done} of ${servingsRefreshProgress.total}`
                                : `Refresh source servings for ${foodsNeedingServings.length} food${foodsNeedingServings.length === 1 ? "" : "s"}`}
                        >
                            <IconRefresh class="h-4 w-4" />
                            <span class="hidden sm:inline">
                                {servingsRefreshRunning
                                    ? `Refreshing ${servingsRefreshProgress.done}/${servingsRefreshProgress.total}`
                                    : `Refresh servings (${foodsNeedingServings.length})`}
                            </span>
                        </Button>
                    {/if}
                </CommandOnly>
            </div>

        <div class="stor-segmented-control inline-flex max-md:!hidden" role="group" aria-label="Food filters">
            <button type="button" aria-pressed={!favoritesOnly} onclick={() => setFilters(search, false, 'push')} class="stor-segmented-option">All foods</button>
            <button type="button" aria-pressed={favoritesOnly} onclick={() => setFilters(search, true, 'push')} class="stor-segmented-option">Favorites</button>
            </div>
        </CollectionToolbar>
        <div>
        {#if resource.loading}
                <DataPlaceholder rows={5} />
            {:else if foodItems.length === 0}
                <EmptyState
                    title="Your food library is empty"
                    description="Add foods once, then reuse them whenever you log a meal."
                    icon={IconFoodApple}
                >
                    <CommandOnly>
                        <Button onclick={() => startCreate()}>Add first food</Button>
                    </CommandOnly>
                </EmptyState>
            {:else}
                <FoodLibraryTable
                    {foods}
                    total={matchCount}
                    loading={!foodsLoaded}
                    {sort}
                    page={currentPage}
                    {pageSize}
                    onSort={(next) => setFilters(search, favoritesOnly, 'push', next)}
                    onPage={setPage}
                    onPageSize={setPageSize}
                    onFavorite={(food) => void toggleFavorite(food)}
                    onEdit={startEdit}
                    onDelete={(food) => (deleteId = food.id)}
                >
                    {#snippet empty()}
                        <EmptyState surface={false} title="No foods found" description="Try another name or brand." icon={IconFoodApple} />
                    {/snippet}
                </FoodLibraryTable>
            {/if}

            {#if search.trim().length >= 2}
            <section class="stor-panel mt-6 p-[var(--stor-panel-padding)]">
                    <div class="flex items-baseline justify-between gap-3">
                        <div>
                            <h2 class="font-semibold text-[var(--stor-ink)]">Search Kalorické tabulky</h2>
                        <p class="mt-0.5 text-xs text-[var(--stor-muted-text)]">Public catalog · nutrition per 100 g</p>
                        </div>
                    {#if externalLoading}<span class="text-xs text-[var(--stor-info)]" role="status">Searching…</span>{/if}
                    </div>
                    {#if externalError}
                    <p class="mt-3 text-sm text-[var(--stor-warning)]" role="alert">{externalError}</p>
                    {:else if !externalLoading && externalFoods.length === 0}
                        <p class="mt-3 text-sm text-[var(--stor-muted-text)]">No online foods matched this search.</p>
                    {:else}
                        <div class="mt-3 space-y-1">
                            {#each externalFoods as food (food.guid)}
                                {@const localFood = importedFood(food)}
                            <div class="flex items-center justify-between gap-3 rounded-xl bg-[var(--stor-surface-muted)] px-3 py-2 ">
                                    <div class="min-w-0">
                                    <div class="truncate text-sm font-semibold text-[var(--stor-ink)]">{food.name}</div>
                                    {#if food.brand}<div class="truncate text-xs text-[var(--stor-muted-text)]">{food.brand}</div>{/if}
                                    <div class="mt-1 text-xs tabular-nums text-[var(--stor-muted-text)]">
                                        {food.energyKcal === null ? "Calories unavailable" : `${formatNumber(food.energyKcal)} kcal / 100 g`}
                                        · P {food.proteinG === null ? "—" : formatNumber(food.proteinG)}g
                                        · C {food.carbsG === null ? "—" : formatNumber(food.carbsG)}g
                                        · F {food.fatG === null ? "—" : formatNumber(food.fatG)}g
                                        </div>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={Boolean(localFood) || importingExternalId === food.guid || !hasKnownCalories(food)}
                                        onclick={() => void importExternalFood(food)}
                                    >
                                    {#if localFood}In library{:else if importingExternalId === food.guid}Importing…{:else if !hasKnownCalories(food)}Unavailable{:else}Import{/if}
                                    </Button>
                                </div>
                            {/each}
                        </div>
                    {/if}
                <p class="mt-3 text-[11px] text-[var(--stor-muted-text)]">Source: kaloricketabulky.cz · barcode data includes Open Food Facts mappings.</p>
                </section>
            {/if}
        </div>
    </div>
</div>

<MobilePageAction hideWhenModalOpen isModalOpen={drawerOpen || scannerOpen}>
    <Button class="h-12 w-full text-[15px]" onclick={() => startCreate()} disabled={saving}>
        <IconPlus class="h-5 w-5" /> <span class="stor-action-label">{saving ? "Saving…" : "Add food"}</span>
    </Button>
</MobilePageAction>

<CommandDrawer
    show={scannerOpen}
    title="Scan food barcode"
    description="Find a packaged food without uploading camera images."
    onClose={() => scannerOpen = false}
>
    {#if scannerOpen}
        <FoodBarcodeScanner
            purpose="library"
            localFoods={foodItems}
            onSelectLocal={selectScannedLocalFood}
            onSelectExternal={importScannedFood}
            onSearchByName={searchAfterBarcodeScan}
            onManualFood={createAfterBarcodeScan}
            onCancel={() => scannerOpen = false}
        />
    {/if}
</CommandDrawer>

<CommandDrawer
    show={drawerOpen}
    title={editingId ? "Edit food" : compactForm ? "New food" : "Add food"}
    onClose={() => { drawerOpen = false; pendingManualEan = ""; }}
>
    <form id={drawerFormId0} class="space-y-4" onsubmit={saveFood}>
        {#if pendingManualEan && !editingId}
            <div class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p class="text-xs font-semibold uppercase tracking-wide text-amber-800">Unmatched barcode</p>
                <p class="mt-1 text-sm tabular-nums text-[var(--stor-muted-text)]">{pendingManualEan}</p>
                <p class="mt-1 text-xs text-[var(--stor-muted-text)]">This code will be saved with the food for future offline scans.</p>
            </div>
        {/if}
        {#if compactForm}
            <!-- Phones: name with the star and the barcode, four numbers per 100 g, the usual portion; brand folds. -->
            <div class="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] gap-2">
                <label><span class="sr-only">Food name</span><Input id="food-item-name" bind:value={draft.name} placeholder="Name" aria-invalid={!!errors.name} /></label>
                <button type="button" class="grid h-11 w-11 place-items-center rounded-xl {draft.favorite ? 'bg-[var(--stor-warning-soft)] text-[var(--stor-warning)]' : 'bg-[var(--stor-surface-muted)] text-[var(--stor-muted-text)]'}" aria-pressed={draft.favorite} aria-label="Favorite" onclick={() => (draft.favorite = !draft.favorite)}>
                    {#if draft.favorite}<IconStar class="h-5 w-5" />{:else}<IconStarOutline class="h-5 w-5" />{/if}
                </button>
                <button type="button" class="grid h-11 w-11 place-items-center rounded-xl bg-[var(--stor-surface-muted)] text-[var(--stor-ink)]" aria-label="Scan food barcode" onclick={() => (scannerOpen = true)}><IconBarcodeScan class="h-5 w-5" /></button>
            </div>
            {#if errors.name}<p class="-mt-2 text-sm text-[var(--stor-negative)]" role="alert">{errors.name}</p>{/if}
            <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium text-[var(--stor-ink)]">Per 100 g</span>
                <div class="grid grid-cols-[1.3fr_1fr_1fr_1fr] gap-1.5">
                    <label><span class="mb-1 block text-center text-xs font-medium text-[var(--stor-muted-text)]" aria-label="Calories per 100 g">kcal</span><Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={draft.caloriesPer100g} placeholder="kcal" class="px-2 text-center" /></label>
                    <label><span class="mb-1 block text-center text-xs font-medium text-[var(--stor-muted-text)]" aria-label="Protein per 100 g">Protein g</span><Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={draft.proteinPer100g} placeholder="P g" class="px-2 text-center" /></label>
                    <label><span class="mb-1 block text-center text-xs font-medium text-[var(--stor-muted-text)]" aria-label="Carbs per 100 g">Carbs g</span><Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={draft.carbsPer100g} placeholder="C g" class="px-2 text-center" /></label>
                    <label><span class="mb-1 block text-center text-xs font-medium text-[var(--stor-muted-text)]" aria-label="Fat per 100 g">Fat g</span><Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={draft.fatPer100g} placeholder="F g" class="px-2 text-center" /></label>
                </div>
                {#if errors.caloriesPer100g || errors.proteinPer100g || errors.carbsPer100g || errors.fatPer100g}<p class="text-sm text-[var(--stor-negative)]" role="alert">{errors.caloriesPer100g ?? errors.proteinPer100g ?? errors.carbsPer100g ?? errors.fatPer100g}</p>{/if}
            </div>
            <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium text-[var(--stor-ink)]">Usual portion</span>
                <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                    <label class="relative"><span class="sr-only">Grams</span><Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={draft.defaultServingG} placeholder="100" class="pr-7 text-right" /><span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[var(--stor-muted-text)]">g</span></label>
                    <label><span class="sr-only">Portion name</span><Input bind:value={draft.servingLabel} placeholder="called… (1 cup)" /></label>
                </div>
                {#if errors.defaultServingG}<p class="text-sm text-[var(--stor-negative)]" role="alert">{errors.defaultServingG}</p>{/if}
            </div>
            {#if brandOpen || draft.brand}
                <Field label="Brand" htmlFor="food-item-brand"><Input id="food-item-brand" bind:value={draft.brand} /></Field>
            {:else}
                <FoldLine bind:open={brandOpen} tone="link" summary="Brand" />
            {/if}
        {:else}
        <Field label="Food name" htmlFor="food-item-name" required error={errors.name}>
            <Input id="food-item-name" bind:value={draft.name} placeholder="e.g. Greek yogurt" autofocus />
        </Field>
        <Field label="Brand" htmlFor="food-item-brand">
            <Input id="food-item-brand" bind:value={draft.brand} placeholder="Optional" />
        </Field>
        {/if}
        {#if !compactForm}
        <Field label="Calories per 100 g" htmlFor="food-item-calories" required error={errors.caloriesPer100g}>
            <Input id="food-item-calories" type="number" min="0" step="0.1" bind:value={draft.caloriesPer100g} placeholder="kcal" />
        </Field>
        <div class="grid grid-cols-3 gap-3">
            <Field label="Protein" htmlFor="food-item-protein" error={errors.proteinPer100g}>
                <Input id="food-item-protein" type="number" min="0" step="0.1" bind:value={draft.proteinPer100g} placeholder="g" />
            </Field>
            <Field label="Carbs" htmlFor="food-item-carbs" error={errors.carbsPer100g}>
                <Input id="food-item-carbs" type="number" min="0" step="0.1" bind:value={draft.carbsPer100g} placeholder="g" />
            </Field>
            <Field label="Fat" htmlFor="food-item-fat" error={errors.fatPer100g}>
                <Input id="food-item-fat" type="number" min="0" step="0.1" bind:value={draft.fatPer100g} placeholder="g" />
            </Field>
        </div>
        {/if}
        <div class="grid grid-cols-2 gap-3 {compactForm ? 'hidden' : ''}">
            <Field label="Default serving" htmlFor="food-item-serving" required hint="grams" error={errors.defaultServingG}>
                <Input id="food-item-serving" type="number" min="0" step="0.1" bind:value={draft.defaultServingG} placeholder="100" />
            </Field>
            <Field label="Serving label" htmlFor="food-item-serving-label" hint="optional">
                <Input id="food-item-serving-label" bind:value={draft.servingLabel} placeholder="e.g. 1 cup" />
            </Field>
        </div>
        {#if editingSelectableServings.length > 0}
            <Field label="Default serving from source" htmlFor="food-item-source-serving" hint="Kalorické tabulky">
                <Select
                    id="food-item-source-serving"
                    value={sourceServingValue}
                    options={editingSelectableServings.map((serving, index) => ({
                        value: String(index),
                        label: servingOptionLabel(serving),
                    }))}
                    onValueChange={selectSourceServing}
                />
            </Field>
        {/if}
        <label class="flex items-start gap-3 rounded-xl bg-[var(--stor-surface-muted)] p-3 {compactForm ? 'hidden' : ''}">
            <Checkbox
                checked={draft.favorite}
                onCheckedChange={(checked) => draft.favorite = Boolean(checked)}
                aria-label="Favorite"
            />
            <span>
                <span class="block text-sm font-semibold text-[var(--stor-ink)]">Favorite</span>
                <span class="mt-0.5 block text-xs text-[var(--stor-muted-text)]">Show this food before other library items.</span>
            </span>
        </label>
        </form>
    {#snippet footer()}
        <Button
            variant="secondary"
            onclick={() => drawerOpen = false}
        >Cancel</Button>

        <Button
            type="submit"
            form={drawerFormId0}
            disabled={saving}
        >{saving ? "Saving…" : editingId ? "Save changes" : compactForm ? "Add to library" : "Add food"}</Button>
    {/snippet}
</CommandDrawer>

<CommandConfirmDialog
    show={deleteId !== null}
    title="Delete food from library?"
    message="Existing diary entries keep their saved nutrition snapshot. This food will only disappear from future selection."
    onConfirm={removeFood}
    onCancel={() => deleteId = null}
/>
