<script lang="ts">
    import HealthGlance from "../health/HealthGlance.svelte";
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { DataValue } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import HealthDayTitle from "../health/HealthDayTitle.svelte";
    import MealEntryActionsMenu from "./MealEntryActionsMenu.svelte";
    import NutritionSummary from "./NutritionSummary.svelte";
    import { OTHER_MEAL_SLOT, groupEntriesByMeal, type MealSlotView } from "../../calories/logic.js";
    import { EMPTY_CALORIE_TOTALS, type MealDrag, type NutritionDayBlock as NutritionDay } from "../../calories/page-data.js";
    import type { CalorieEntry } from "../../data/calories.js";
    import { dateTitleParts } from "../../health/day.js";
    import { formatNumber as formatCount } from "@hearthlog/sdk/format";
    import IconDragVertical from "~icons/mdi/drag-vertical";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconPlus from "~icons/mdi/plus";
    import IconTrash from "~icons/mdi/trash-can-outline";

    /**
     * One day of the Nutrition list: its date, the day's calories against the
     * budget with the macros, and its meals. A day still loading draws the same
     * frame with placeholders, so the list keeps its shape as days arrive.
     */
    let {
        date,
        today,
        day,
        mealSlots,
        drag,
        onLog,
        onEdit,
        onDelete,
        onMove,
        onMoveDay,
        onDuplicate,
        onCopyYesterday,
        onDragStart,
        onEditGoals,
        onEditMeals,
        inView = false,
        onWeek,
    }: {
        date: string;
        today: string;
        /** Missing while the day loads. */
        day?: NutritionDay;
        mealSlots: MealSlotView[];
        drag: MealDrag;
        onLog: (date: string, mealSlotId?: string) => void;
        onEdit: (entry: CalorieEntry) => void;
        onDelete: (entry: CalorieEntry) => void;
        onMove: (entry: CalorieEntry, slotId: string) => void;
        onMoveDay: (entry: CalorieEntry, days: number) => void;
        onDuplicate: (entry: CalorieEntry) => void;
        onCopyYesterday: (slot: MealSlotView, date: string) => void;
        onDragStart: (event: PointerEvent, entry: CalorieEntry) => void;
        onEditGoals: (date: string) => void;
        onEditMeals: () => void;
        /** The day the strip names; on phones its figures sit in the top bar. */
        inView?: boolean;
        onWeek: () => void;
    } = $props();

    // Values and controls inside this day wait for this day, not for the page.
    providePageResource(() => ({ loading: day === undefined }));

    const titleId = $props.id();
    const loading = $derived(day === undefined);
    const entries = $derived(day?.entries ?? []);
    const goal = $derived(day?.goal ?? null);
    const totals = $derived(day?.totals ?? EMPTY_CALORIE_TOTALS);
    const label = $derived(`${dateTitleParts(date).weekday}, ${dateTitleParts(date).rest}`);
    const mealGroups = $derived(groupEntriesByMeal(entries, mealSlots));
    const mealTotalsBySlot = $derived(new Map((day?.mealTotals ?? []).map((mealTotals) => [mealTotals.mealType, mealTotals])));
    const visibleMealGroups = $derived(mealGroups.filter(
        (group) => group.slot.id === OTHER_MEAL_SLOT.id || !group.slot.archived || group.entries.length > 0,
    ));
    const yesterdayCounts = $derived(new Map((day?.yesterdayMealCounts ?? []).map((count) => [count.mealType, count.count])));
    /** Meals as the parts of the day's budget; entries in a removed slot read as Other. */
    const mealParts = $derived.by(() => {
        const parts = visibleMealGroups
            .filter((group) => group.slot.id !== OTHER_MEAL_SLOT.id)
            .map((group) => ({ key: group.slot.id, label: group.slot.label, value: mealTotalsBySlot.get(group.slot.id)?.calories ?? 0 }));
        const unassigned = totals.calories - parts.reduce((sum, part) => sum + part.value, 0);
        return unassigned > 0.5 ? [...parts, { key: OTHER_MEAL_SLOT.id, label: OTHER_MEAL_SLOT.label, value: unassigned }] : parts;
    });
    const macros = $derived([
        { label: "Protein", value: totals.proteinG, target: goal?.protein_target_g ?? 0 },
        { label: "Carbs", value: totals.carbsG, target: goal?.carbs_target_g ?? 0 },
        { label: "Fat", value: totals.fatG, target: goal?.fat_target_g ?? 0 },
    ]);

    const movableSlotsFor = (entry: CalorieEntry): MealSlotView[] =>
        mealSlots.filter((slot) => !slot.archived && slot.id !== entry.meal_type);
    const formatNumber = (value: number): string => formatCount(value, 1);
    const formatTime = (value: string): string => value.slice(11, 16) || "—";
