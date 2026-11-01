<script lang="ts">
    import { Dialog } from "bits-ui";
    import { tick } from "svelte";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import type { AppEvent, CalorieEntry, FoodItem } from "@hearthlog/sdk/data";
    import { appClock, notify } from "@hearthlog/sdk/runtime";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconClose from "~icons/mdi/close";
    import IconSearch from "~icons/mdi/magnify";
    import IconBarcode from "~icons/mdi/barcode-scan";
    import IconCheck from "~icons/mdi/check";
    import IconMinus from "~icons/mdi/minus";
    import IconPlus from "~icons/mdi/plus";
    import IconBack from "~icons/mdi/arrow-left";
    import { searchKalFoods, type KalEanLookupResponse, type KalFood } from "../../api/kal.js";
    import { hasKnownCalories, type ExternalFoodImport } from "../../calories/external-food.js";
    import type { MealSlotView } from "../../calories/logic.js";
    import FoodBarcodeScanner from "../calories/FoodBarcodeScanner.svelte";
    import { prepareCatalogFood } from "../../health/catalog.js";
    import {
        addEntryEvent,
        draftFromEntry,
        draftFromFood,
        entryTime,
        foodPortions,
        importFoodEvent,
        lastPortion,
        logEntries,
        type EntryDraft,
        type PortionChoice,
    } from "../../health/entries.js";
    import { parseQuickEntry, quickCalories, searchStems } from "../../health/quick-entry.js";
    import { weekdayLong } from "../../health/format.js";

    /**
     * Logging a whole meal: the foods usual for this meal come first, each takes
     * a portion the way it was eaten last time, and the meal is added at once.
     * The footer shows what is left after it. Online foods are imported into
     * the library together with the entries.
     */
    let {
        show,
        date,
        today,
        slots,
        meal: initialMeal,
        term: initialTerm = "",
        eaten,
        budget,
        mealCalories,
        onClose,
    }: {
        show: boolean;
        date: string;
        today: string;
        slots: MealSlotView[];
        meal: string;
        term?: string;
        eaten: number;
        budget: number;
        /** Calories already in each meal, for the meal switch. */
        mealCalories: Record<string, number>;
        onClose: () => void;
    } = $props();

    type Tab = "usual" | "recent" | "library" | "online";
    interface Row {
        key: string;
        name: string;
        source: string;
        draft: EntryDraft;
        food: FoodItem | null;
        online: KalFood | null;
        /** How a library food comes in: last time's portion, else its first one. */
        portion?: { amount: number; choice: PortionChoice; fromLast: boolean };
    }
    interface Picked {
        key: string;
        draft: EntryDraft;
        imported: ExternalFoodImport | null;
        portion?: { amount: number; choice: PortionChoice };
    }
    interface Editing {
        key: string;
        food: FoodItem;
        imported: ExternalFoodImport | null;
        amount: number;
        choice: PortionChoice;
        /** Last time's portion, marked among the choices. */
        lastLabel: string;
    }

    let meal = $state("");
    let term = $state("");
    let tab = $state<Tab>("usual");
    let rows = $state<Row[]>([]);
    let loading = $state(false);
    /** The online catalog did not answer; the library still works. */
    let offline = $state(false);
    let earlier = $state<{ date: string; entries: CalorieEntry[] } | null>(null);
    let picked = $state<Picked[]>([]);
    let editing = $state<Editing | null>(null);
    let scanning = $state(false);
    let scanFoods = $state<FoodItem[]>([]);
    let saving = $state(false);
    let preparing = $state<string | null>(null);
    let submissionId = crypto.randomUUID();
    const searchId = $props.id();

    const mealLabel = $derived(slots.find((slot) => slot.id === meal)?.label ?? "Meal");
    const adding = $derived(picked.reduce((total, item) => total + item.draft.calories, 0));
    const after = $derived(budget - eaten - adding);
    const parsed = $derived(parseQuickEntry(term));
    const plain = $derived(quickCalories(parsed));
    const editDraft = $derived(editing ? draftFromFood(editing.food, editing.amount, editing.choice) : null);
    const inMeal = $derived(new Set(picked.map((item) => item.key)));
    const tabs = $derived<{ id: Tab; label: string }[]>([
        { id: "usual", label: `Usual at ${mealLabel.toLowerCase()}` },
        { id: "recent", label: "Recent" },
        { id: "library", label: "Library" },
        { id: "online", label: "Online" },
    ]);

    let opened = false;
    $effect(() => {
        if (show && !opened) {
            opened = true;
            meal = initialMeal;
            term = initialTerm;
            tab = initialTerm ? "library" : "usual";
            picked = [];
            editing = null;
            scanning = false;
            submissionId = crypto.randomUUID();
            void tick().then(() => document.getElementById(searchId)?.focus());
        } else if (!show) {
            opened = false;
        }
    });

    // Typing leaves the usual list for the library; clearing the search goes back.
    let lastTerm = "";
    $effect(() => {
        const value = term.trim();
        if (value && !lastTerm && tab === "usual") tab = "library";
        if (!value && lastTerm && tab !== "usual" && tab !== "recent") tab = "usual";
        lastTerm = value;
    });

    // The meal eaten before, offered as one row on the usual tab.
    $effect(() => {
        const slot = meal;
        if (!show || !slot) return;
        let current = true;
        void queryDatabase((repositories) => repositories.calories.getLastMealLike(date, slot))
            .then((result) => { if (current) earlier = result; })
            .catch(() => { if (current) earlier = null; });
        return () => { current = false; };
    });

    function foodRow(food: FoodItem, last: CalorieEntry | undefined, source: string): Row {
        const portion = lastPortion(food, last);
        return { key: `food:${food.id}`, name: food.name, source, draft: draftFromFood(food, portion.amount, portion.choice), food, online: null, portion: { ...portion, fromLast: Boolean(last) } };
    }

    function sourceOf(food: FoodItem): string {
        if (food.source_provider === "kal-api") return food.brand ? `${food.brand} · Kalorické tabulky` : "Kalorické tabulky";
        return food.brand || "My food";
    }

    $effect(() => {
        const current = { tab, term: parsed.term, meal };
        if (!show) return;
        let live = true;
        const controller = new AbortController();
        loading = true;
        const timer = setTimeout(() => {
            const read = async (): Promise<Row[]> => {
                if (current.tab === "online") {
                    if (current.term.length < 2) return [];
                    const result = await searchKalFoods(current.term, { signal: controller.signal, limit: 20 });
                    return result.items.filter(hasKnownCalories).map((item) => ({
                        key: `kal:${item.guid}`,
                        name: item.name,
                        source: item.brand ? `${item.brand} · Kalorické tabulky` : "Kalorické tabulky",
                        draft: { name: item.name, calories: Math.round(item.energyKcal ?? 0), proteinG: item.proteinG ?? 0, carbsG: item.carbsG ?? 0, fatG: item.fatG ?? 0, foodItemId: "", quantityG: 100, portionLabel: "100 g" },
                        food: null,
                        online: item,
                    }));
                }
                return queryDatabase(async (repositories) => {
                    if (current.tab === "usual") {
                        const usual = await repositories.calories.getUsualFoods(current.meal, date, 12);
                        const foods = await repositories.calories.getFoodItemsByIds(usual.map((entry) => entry.food_item_id).filter(Boolean));
                        return usual.map((entry) => {
                            const food = foods.find((candidate) => candidate.id === entry.food_item_id);
                            const times = `${entry.uses}× in 60 days`;
                            return food ? { ...foodRow(food, entry, times) } : { key: `entry:${entry.id}`, name: entry.name, source: times, draft: draftFromEntry(entry), food: null, online: null };
                        });
                    }
                    if (current.tab === "recent") {
                        const recent = await repositories.calories.getRecentEntries(current.term, 16);
                        const foods = await repositories.calories.getFoodItemsByIds(recent.map((entry) => entry.food_item_id).filter(Boolean));
                        return recent.map((entry) => {
                            const food = foods.find((candidate) => candidate.id === entry.food_item_id);
                            return food ? foodRow(food, entry, sourceOf(food)) : { key: `entry:${entry.id}`, name: entry.name, source: "Logged before", draft: draftFromEntry(entry), food: null, online: null };
                        });
                    }
                    for (const stem of current.term ? searchStems(current.term) : [""]) {
                        const foods = await repositories.calories.searchFoodItems({ search: stem, favoritesOnly: false, sort: { column: null, desc: false }, limit: 20, offset: 0 });
                        if (foods.length === 0) continue;
                        const lasts = await repositories.calories.getLastEntriesForFoods(foods.map((food) => food.id));
                        return foods.map((food) => foodRow(food, lasts.find((entry) => entry.food_item_id === food.id), sourceOf(food)));
                    }
                    return [];
                });
            };
            read()
                .then((result) => {
                    if (!live) return;
                    rows = result;
                    if (current.tab === "online") offline = false;
                })
                .catch((error) => {
                    if (!live || controller.signal.aborted) return;
                    rows = [];
                    if (current.tab === "online") offline = true;
                    else console.error("Food search failed:", error);
                })
                .finally(() => { if (live) loading = false; });
        }, current.term ? 160 : 0);
        return () => { live = false; clearTimeout(timer); controller.abort(); };
    });

    async function choose(row: Row): Promise<void> {
        if (row.food && row.portion) {
            // A food already in the meal opens with the portion it has there.
            const portion = picked.find((item) => item.key === row.key)?.portion ?? row.portion;
            editing = { key: row.key, food: row.food, imported: null, amount: portion.amount, choice: portion.choice, lastLabel: row.portion.fromLast ? row.draft.portionLabel : "" };
            return;
        }
        if (row.online) {
            preparing = row.key;
            try {
                const { food, imported } = await prepareCatalogFood(row.online);
                const portion = lastPortion(food, undefined);
                editing = { key: row.key, food, imported, amount: portion.amount, choice: portion.choice, lastLabel: "" };
            } catch {
                notify.error("The food could not be loaded. Try again.");
            } finally {
                preparing = null;
            }
            return;
        }
        toggle(row.key, row.draft, null);
    }

    function toggle(key: string, draft: EntryDraft, imported: ExternalFoodImport | null): void {
        picked = picked.some((item) => item.key === key) ? picked.filter((item) => item.key !== key) : [...picked, { key, draft, imported }];
    }

    function putEditing(): void {
        if (!editing || !editDraft || !(editing.amount > 0)) return;
        const item = { key: editing.key, draft: editDraft, imported: editing.imported, portion: { amount: editing.amount, choice: editing.choice } };
        picked = picked.some((entry) => entry.key === item.key) ? picked.map((entry) => (entry.key === item.key ? item : entry)) : [...picked, item];
        editing = null;
        void tick().then(() => document.getElementById(searchId)?.focus());
    }

    function step(direction: 1 | -1): void {
        if (!editing) return;
        const size = editing.choice.label === "g" ? 10 : 0.5;
        editing.amount = Math.max(size, Number((editing.amount + direction * size).toFixed(2)));
    }

    function pickChoice(choice: PortionChoice): void {
        if (!editing) return;
        const grams = editing.amount * editing.choice.grams;
        editing.choice = choice;
        editing.amount = choice.label === "g" ? Math.round(grams) : 1;
    }

    function useEarlier(): void {
        if (!earlier) return;
        for (const entry of earlier.entries) {
            const key = `entry:${entry.id}`;
            if (!picked.some((item) => item.key === key)) picked = [...picked, { key, draft: draftFromEntry(entry), imported: null }];
        }
    }

    function usePlain(): void {
        if (!plain) return;
        toggle(`plain:${plain.name}:${plain.calories}`, { name: plain.name, calories: plain.calories, proteinG: 0, carbsG: 0, fatG: 0, foodItemId: "", quantityG: 0, portionLabel: "" }, null);
        term = "";
    }

    async function openScanner(): Promise<void> {
        scanning = true;
        try {
            scanFoods = await queryDatabase((repositories) => repositories.calories.getFoodItems());
        } catch {
            scanFoods = [];
        }
    }

    function scannedLocal(food: FoodItem): void {
        scanning = false;
        const portion = lastPortion(food, undefined);
        editing = { key: `food:${food.id}`, food, imported: null, amount: portion.amount, choice: portion.choice, lastLabel: "" };
    }

    async function scannedExternal(result: KalEanLookupResponse): Promise<void> {
        try {
            const { food, imported } = await prepareCatalogFood(result.food, { ean: result.ean, eanConfidence: result.confidence });
            scanning = false;
            const portion = lastPortion(food, undefined);
            editing = { key: `kal:${result.food.guid}`, food, imported, amount: portion.amount, choice: portion.choice, lastLabel: "" };
        } catch {
            notify.error("The food could not be loaded. Try again.");
        }
    }

    async function save(): Promise<void> {
        if (saving || picked.length === 0) return;
        saving = true;
        const loggedAt = entryTime(date, today, appClock.now());
        const imports = new Map<string, ExternalFoodImport>();
        for (const item of picked) if (item.imported) imports.set(item.imported.id, item.imported);
        const events: AppEvent[] = [
            ...[...imports.values()].map(importFoodEvent),
            ...picked.map((item) => addEntryEvent(item.draft, meal, loggedAt)),
        ];
        try {
            await logEntries(events, submissionId);
            onClose();
        } catch (error) {
            console.error("Failed to log meal:", error);
            notify.error("The meal could not be saved. Your choices are still here.");
        } finally {
            saving = false;
        }
    }

    function keydown(event: KeyboardEvent): void {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
        }
    }

    function searchKey(event: KeyboardEvent): void {
        if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        if (plain && rows.length === 0) usePlain();
        else if (rows[0]) void choose(rows[0]);
    }
