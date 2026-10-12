<script lang="ts">
    import { tick } from "svelte";
    import { format, parseISO } from "date-fns";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Textarea } from "@hearthlog/sdk/ui";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import type { CalorieEntry, FoodItem } from "@hearthlog/sdk/data";
    import type { AddCalorieEntryEvent, AddFoodItemEvent } from "@hearthlog/sdk/data";
    import { getKalFood, getKalMeta, searchKalFoods, type KalFood } from "../../api/kal.js";
    import { externalImportToFoodItem, hasKnownCalories, KAL_SOURCE_PROVIDER, toExternalFoodImport, type ExternalFoodImport } from "../../calories/external-food.js";
    import { effectiveMealSlots, mealForTime, normalizeLocalDateTime, validateCalorieEntryDraft, type StoredMealSlot } from "../../calories/logic.js";
    import { refreshPageData } from "@hearthlog/sdk/runtime";
    import { contextualHref } from "@hearthlog/sdk/runtime";
    import { notify } from "@hearthlog/sdk/runtime";
    import { calculateNutritionForQuantity, specificServingLabel } from "../../calories/food-logic.js";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconMinus from "~icons/mdi/minus";
    import IconClose from "~icons/mdi/close";
    import IconSearch from "~icons/mdi/magnify";
    import IconPlus from "~icons/mdi/plus";
    import IconChevronRight from "~icons/mdi/chevron-right";

    /**
     * Logging food over the page you are on (phones): search what you logged
     * before, or enter a name and calories; part of day and the time follow the
     * day, and the rest folds. A recent food fills the form, it never saves on
     * its own. Library foods take a portion (named serving or grams) on a
     * stepper and compute the rest. Online foods (the external catalog) sit
     * beside them as a source of their own: choosing one imports it into the
     * library when the entry is saved. Barcode scanning stays on Nutrition.
     */
    let {
        show,
        date,
        today,
        mealSlots,
        meal,
        onClose,
    }: {
        show: boolean;
        date: string;
        today: string;
        mealSlots: StoredMealSlot[];
        /** A part of day to start on, e.g. from a meal's +. */
        meal?: string;
        onClose: () => void;
    } = $props();

    const slots = $derived(effectiveMealSlots(mealSlots).filter((slot) => !slot.archived));

    let name = $state("");
    let calories = $state<number | null>(null);
    let proteinG = $state<number | null>(null);
    let carbsG = $state<number | null>(null);
    let fatG = $state<number | null>(null);
    let mealType = $state("");
    let time = $state("");
    let notes = $state("");
    let foodItemId = $state("");
    let quantityG = $state<number | null>(null);
    let portionLabel = $state("");
    let detailsOpen = $state(false);
    let timeOpen = $state(false);
    let search = $state("");
    let recent = $state<CalorieEntry[]>([]);
    let source = $state<"recent" | "library" | "online">("recent");
    let online = $state<KalFood[]>([]);
    let onlineLoading = $state(false);
    let onlineError = $state("");
    let importingId = $state<string | null>(null);
    /** The catalog food chosen, saved to the library together with the entry. */
    let pendingImport = $state<ExternalFoodImport | null>(null);
    let library = $state<FoodItem[]>([]);
    let food = $state<FoodItem | null>(null);
    let portion = $state(1);
    let errors = $state<Record<string, string>>({});
    let saving = $state(false);
    /** One identity per save, so retrying the same save stays idempotent. */
    let submissionId = crypto.randomUUID();

    const chip = (on: boolean) => `h-9 rounded-full px-3.5 text-sm font-medium ${on ? "bg-[var(--stor-accent-soft)] font-semibold text-[var(--stor-accent-strong)]" : "bg-[var(--stor-surface-muted)] text-[var(--stor-ink)]"}`;

    function reset(): void {
        const now = new Date();
        name = "";
        calories = null;
        proteinG = carbsG = fatG = null;
        notes = "";
        foodItemId = "";
        quantityG = null;
        portionLabel = "";
        time = date === today ? format(now, "HH:mm") : "12:00";
        const usual = mealForTime(date === today ? now : `${date}T12:00`);
        mealType = slots.find((slot) => slot.id === meal)?.id ?? slots.find((slot) => slot.id === usual)?.id ?? slots[0]?.id ?? usual;
        detailsOpen = false;
        timeOpen = false;
        search = "";
        source = "recent";
        food = null;
        pendingImport = null;
        online = [];
        onlineError = "";
        portion = 1;
        errors = {};
        submissionId = crypto.randomUUID();
    }

    let opened = false;
    $effect(() => {
        if (show && !opened) {
            opened = true;
            reset();
        } else if (!show) {
            opened = false;
        }
    });

    // What was logged before, narrowed by name in SQL as you type.
    $effect(() => {
        const term = search;
        if (!show) return;
        let current = true;
        const timer = setTimeout(() => {
            void queryDatabase((repositories) => repositories.calories.getRecentEntries(term, 5))
                .then((rows) => { if (current) recent = rows; })
                .catch(() => { if (current) recent = []; });
        }, term ? 150 : 0);
        return () => { current = false; clearTimeout(timer); };
    });

    // Library foods matching the search, ranked in SQL (favorites first).
    $effect(() => {
        const term = search;
        if (!show || source !== "library") return;
        let current = true;
        const timer = setTimeout(() => {
            void queryDatabase((repositories) => repositories.calories.searchFoodItems({ search: term, favoritesOnly: false, sort: { column: null, desc: false }, limit: 6, offset: 0 }))
                .then((rows) => { if (current) library = rows; })
                .catch(() => { if (current) library = []; });
        }, term ? 150 : 0);
        return () => { current = false; clearTimeout(timer); };
    });

    // The external catalog, searched as you type (two letters or more).
    $effect(() => {
        const term = search.trim();
        if (!show || source !== "online") return;
        if (term.length < 2) {
            online = [];
            onlineError = "";
            onlineLoading = false;
            return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => {
            onlineLoading = true;
            onlineError = "";
            void searchKalFoods(term, { signal: controller.signal })
                .then((result) => { if (!controller.signal.aborted) online = result.items; })
                .catch((error) => {
                    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
                    online = [];
                    onlineError = "Online food search is temporarily unavailable.";
                })
                .finally(() => { if (!controller.signal.aborted) onlineLoading = false; });
        }, 250);
        return () => { clearTimeout(timer); controller.abort(); };
    });

    /** The named serving of the chosen food, or null when it is counted in grams. */
    const serving = $derived(food ? specificServingLabel(food) : null);
    const servingG = $derived(food && serving && food.default_serving_g > 0 ? food.default_serving_g : 0);
    const portionStep = $derived(servingG ? 0.5 : 10);

    function applyPortion(): void {
        if (!food) return;
        const grams = servingG ? portion * servingG : portion;
        const totals = calculateNutritionForQuantity(food, grams);
        calories = Math.round(totals.calories);
        proteinG = totals.proteinG;
        carbsG = totals.carbsG;
        fatG = totals.fatG;
        quantityG = Number(grams.toFixed(1));
        portionLabel = servingG ? `${portion} × ${serving}` : `${quantityG} g`;
    }

    function useFood(item: FoodItem): void {
        food = item;
        name = item.name;
        foodItemId = item.id;
        portion = specificServingLabel(item) && item.default_serving_g > 0 ? 1 : (item.default_serving_g || 100);
        search = "";
        errors = {};
        applyPortion();
    }

    /** Chooses a catalog food: one already in the library is used as is, a new one is imported on save. */
    async function useOnline(item: KalFood): Promise<void> {
        if (importingId) return;
        if (!hasKnownCalories(item)) {
            notify.error("This catalog item has no calorie value to use");
            return;
        }
        importingId = item.guid;
        try {
            const existing = await queryDatabase((repositories) => repositories.calories.getFoodItemBySource(KAL_SOURCE_PROVIDER, item.guid));
            if (existing) {
                useFood(existing);
                return;
            }
            const [meta, detail] = await Promise.allSettled([getKalMeta(), getKalFood(item.slug)]);
            const imported = toExternalFoodImport(item, {
                dataVersion: meta.status === "fulfilled" ? meta.value.dataVersion : "",
                servings: detail.status === "fulfilled" ? detail.value.servings : [],
            });
            useFood(externalImportToFoodItem(imported));
            pendingImport = imported;
        } catch {
            notify.error("The food could not be loaded. Try again.");
        } finally {
            importingId = null;
        }
    }

    function stepPortion(direction: 1 | -1): void {
        portion = Math.max(portionStep, Number((portion + direction * portionStep).toFixed(2)));
        applyPortion();
    }

    function clearFood(): void {
        food = null;
        pendingImport = null;
        name = "";
        calories = null;
        proteinG = carbsG = fatG = quantityG = null;
        foodItemId = portionLabel = "";
    }

    async function useRecent(entry: CalorieEntry): Promise<void> {
        name = entry.name;
        calories = Number(entry.calories);
        proteinG = Number(entry.protein_g) || null;
        carbsG = Number(entry.carbs_g) || null;
        fatG = Number(entry.fat_g) || null;
        foodItemId = entry.food_item_id ?? "";
        quantityG = Number(entry.quantity_g) || null;
        portionLabel = entry.portion_label ?? "";
        search = "";
        errors = {};
        await tick();
        document.getElementById("quick-food-calories")?.focus();
    }

    async function save(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (saving) return;
        const loggedAt = `${date}T${time || "12:00"}`;
        const draft = { name, calories, proteinG, carbsG, fatG, mealType, loggedAt, notes, foodItemId, quantityG, portionLabel };
        errors = validateCalorieEntryDraft(draft);
        if (calories === null) errors.calories = "Enter the calories.";
        if (errors.proteinG || errors.carbsG || errors.fatG || errors.quantityG) detailsOpen = true;
        if (Object.keys(errors).length > 0) return;
        saving = true;
        const addEvent: AddCalorieEntryEvent = {
            id: crypto.randomUUID(),
            type: "CALORIE_ENTRY_ADDED",
            timestamp: Date.now(),
            payload: {
                id: crypto.randomUUID(),
                name: name.trim(),
                calories: Number(calories),
                proteinG: Number(proteinG ?? 0),
                carbsG: Number(carbsG ?? 0),
                fatG: Number(fatG ?? 0),
                mealType,
                loggedAt: normalizeLocalDateTime(loggedAt),
                foodItemId,
                quantityG: Number(quantityG ?? 0),
                portionLabel,
                notes: notes.trim(),
            },
        };
        try {
            if (pendingImport) {
                const foodEvent: AddFoodItemEvent = { id: crypto.randomUUID(), type: "FOOD_ITEM_ADDED", timestamp: Date.now(), payload: { ...pendingImport } };
                await executeLocalCommand([foodEvent, addEvent], { submissionId });
            } else {
                await executeLocalCommand(addEvent, { submissionId });
            }
            onClose();
            notify.success(`${name.trim()} logged`);
            await refreshPageData("app:calories");
        } catch (error) {
            console.error("Failed to log food:", error);
            errors = { form: "The food could not be saved. Your values are still here." };
        } finally {
            saving = false;
        }
    }

    const slotLabel = $derived(slots.find((slot) => slot.id === mealType)?.label ?? "");
    const whenLabel = $derived(`${slotLabel ? `${slotLabel} · ` : ""}${date === today ? "today" : format(parseISO(date), "EEE d MMM")} at ${time}`);