</script>

<section class="day @container" aria-label={label} data-day={date}>
    <HealthDayTitle {date} {today} {onWeek} />
    <div class="body">
        {#snippet summary()}
            <NutritionSummary
                calories={totals.calories}
                target={goal?.calories_target ?? 0}
                parts={mealParts}
                {macros}
                onEditGoals={() => onEditGoals(date)}
            />
        {/snippet}
        <!-- Phones keep the day's budget and macros in the sheet behind the top bar's figure. -->
        <div class="max-md:hidden">{@render summary()}</div>
        {#if inView}
            <HealthGlance {date} {today} sources={{ meals: true, activity: false, body: false }} eat={loading ? null : totals.calories} {onWeek} actions={[{ label: "Edit meals", run: onEditMeals }]}>
                {@render summary()}
            </HealthGlance>
        {/if}

        <section class="stor-panel" aria-labelledby="{titleId}-title">
            <!-- Phones: Edit meals sits in the sheet behind the top bar's figure. -->
            <header class="stor-panel-header max-md:sr-only">
                <h2 id="{titleId}-title" class="font-semibold text-[var(--stor-ink)]">Meals</h2>
                <CommandOnly>
                    <Button variant="ghost" size="sm" class="-mr-2" onclick={onEditMeals}>Edit meals</Button>
                </CommandOnly>
            </header>

            {#if entries.length === 0 && !loading}
                <div class="mx-[var(--stor-panel-padding)] mb-2 flex flex-col items-start justify-between gap-3 rounded-xl bg-[var(--stor-surface-muted)] px-4 py-3 @lg:flex-row @lg:items-center">
                    <div>
                        <h3 class="text-sm font-semibold text-[var(--stor-ink)]">Nothing logged yet</h3>
                        <p class="mt-0.5 text-sm text-[var(--stor-muted-text)]">Add a saved food or use a rough calorie estimate.</p>
                    </div>
                    <CommandOnly>
                        <Button size="sm" onclick={() => onLog(date)}>Log first food</Button>
                    </CommandOnly>
                </div>
            {/if}

            <div class="stor-meal-groups pb-2">
                {#each visibleMealGroups as group (group.slot.id)}
                    {@const mealEntries = group.entries}
                    {@const mealTotals = mealTotalsBySlot.get(group.slot.id) ?? EMPTY_CALORIE_TOTALS}
                    {@const isRealSlot = group.slot.id !== OTHER_MEAL_SLOT.id}
                    {@const yesterdayCount = isRealSlot ? yesterdayCounts.get(group.slot.id) ?? 0 : 0}
                    <article
                        data-meal-drop={isRealSlot ? group.slot.id : undefined}
                        data-meal-day={date}
                        aria-label={group.slot.label}
                        class="stor-meal-group rounded-lg transition {drag.dropDate === date && drag.dropSlotId === group.slot.id
                            ? 'ring-2 ring-[var(--stor-accent)] ring-offset-1'
                            : ''}"
                    >
                        <header class="stor-meal-head">
                            <h3 class="truncate text-sm font-semibold {loading || mealEntries.length > 0 ? 'text-[var(--stor-ink)]' : 'text-[var(--stor-muted-text)]'}">{group.slot.label}</h3>
                            {#if group.slot.archived}
                                <span class="rounded-full bg-[var(--stor-surface-muted)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Hidden</span>
                            {/if}
                            <!-- One entry already says its own calories; a slot total earns its place from two. -->
                            {#if !loading && mealEntries.length >= 2}
                                <span class="whitespace-nowrap text-xs tabular-nums text-[var(--stor-muted-text)]">{formatNumber(mealTotals.calories)} kcal</span>
                            {/if}
                            {#if isRealSlot && yesterdayCount > 0 && mealEntries.length === 0 && !loading}
                                <CommandOnly>
                                    <button
                                        type="button"
                                        class="shrink-0 rounded-md px-1.5 py-1 text-xs font-semibold text-[var(--stor-muted-text)] hover:text-[var(--stor-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]"
                                        onclick={() => onCopyYesterday(group.slot, date)}
                                    >
                                        Copy yesterday ({yesterdayCount})
                                    </button>
                                </CommandOnly>
                            {/if}
                            {#if isRealSlot}
                                <div class="ml-auto -mr-2">
                                    <CommandOnly>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Add ${group.slot.label} entry`}
                                            onclick={() => onLog(date, group.slot.id)}
                                        >
                                            <IconPlus class="h-4 w-4" />
                                        </Button>
                                    </CommandOnly>
                                </div>
                            {/if}
                        </header>

                        {#if loading}<div class="px-[var(--stor-panel-padding)] pb-2"><DataPlaceholder rows={1} compact /></div>{:else if mealEntries.length > 0}
                            <div class="stor-inset-rows [--stor-row-inset:var(--stor-panel-padding)]">
                                {#each mealEntries as entry (entry.id)}
                                    <div class="group stor-meal-row py-2 transition-colors hover:bg-[var(--stor-surface-muted)] {drag.entryId === entry.id && drag.active ? 'opacity-40' : ''}">
                                        <time class="text-right text-xs tabular-nums text-[var(--stor-muted-text)]" datetime={entry.logged_at}>{formatTime(entry.logged_at)}</time>
                                        <div class="min-w-0">
                                            <p class="truncate text-sm font-medium text-[var(--stor-ink)]">{entry.name}</p>
                                            {#if entry.portion_label || entry.notes}
                                                <p class="mt-0.5 truncate text-xs text-[var(--stor-muted-text)]">{entry.portion_label}{#if entry.portion_label && entry.notes}{" · "}{/if}{entry.notes}</p>
                                            {/if}
                                        </div>

                                        <div class="whitespace-nowrap text-right">
                                            <span class="font-semibold tabular-nums text-[var(--stor-ink)]"><DataValue>{formatNumber(entry.calories)}</DataValue></span>{' '}<span class="text-xs font-medium text-[var(--stor-muted-text)]">kcal</span>
                                        </div>

                                        <CommandOnly>
                                            <div class="flex justify-end @lg:hidden">
                                                <MealEntryActionsMenu
                                                    entryName={entry.name}
                                                    movableSlots={movableSlotsFor(entry)}
                                                    onMove={(slotId) => onMove(entry, slotId)}
                                                    onMoveDay={(days) => onMoveDay(entry, days)}
                                                    onDuplicate={() => onDuplicate(entry)}
                                                    onEdit={() => onEdit(entry)}
                                                    onDelete={() => onDelete(entry)}
                                                    triggerClass="h-11 w-11"
                                                />
                                            </div>
                                            <div class="hidden shrink-0 items-center justify-end gap-0.5 transition @lg:flex @lg:opacity-0 @lg:group-hover:opacity-100 @lg:group-focus-within:opacity-100">
                                                <button
                                                    type="button"
                                                    class="cursor-grab touch-none select-none rounded-md p-1 text-[var(--stor-muted-text)] opacity-60 transition hover:opacity-100 active:cursor-grabbing"
                                                    aria-label={`Drag ${entry.name} to another meal`}
                                                    onpointerdown={(event) => onDragStart(event, entry)}
                                                >
                                                    <IconDragVertical class="h-4 w-4" />
                                                </button>
                                                <MealEntryActionsMenu
                                                    entryName={entry.name}
                                                    movableSlots={movableSlotsFor(entry)}
                                                    onMove={(slotId) => onMove(entry, slotId)}
                                                    onMoveDay={(days) => onMoveDay(entry, days)}
                                                    onDuplicate={() => onDuplicate(entry)}
                                                />
                                                <Button variant="ghost" size="icon" aria-label={`Edit ${entry.name}`} onclick={() => onEdit(entry)}>
                                                    <IconPencil class="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" aria-label={`Delete ${entry.name}`} onclick={() => onDelete(entry)}>
                                                    <IconTrash class="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </CommandOnly>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </article>
                {/each}
            </div>
        </section>
    </div>
</section>

<style>
    .day { padding-bottom: var(--stor-section-gap); }
    .body { display: flex; flex-direction: column; gap: var(--stor-section-gap); }
    /* Time, name, calories, and the row actions each keep a column, so every meal lines up. A wide
       day (from 32rem) lays its row actions out inline; a narrow one keeps them in a menu. */
    .stor-meal-head { display: flex; min-height: 48px; align-items: center; gap: 10px; padding-inline: var(--stor-panel-padding); }
    .stor-meal-row {
        display: grid; grid-template-columns: 2.5rem minmax(0, 1fr) auto 2.75rem; align-items: center;
        column-gap: 12px; padding-inline: var(--stor-panel-padding);
    }
    .stor-meal-group { position: relative; }
    .stor-meal-group + .stor-meal-group { margin-top: 4px; padding-top: 4px; }
    .stor-meal-group + .stor-meal-group::before {
        content: ""; position: absolute; top: 0; left: var(--stor-panel-padding); right: var(--stor-panel-padding); height: 1px;
        background: color-mix(in srgb, var(--stor-border) 70%, transparent);
    }
    @container (min-width: 32rem) {
        .stor-meal-row { grid-template-columns: 2.5rem minmax(0, 1fr) auto 8.75rem; }
    }
</style>
