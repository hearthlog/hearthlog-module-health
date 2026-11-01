<script lang="ts">
    import type { CalorieEntry } from "@hearthlog/sdk/data";
    import { appClock, notify } from "@hearthlog/sdk/runtime";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconTrash from "~icons/mdi/trash-can-outline";
    import MealEntryActionsMenu from "../calories/MealEntryActionsMenu.svelte";
    import MealAddRow from "./MealAddRow.svelte";
    import type { DiaryMeal, MealSuggestion } from "../../health/day-page.js";
    import { addEntryEvent, draftFromEntry, entryTime, logEntries, removeEntry, scaledEntry, updateEntry } from "../../health/entries.js";
    import { clockTime, weekdayLong } from "../../health/format.js";
    import { loggedAtOnDate, shiftLoggedAt } from "../../calories/logic.js";

    /**
     * The day's food as a table: a header row per meal with its sums, a row per
     * entry, and an add row that understands typing. The usual next meal waits
     * as one row with Add all. Grams edit in place; changes save at once and the
     * toast keeps Undo.
     */
    let {
        date,
        today,
        meals,
        next,
        onLog,
    }: {
        date: string;
        today: string;
        meals: DiaryMeal[];
        next: MealSuggestion | null;
        /** Opens the log sheet on a meal, with a search term. */
        onLog: (slotId: string, term?: string) => void;
    } = $props();

    let editing = $state<string | null>(null);
    let grams = $state<number | null>(null);
    let busy = $state(false);

    const slots = $derived(meals.filter((meal) => meal.slot.id !== "__other__").map((meal) => meal.slot));
    const g = (value: number) => formatNumber(Math.round(value));

    function startEdit(entry: CalorieEntry): void {
        if (!(Number(entry.quantity_g) > 0)) return;
        editing = entry.id;
        grams = Math.round(Number(entry.quantity_g));
    }

    async function saveGrams(entry: CalorieEntry): Promise<void> {
        const value = grams;
        editing = null;
        if (value === null || !(value > 0) || value === Math.round(Number(entry.quantity_g))) return;
        await run(() => updateEntry(entry, scaledEntry(entry, value), `${entry.name} now ${formatNumber(value)} g`));
    }

    async function run(action: () => Promise<void>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await action();
        } catch (error) {
            console.error("Diary change failed:", error);
            notify.error("The change could not be saved");
        } finally {
            busy = false;
        }
    }

    function addAll(suggestion: MealSuggestion): Promise<void> {
        const loggedAt = entryTime(date, today, appClock.now());
        const events = suggestion.entries.map((entry) => addEntryEvent(draftFromEntry(entry), suggestion.slotId, loggedAt));
        return run(() => logEntries(events));
    }
</script>