</script>

<CommandDrawer {show} title="Log food" {onClose}>
    <form id="quick-food-form" class="flex flex-col gap-4" onsubmit={save}>
        <button type="button" class="self-start text-[13px] font-medium text-[var(--stor-muted-text)] underline decoration-dotted underline-offset-4" aria-expanded={timeOpen} onclick={() => (timeOpen = !timeOpen)}>{whenLabel}</button>
        {#if timeOpen}
            <label class="block text-sm font-medium text-[var(--stor-ink)]">
                Time
                <Input type="time" bind:value={time} class="mt-1.5" />
            </label>
        {/if}

        {#if food}
            <div class="flex flex-col gap-3 rounded-xl bg-[var(--stor-surface-muted)] p-3">
                <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                        <p class="truncate text-[15px] font-semibold text-[var(--stor-ink)]">{food.name}</p>
                        <p class="text-[13px] tabular-nums text-[var(--stor-muted-text)]">{formatNumber(Number(calories))} kcal · P {formatNumber(Number(proteinG))} · C {formatNumber(Number(carbsG))} · F {formatNumber(Number(fatG))} g</p>
                    </div>
                    <button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--stor-muted-text)]" aria-label="Choose another food" onclick={clearFood}><IconClose class="h-5 w-5" /></button>
                </div>
                <div class="flex items-center gap-2" role="group" aria-label="Portion">
                    <button type="button" class="grid h-11 w-11 place-items-center rounded-xl bg-[var(--stor-surface)] text-[var(--stor-ink)]" aria-label="Less" onclick={() => stepPortion(-1)}><IconMinus class="h-5 w-5" /></button>
                    <label class="relative min-w-0 flex-1"><span class="sr-only">{servingG ? `Number of ${serving}` : "Grams"}</span>
                        <Input type="number" inputmode="decimal" min="0" step={portionStep} bind:value={portion} oninput={applyPortion} class="pr-16 text-center text-[17px] font-semibold" />
                        <span class="pointer-events-none absolute inset-y-0 right-3 flex max-w-14 items-center truncate text-sm text-[var(--stor-muted-text)]">{servingG ? `× ${serving}` : "g"}</span>
                    </label>
                    <button type="button" class="grid h-11 w-11 place-items-center rounded-xl bg-[var(--stor-surface)] text-[var(--stor-ink)]" aria-label="More" onclick={() => stepPortion(1)}><IconPlus class="h-5 w-5" /></button>
                </div>
                {#if servingG}<p class="-mt-1 text-[13px] tabular-nums text-[var(--stor-muted-text)]">{formatNumber(Number(quantityG))} g</p>{/if}
            </div>
        {:else}
        <div class="flex gap-1 rounded-full bg-[var(--stor-surface-muted)] p-1 text-sm font-medium" role="group" aria-label="Where to look">
            {#each [["recent", "Recent"], ["library", "Library"], ["online", "Online"]] as const as [id, label] (id)}
                <button type="button" class="h-9 flex-1 rounded-full {source === id ? 'stor-raised bg-[var(--stor-surface)] font-semibold text-[var(--stor-ink)]' : 'text-[var(--stor-muted-text)]'}" aria-pressed={source === id} onclick={() => (source = id)}>{label}</button>
            {/each}
        </div>
        <div>
            <label class="relative block">
                <span class="sr-only">{source === "online" ? "Search the online catalog" : "Search what you logged before"}</span>
                <IconSearch class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--stor-muted-text)]" />
                <Input bind:value={search} placeholder={source === "library" ? "Search the library" : source === "online" ? "Search online foods" : "Search your foods"} class="pl-10" autocomplete="off" />
            </label>
            {#if source === "library"}
                {#if library.length > 0}
                    <ul class="mt-2 divide-y divide-[color-mix(in_srgb,var(--stor-border)_62%,transparent)]">
                        {#each library as item (item.id)}
                            <li>
                                <button type="button" class="flex min-h-12 w-full items-center gap-3 text-left" onclick={() => useFood(item)} aria-label={`Choose ${item.name}`}>
                                    <span class="min-w-0 flex-1">
                                        <span class="block truncate text-[15px] font-medium text-[var(--stor-ink)]">{item.name}</span>
                                        {#if item.brand}<span class="block truncate text-[12.5px] text-[var(--stor-muted-text)]">{item.brand}</span>{/if}
                                    </span>
                                    <span class="shrink-0 text-[13.5px] tabular-nums text-[var(--stor-muted-text)]">{formatNumber(Number(item.calories_per_100g))} kcal/100 g</span>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="mt-2 text-sm text-[var(--stor-muted-text)]">{search.trim() ? "No library food by that name." : "The library is empty."}</p>
                {/if}
            {:else if source === "online"}
                {#if online.length > 0}
                    <ul class="mt-2 divide-y divide-[color-mix(in_srgb,var(--stor-border)_62%,transparent)]">
                        {#each online as item (item.guid)}
                            <li>
                                <button type="button" class="flex min-h-12 w-full items-center gap-3 text-left disabled:opacity-60" disabled={importingId !== null} onclick={() => void useOnline(item)} aria-label={`Choose ${item.name}`}>
                                    <span class="min-w-0 flex-1">
                                        <span class="block truncate text-[15px] font-medium text-[var(--stor-ink)]">{item.name}</span>
                                        {#if item.brand}<span class="block truncate text-[12.5px] text-[var(--stor-muted-text)]">{item.brand}</span>{/if}
                                    </span>
                                    <span class="shrink-0 text-[13.5px] tabular-nums text-[var(--stor-muted-text)]">{importingId === item.guid ? "Loading…" : hasKnownCalories(item) ? `${formatNumber(Number(item.energyKcal))} kcal/100 g` : "No calories"}</span>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {:else if onlineError}
                    <p class="mt-2 text-sm text-[var(--stor-negative)]" role="alert">{onlineError}</p>
                {:else}
                    <p class="mt-2 text-sm text-[var(--stor-muted-text)]" role="status">{onlineLoading ? "Searching…" : search.trim().length < 2 ? "Type a food to search the online catalog." : "No online food by that name."}</p>
                {/if}
            {:else if recent.length > 0}
                <p class="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">{search.trim() ? "Matches" : "Recent"}</p>
                <ul class="divide-y divide-[color-mix(in_srgb,var(--stor-border)_62%,transparent)]">
                    {#each recent as entry (entry.id)}
                        <li>
                            <button type="button" class="flex min-h-12 w-full items-center gap-3 text-left" onclick={() => void useRecent(entry)} aria-label={`Fill with ${entry.name}, ${formatNumber(Number(entry.calories))} kcal`}>
                                <span class="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--stor-ink)]">{entry.name}</span>
                                <span class="shrink-0 text-[13.5px] tabular-nums text-[var(--stor-muted-text)]">{formatNumber(Number(entry.calories))} kcal</span>
                                <span class="stor-tone-eat grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--tone)]" style:background="color-mix(in srgb, var(--tone) 14%, var(--stor-surface))"><IconPlus class="h-5 w-5" /></span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {:else if search.trim()}
                <p class="mt-2 text-sm text-[var(--stor-muted-text)]">Nothing logged by that name. Enter it below.</p>
            {/if}
        </div>
        {/if}

        <div class="grid grid-cols-[minmax(0,1fr)_7rem] gap-2" class:hidden={food}>
            <label class="block">
                <span class="sr-only">Food</span>
                <Input id="quick-food-name" bind:value={name} placeholder="Food" aria-invalid={!!errors.name} />
            </label>
            <label class="block">
                <span class="sr-only">Calories</span>
                <div class="relative">
                    <Input id="quick-food-calories" type="number" inputmode="decimal" min="0" step="1" bind:value={calories} placeholder="kcal" class="pr-11" aria-invalid={!!errors.calories} />
                    {#if calories !== null}<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[var(--stor-muted-text)]">kcal</span>{/if}
                </div>
            </label>
        </div>
        {#if errors.name || errors.calories}<p class="-mt-2 text-sm text-[var(--stor-negative)]" role="alert">{errors.name ?? errors.calories}</p>{/if}

        <div class="flex flex-wrap gap-2" role="group" aria-label="Part of day">
            {#each slots as slot (slot.id)}
                <button type="button" class={chip(mealType === slot.id)} aria-pressed={mealType === slot.id} onclick={() => (mealType = slot.id)}>{slot.label}</button>
            {/each}
        </div>

        {#if detailsOpen}
            <div class="grid grid-cols-3 gap-2">
                <label class="block text-xs font-medium text-[var(--stor-muted-text)]">Protein<Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={proteinG} placeholder="g" class="mt-1" /></label>
                <label class="block text-xs font-medium text-[var(--stor-muted-text)]">Carbs<Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={carbsG} placeholder="g" class="mt-1" /></label>
                <label class="block text-xs font-medium text-[var(--stor-muted-text)]">Fat<Input type="number" inputmode="decimal" min="0" step="0.1" bind:value={fatG} placeholder="g" class="mt-1" /></label>
            </div>
            {#if errors.proteinG || errors.carbsG || errors.fatG || errors.quantityG}<p class="text-sm text-[var(--stor-negative)]" role="alert">{errors.proteinG ?? errors.carbsG ?? errors.fatG ?? errors.quantityG}</p>{/if}
            <Textarea bind:value={notes} placeholder="Notes" rows={2} />
            <a href={contextualHref(`/calories?date=${date}&newEntry=1`)} class="text-sm font-semibold text-[var(--stor-accent-text)]">Barcode scan on Nutrition</a>
        {:else}
            <button type="button" class="flex items-center gap-1 self-start text-sm font-semibold text-[var(--stor-accent-text)]" aria-expanded="false" onclick={() => (detailsOpen = true)}>
                {food ? "Notes" : "Macros, notes"}<IconChevronRight class="h-4 w-4" />
            </button>
        {/if}
        {#if errors.form}<p class="text-sm text-[var(--stor-negative)]" role="alert">{errors.form}</p>{/if}
    </form>
    {#snippet footer()}
        <Button type="submit" form="quick-food-form" class="flex-1" disabled={saving}>{saving ? "Saving…" : calories !== null && name.trim() ? `Log ${formatNumber(calories)} kcal` : "Log food"}</Button>
    {/snippet}
</CommandDrawer>