</script>

<Dialog.Root open={show} onOpenChange={(open: boolean) => { if (!open && show) onClose(); }}>
    <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-[var(--stor-layer-sheet)] bg-[var(--stor-overlay)]" />
        <Dialog.Content class="stor-sheet stor-health-log" onkeydown={keydown}>
            <header class="top">
                <Dialog.Title level={3} class="stor-title-2 text-[var(--stor-ink)]">Add to</Dialog.Title>
                <div class="seg" role="radiogroup" aria-label="Meal">
                    {#each slots as slot (slot.id)}
                        <button type="button" role="radio" aria-checked={meal === slot.id} class:on={meal === slot.id} onclick={() => (meal = slot.id)}>
                            {slot.label}{#if mealCalories[slot.id]}<small>{formatNumber(mealCalories[slot.id])}</small>{/if}
                        </button>
                    {/each}
                </div>
                <Dialog.Close class="close" aria-label="Close"><IconClose class="h-5 w-5" /></Dialog.Close>
            </header>

            <div class="body" class:editing={editing !== null}>
                <div class="pick">
                    {#if scanning}
                        <FoodBarcodeScanner
                            purpose="log"
                            localFoods={scanFoods}
                            onSelectLocal={scannedLocal}
                            onSelectExternal={scannedExternal}
                            onSearchByName={() => (scanning = false)}
                            onManualFood={() => (scanning = false)}
                            onCancel={() => (scanning = false)}
                        />
                    {:else}
                        <div class="searchrow">
                            <label class="search">
                                <IconSearch class="h-4 w-4 shrink-0" aria-hidden="true" />
                                <input id={searchId} type="search" autocomplete="off" placeholder="Search, or type “150 g kuře” or “650 canteen”" bind:value={term} onkeydown={searchKey} />
                            </label>
                            <button type="button" class="btn" onclick={() => void openScanner()}><IconBarcode class="h-4 w-4" /> Scan</button>
                        </div>
                        <div class="tabs" role="tablist" aria-label="Where to look">
                            {#each tabs as option (option.id)}
                                <button type="button" role="tab" aria-selected={tab === option.id} class:on={tab === option.id} onclick={() => (tab = option.id)}>{option.label}</button>
                            {/each}
                        </div>
                        <div class="list" role="listbox" aria-label="Foods" aria-busy={loading}>
                            {#if plain}
                                <button type="button" class="row plain" onclick={usePlain}>
                                    <span class="nm">Log {formatNumber(plain.calories)} kcal as “{plain.name}”<small>Just the number; macros stay empty</small></span>
                                    <span class="kc">{formatNumber(plain.calories)}</span>
                                    <span class="chk"><IconPlus class="h-4 w-4" /></span>
                                </button>
                            {/if}
                            {#if tab === "usual" && earlier && earlier.entries.length > 1}
                                {@const total = earlier.entries.reduce((sum, entry) => sum + Number(entry.calories), 0)}
                                <div class="row earlier">
                                    <span class="nm">{mealLabel} {weekdayLong(earlier.date, date)}<small>{earlier.entries.map((entry) => entry.name).join(", ")}</small></span>
                                    <span class="kc">{formatNumber(Math.round(total))}</span>
                                    <button type="button" class="btn sm" onclick={useEarlier}>Use all {earlier.entries.length}</button>
                                </div>
                            {/if}
                            {#each rows as row (row.key)}
                                <button type="button" class="row" class:sel={editing?.key === row.key} role="option" aria-selected={inMeal.has(row.key)} onclick={() => void choose(row)} disabled={preparing === row.key}>
                                    <span class="nm">{row.name}<small>{row.source}</small></span>
                                    <span class="por">{row.draft.portionLabel}</span>
                                    <span class="kc">{formatNumber(row.draft.calories)}</span>
                                    <span class="pr">P {formatNumber(Math.round(row.draft.proteinG))}</span>
                                    <span class="chk" class:in={inMeal.has(row.key)}>{#if inMeal.has(row.key)}<IconCheck class="h-4 w-4" />{:else}<IconPlus class="h-4 w-4" />{/if}</span>
                                </button>
                            {:else}
                                {#if !loading && !plain}
                                    <p class="empty">
                                        {#if tab === "online" && offline}Kalorické tabulky is unreachable. Your library still works: try Library, or type a number to log just kcal.
                                        {:else if tab === "online" && parsed.term.length < 2}Type at least two letters to search Kalorické tabulky.
                                        {:else if tab === "usual"}Nothing logged at {mealLabel.toLowerCase()} in the last 60 days yet.
                                        {:else}Nothing matches “{parsed.term}”. Try Online, scan the barcode, or type a number to log just kcal.{/if}
                                    </p>
                                {/if}
                            {/each}
                        </div>
                        <p class="hints" aria-hidden="true"><span class="kbd">↵</span> pick the first <span class="kbd">⌘↵</span> add the meal <span class="kbd">Esc</span> close</p>
                    {/if}
                </div>

                <aside class="side">
                    {#if editing && editDraft}
                        <div class="edit">
                            <button type="button" class="back" onclick={() => (editing = null)}><IconBack class="h-4 w-4" /> Back</button>
                            <p class="fname">{editing.food.name}</p>
                            <p class="fsrc">{sourceOf(editing.food)} · {formatNumber(Math.round(editing.food.calories_per_100g))} kcal / 100 g</p>
                            <div class="chips" role="radiogroup" aria-label="Portion">
                                {#each foodPortions(editing.food) as choice (choice.label)}
                                    <button type="button" role="radio" aria-checked={editing.choice.label === choice.label} class:on={editing.choice.label === choice.label} onclick={() => pickChoice(choice)}>
                                        {choice.label === "g" ? "grams" : `${choice.label} · ${formatNumber(choice.grams)} g`}
                                    </button>
                                {/each}
                            </div>
                            {#if editing.lastLabel}<p class="last">Last time {editing.lastLabel}</p>{/if}
                            <div class="stepper">
                                <button type="button" aria-label="Less" onclick={() => step(-1)}><IconMinus class="h-5 w-5" /></button>
                                <label><span class="sr-only">Amount</span><input type="number" inputmode="decimal" min="0" step={editing.choice.label === "g" ? 10 : 0.5} bind:value={editing.amount} onkeydown={(event) => { if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); putEditing(); } }} /></label>
                                <span class="unit">{editing.choice.label === "g" ? "g" : editing.choice.label}</span>
                                <button type="button" aria-label="More" onclick={() => step(1)}><IconPlus class="h-5 w-5" /></button>
                            </div>
                            <p class="ekc">{formatNumber(editDraft.calories)}<small>kcal</small></p>
                            <p class="emac">P {formatNumber(Math.round(editDraft.proteinG))} g · C {formatNumber(Math.round(editDraft.carbsG))} g · F {formatNumber(Math.round(editDraft.fatG))} g · {formatNumber(Math.round(editDraft.quantityG))} g</p>
                            <button type="button" class="btn pri wide" onclick={putEditing} disabled={!(editing.amount > 0)}>{inMeal.has(editing.key) ? "Update" : `Add to ${mealLabel.toLowerCase()}`} <span class="kbd inv">↵</span></button>
                        </div>
                    {/if}
                    <div class="basket">
                        <p class="bt">This {mealLabel.toLowerCase()}</p>
                        {#each picked as item (item.key)}
                            <div class="bi">
                                <span class="nm">{item.draft.name}<small>{item.draft.portionLabel || "as before"}</small></span>
                                <span class="kc">{formatNumber(item.draft.calories)}</span>
                                <button type="button" class="x" aria-label="Remove {item.draft.name}" onclick={() => (picked = picked.filter((entry) => entry.key !== item.key))}><IconClose class="h-4 w-4" /></button>
                            </div>
                        {:else}
                            <p class="empty">Pick foods on the left; they gather here until you add the whole {mealLabel.toLowerCase()}.</p>
                        {/each}
                        {#if picked.length > 0}<p class="tot"><span>Total</span><b>{formatNumber(adding)} kcal</b></p>{/if}
                    </div>
                </aside>
            </div>

            <footer class="foot">
                {#if budget > 0}
                    <div class="left">
                        <p>After this <b class:neg={after < 0}>{formatNumber(Math.abs(after))} kcal {after < 0 ? "over" : "left"}</b> of {formatNumber(budget)}</p>
                        <div class="fbar" aria-hidden="true">
                            <i class="e" style:flex="{Math.min(eaten, budget)} 0 0"></i>
                            {#if adding > 0}<i class="a" style:flex="{Math.min(adding, Math.max(0, budget - eaten))} 0 0"></i>{/if}
                            {#if after > 0}<i class="r" style:flex="{after} 0 0"></i>{/if}
                        </div>
                    </div>
                {:else}
                    <p class="left">{picked.length > 0 ? `${formatNumber(adding)} kcal in this ${mealLabel.toLowerCase()}` : ""}</p>
                {/if}
                <button type="button" class="btn pri" disabled={picked.length === 0 || saving} onclick={() => void save()}>
                    {saving ? "Adding…" : picked.length === 0 ? `Add to ${mealLabel.toLowerCase()}` : `Add ${picked.length} ${picked.length === 1 ? "food" : "foods"} to ${mealLabel.toLowerCase()} · ${formatNumber(adding)} kcal`}
                    <span class="kbd inv max-sm:hidden">⌘↵</span>
                </button>
            </footer>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>

<style>
    :global(.stor-health-log) {
        position: fixed; inset: auto 0 0 0; z-index: var(--stor-layer-sheet-content); display: flex; max-height: calc(100dvh - env(safe-area-inset-top) - 24px);
        flex-direction: column; overflow: hidden; border-radius: 24px 24px 0 0; outline: none;
    }
    @media (min-width: 768px) {
        :global(.stor-health-log) { inset: 50% auto auto 50%; width: min(1100px, calc(100vw - 48px)); height: min(780px, calc(100vh - 48px)); max-height: none; transform: translate(-50%, -50%); border-radius: var(--stor-panel-radius, 20px); }
    }
    .top { display: flex; align-items: center; gap: 14px; padding: 16px 16px 10px 22px; }
    .top :global(.close) { display: grid; width: 40px; height: 40px; margin-left: auto; place-items: center; border-radius: 10px; color: var(--stor-muted-text); }
    .top :global(.close:hover) { background: var(--stor-surface-hover); color: var(--stor-ink); }
    .seg { display: flex; min-width: 0; gap: 2px; padding: 3px; overflow-x: auto; border-radius: 12px; background: var(--stor-surface-muted); }
    .seg button { display: flex; align-items: baseline; gap: 6px; height: 32px; padding: 0 12px; border-radius: 9px; font-size: 13.5px; font-weight: 600; color: var(--stor-muted-text); white-space: nowrap; }
    .seg button small { font-size: 11.5px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .seg button.on { background: var(--stor-surface); color: var(--stor-ink); box-shadow: var(--stor-elevation-1); }
    .body { display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); border-top: 1px solid color-mix(in srgb, var(--stor-border) 60%, transparent); }
    .pick { display: flex; min-height: 0; flex-direction: column; gap: 10px; padding: 14px 18px 10px 22px; overflow: hidden; }
    .side { display: flex; min-height: 0; flex-direction: column; gap: 16px; padding: 14px 22px; overflow-y: auto; background: color-mix(in srgb, var(--stor-surface-muted) 55%, transparent); border-left: 1px solid color-mix(in srgb, var(--stor-border) 60%, transparent); }
    .searchrow { display: flex; gap: 8px; }
    .search { display: flex; min-width: 0; flex: 1; height: 42px; align-items: center; gap: 8px; padding: 0 12px; border-radius: 12px; background: var(--stor-surface); color: var(--stor-muted-text); box-shadow: inset 0 0 0 1px var(--stor-field-border, var(--stor-border)); }
    .search:focus-within { box-shadow: inset 0 0 0 1px var(--stor-action), 0 0 0 3px var(--stor-selected); }
    .search input { min-width: 0; flex: 1; border: 0; background: transparent; font-size: 14.5px; color: var(--stor-ink); outline: none; }
    .btn { display: inline-flex; height: 42px; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 12px; font-size: 14px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface); box-shadow: inset 0 0 0 1px var(--stor-border); white-space: nowrap; }
    .btn:hover { background: var(--stor-surface-hover); }
    .btn.sm { height: 32px; padding: 0 10px; font-size: 13px; border-radius: 9px; }
    .btn.pri { color: var(--stor-action-text, #fff); background: var(--stor-action); box-shadow: none; }
    .btn.pri:hover { background: var(--stor-action-hover); }
    .btn:disabled { opacity: .5; }
    .btn.wide { width: 100%; }
    .tabs { display: flex; gap: 4px; overflow-x: auto; }
    .tabs button { height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--stor-muted-text); white-space: nowrap; }
    .tabs button.on { background: var(--stor-accent-soft); color: var(--stor-accent-strong); }
    .list { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow-y: auto; margin: 0 -8px; padding: 0 8px; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto 52px 52px 32px; align-items: center; gap: 10px; min-height: 52px; padding: 6px 10px; border-radius: 10px; text-align: left; font-size: 13.5px; color: var(--stor-ink); }
    .row:hover { background: var(--stor-surface-hover); }
    .row.sel { background: var(--stor-surface-muted); }
    .row.plain, .row.earlier { grid-template-columns: minmax(0, 1fr) 52px auto; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stor-border) 70%, transparent); margin-bottom: 6px; }
    .nm { display: flex; min-width: 0; flex-direction: column; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .nm small { overflow: hidden; text-overflow: ellipsis; font-size: 12px; font-weight: 500; color: var(--stor-muted-text); }
    .por { font-size: 12.5px; color: var(--stor-muted-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .kc { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
    .pr { text-align: right; font-size: 12.5px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .chk { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 8px; color: var(--stor-muted-text); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .chk.in { color: var(--stor-action-text, #fff); background: var(--stor-action); box-shadow: none; }
    .empty { padding: 14px 4px; font-size: 13px; line-height: 1.5; color: var(--stor-muted-text); }
    .hints { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--stor-muted-text); }
    .kbd { display: inline-grid; min-width: 20px; height: 20px; padding: 0 4px; place-items: center; border-radius: 5px; font-size: 11px; font-weight: 500; color: var(--stor-muted-text); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .kbd.inv { color: inherit; opacity: .75; box-shadow: inset 0 0 0 1px currentColor; }
    .edit { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 16px; background: var(--stor-surface); box-shadow: var(--stor-elevation-1); }
    .back { display: none; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--stor-muted-text); }
    .fname { font-size: 17px; font-weight: 650; color: var(--stor-ink); }
    .fsrc { margin-top: -6px; font-size: 12.5px; color: var(--stor-muted-text); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chips button { height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface-muted); }
    .chips button.on { background: var(--stor-accent-soft); color: var(--stor-accent-strong); box-shadow: inset 0 0 0 1px currentColor; }
    .last { font-size: 12.5px; color: var(--stor-muted-text); }
    .stepper { display: flex; align-items: center; gap: 8px; }
    .stepper button { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 12px; color: var(--stor-ink); background: var(--stor-surface-muted); }
    .stepper label { min-width: 0; flex: 1; }
    .stepper input { width: 100%; height: 44px; border: 0; border-bottom: 2px solid var(--stor-action); background: transparent; text-align: center; font-size: 22px; font-weight: 650; color: var(--stor-ink); font-variant-numeric: tabular-nums; outline: none; }
    .unit { font-size: 13px; color: var(--stor-muted-text); }
    .ekc { font-size: 30px; font-weight: 650; line-height: 1; letter-spacing: -.02em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .ekc small { margin-left: 6px; font-size: 13px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .emac { font-size: 12.5px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .basket { display: flex; flex-direction: column; gap: 2px; }
    .bt { margin-bottom: 4px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .bi { display: grid; grid-template-columns: minmax(0, 1fr) auto 32px; align-items: center; gap: 8px; min-height: 44px; font-size: 13.5px; color: var(--stor-ink); }
    .bi + .bi { border-top: 1px solid color-mix(in srgb, var(--stor-border) 50%, transparent); }
    .x { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 8px; color: var(--stor-muted-text); }
    .x:hover { background: var(--stor-surface-hover); color: var(--stor-ink); }
    .tot { display: flex; justify-content: space-between; padding-top: 8px; margin-top: 4px; border-top: 1px solid var(--stor-border); font-size: 13.5px; color: var(--stor-muted-text); }
    .tot b { color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .foot { display: flex; align-items: center; gap: 16px; padding: 12px 22px max(12px, env(safe-area-inset-bottom)); border-top: 1px solid var(--stor-border); }
    .left { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 6px; font-size: 13.5px; color: var(--stor-muted-text); }
    .left b { color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .left b.neg { color: var(--stor-negative); }
    .fbar { display: flex; height: 8px; max-width: 360px; gap: 2px; }
    .fbar i { display: block; min-width: 2px; border-radius: 3px; }
    .fbar .e { background: var(--stor-health-eat); }
    .fbar .a { background: color-mix(in srgb, var(--stor-health-eat) 40%, transparent); box-shadow: inset 0 0 0 1.5px var(--stor-health-eat); }
    .fbar .r { background: var(--stor-surface-muted); }
    @media (max-width: 767px) {
        .top { flex-wrap: wrap; padding: 14px 12px 8px 16px; }
        .seg { order: 3; flex-basis: 100%; }
        .body { grid-template-columns: minmax(0, 1fr); }
        .pick { padding: 12px 14px 6px; }
        .side { display: none; padding: 12px 14px; border-left: 0; }
        .body.editing .pick { display: none; }
        .body.editing .side { display: flex; }
        .body.editing .basket { display: none; }
        .back { display: inline-flex; }
        .hints { display: none; }
        .row { grid-template-columns: minmax(0, 1fr) 52px 32px; }
        .row .por, .row .pr { display: none; }
        .foot { flex-direction: column; align-items: stretch; gap: 10px; padding: 10px 14px max(12px, env(safe-area-inset-bottom)); }
        .foot .btn { height: 48px; }
    }
</style>