<div class="diary" role="table" aria-label="Food diary">
    <div class="row head" role="row">
        <span role="columnheader">Food</span>
        <span role="columnheader" class="portion">Portion</span>
        <span role="columnheader" class="n">kcal</span>
        <span role="columnheader" class="n m">Protein</span>
        <span role="columnheader" class="n m">Carbs</span>
        <span role="columnheader" class="n m">Fat</span>
        <span role="columnheader"><span class="sr-only">Actions</span></span>
    </div>
    {#each meals as meal (meal.slot.id)}
        {@const firstAt = meal.entries[0] ? clockTime(String(meal.entries[0].logged_at)) : ""}
        <div class="row meal" role="row">
            <span role="rowheader" class="mn">{meal.slot.label}{#if firstAt}<small>{firstAt}</small>{/if}</span>
            <span class="portion"></span>
            <span class="n">{meal.entries.length > 0 ? g(meal.calories) : ""}</span>
            <span class="n m">{meal.entries.length > 0 ? g(meal.proteinG) : ""}</span>
            <span class="n m">{meal.entries.length > 0 ? g(meal.carbsG) : ""}</span>
            <span class="n m">{meal.entries.length > 0 ? g(meal.fatG) : ""}</span>
            <span></span>
        </div>
        {#each meal.entries as entry (entry.id)}
            <div class="row entry" role="row">
                <span class="nm" role="cell">{entry.name}</span>
                <span class="portion" role="cell">
                    {#if editing === entry.id}
                        <!-- svelte-ignore a11y_autofocus -->
                        <input
                            class="grams"
                            type="number"
                            inputmode="numeric"
                            min="1"
                            step="10"
                            aria-label="Grams of {entry.name}"
                            bind:value={grams}
                            autofocus
                            onblur={() => void saveGrams(entry)}
                            onkeydown={(event) => {
                                if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
                                if (event.key === "Escape") editing = null;
                            }}
                        /><span class="u">g</span>
                    {:else if Number(entry.quantity_g) > 0}
                        <button type="button" class="pbtn" title="Change grams" onclick={() => startEdit(entry)}>{entry.portion_label || `${g(Number(entry.quantity_g))} g`}</button>
                    {:else}
                        <span class="mt">{entry.portion_label || "—"}</span>
                    {/if}
                </span>
                <span class="n b" role="cell">{g(Number(entry.calories))}</span>
                <span class="n m" role="cell">{g(Number(entry.protein_g))}</span>
                <span class="n m" role="cell">{g(Number(entry.carbs_g))}</span>
                <span class="n m" role="cell">{g(Number(entry.fat_g))}</span>
                <span class="acts" role="cell">
                    <MealEntryActionsMenu
                        entryName={entry.name}
                        movableSlots={slots.filter((slot) => slot.id !== entry.meal_type)}
                        onMove={(slotId) => void run(() => updateEntry(entry, { mealType: slotId }, `Moved ${entry.name} to ${slots.find((slot) => slot.id === slotId)?.label.toLowerCase() ?? "another meal"}`))}
                        onMoveDay={(days) => void run(() => updateEntry(entry, { loggedAt: shiftLoggedAt(String(entry.logged_at), days) }, `Moved ${entry.name} to the ${days < 0 ? "day before" : "next day"}`))}
                        onDuplicate={() => void run(() => logEntries([addEntryEvent(draftFromEntry(entry), entry.meal_type, loggedAtOnDate(String(entry.logged_at), date))]))}
                    />
                    <button type="button" class="ic" aria-label="Remove {entry.name}" onclick={() => void run(() => removeEntry(entry))}><IconTrash class="h-4 w-4" /></button>
                </span>
            </div>
        {/each}
        {#if next && next.slotId === meal.slot.id && meal.entries.length === 0}
            <div class="row usual" role="row">
                <span class="nm" role="cell">
                    <span>Like {weekdayLong(next.from, date)}</span>
                    <small>{next.entries.map((entry) => entry.name).join(", ")}</small>
                </span>
                <span class="portion"></span>
                <span class="n" role="cell">{g(next.calories)}</span>
                <span class="n m" role="cell">{g(next.proteinG)}</span>
                <span class="n m"></span>
                <span class="n m"></span>
                <span class="acts" role="cell"><button type="button" class="addall" disabled={busy} onclick={() => void addAll(next)}>Add all</button></span>
            </div>
        {/if}
        {#if meal.slot.id !== "__other__"}
            <div class="row addrow" role="row">
                <span class="wide" role="cell"><MealAddRow {date} {today} slotId={meal.slot.id} slotLabel={meal.slot.label} onMore={(term) => onLog(meal.slot.id, term)} /></span>
            </div>
        {/if}
    {/each}
</div>

<style>
    .diary { display: flex; flex-direction: column; font-size: 13.5px; }
    .row {
        display: grid; grid-template-columns: minmax(0, 1fr) 132px 64px 64px 64px 56px 76px; align-items: center; gap: 8px;
        min-height: 40px; padding: 0 10px;
    }
    .head { min-height: 32px; font-size: 12px; font-weight: 600; color: var(--stor-muted-text); border-bottom: 1px solid color-mix(in srgb, var(--stor-border) 60%, transparent); }
    .meal { min-height: 44px; margin-top: 6px; font-weight: 650; color: var(--stor-ink); }
    .meal .n { font-weight: 650; }
    .mn { display: flex; align-items: baseline; gap: 8px; font-family: var(--stor-font-serif); font-size: 17px; font-weight: 500; }
    .mn small { font-family: var(--stor-font-sans); font-size: 12px; font-weight: 500; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .entry { border-radius: 10px; color: var(--stor-ink); }
    .entry:hover { background: var(--stor-surface-hover); }
    .entry + .entry { box-shadow: inset 0 1px 0 color-mix(in srgb, var(--stor-border) 45%, transparent); }
    .entry:hover + .entry, .entry:hover { box-shadow: none; }
    .nm { display: flex; min-width: 0; flex-direction: column; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .nm small { overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--stor-muted-text); }
    .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--stor-muted-text); }
    .n.b, .meal .n { color: var(--stor-ink); }
    .entry .n.b { font-weight: 600; }
    .portion { display: flex; min-width: 0; align-items: center; gap: 4px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .pbtn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 6px; padding: 2px 6px; margin-left: -6px; color: var(--stor-muted-text); }
    .pbtn:hover { background: var(--stor-surface-muted); color: var(--stor-ink); text-decoration: underline dotted; }
    .grams { width: 72px; height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--stor-action); background: var(--stor-surface); font-size: 13.5px; color: var(--stor-ink); text-align: right; box-shadow: 0 0 0 3px var(--stor-selected); outline: none; }
    .u { font-size: 12px; }
    .acts { display: flex; justify-content: flex-end; gap: 2px; opacity: 0; transition: opacity .12s; }
    .entry:hover .acts, .entry:focus-within .acts, .usual .acts { opacity: 1; }
    .ic { display: inline-grid; width: 36px; height: 36px; place-items: center; border-radius: 8px; color: var(--stor-muted-text); }
    .ic:hover { background: var(--stor-surface-muted); color: var(--stor-ink); }
    .usual { margin: 2px 0; border-radius: 10px; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--stor-health-eat) 35%, transparent); background: color-mix(in srgb, var(--stor-health-eat) 4%, transparent); }
    .usual .nm { font-weight: 600; }
    .addall { height: 30px; padding: 0 12px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--stor-action-text, #fff); background: var(--stor-action); white-space: nowrap; }
    .addall:hover { background: var(--stor-action-hover); }
    .addrow { padding: 0; }
    .wide { grid-column: 1 / -1; }
    .mt { color: var(--stor-muted-text); }
    @media (hover: none) { .acts { opacity: 1; } }
    @media (max-width: 767px) {
        .row { grid-template-columns: minmax(0, 1fr) auto 56px 76px; gap: 6px; padding: 0 6px; }
        .m, .head .m { display: none; }
        .portion { font-size: 12.5px; }
    }
</style>
