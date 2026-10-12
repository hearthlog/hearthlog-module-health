<script lang="ts">
    import HealthGlance from "./HealthGlance.svelte";
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { EmptyState } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import HealthDayTitle from "./HealthDayTitle.svelte";
    import HealthRow from "./HealthRow.svelte";
    import HealthRowMenu from "./HealthRowMenu.svelte";
    import ActivitySummary from "./ActivitySummary.svelte";
    import { activityIcon } from "./health-icons.js";
    import { activityEntryRow, dateTitleParts, timelineActivityKind, timelineDetail, timelineMeasure } from "../../health/day.js";
    import type { ActivityDayBlock as ActivityDay } from "../../activities/page-data.js";
    import type { ActivityKind } from "../../activities/logic.js";
    import type { ActivityEntry } from "../../data/activities.js";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconPencil from "~icons/mdi/pencil-outline";
    import IconPlus from "~icons/mdi/plus";
    import IconTrash from "~icons/mdi/trash-can-outline";

    /**
     * One day of the Activity list: its date, the steps ring and active energy,
     * and the diary. A day still loading draws the same frame with placeholders.
     */
    let {
        date,
        today,
        day,
        onLog,
        onEdit,
        onDelete,
        onSetGoals,
        onWeek,
        inView = false,
    }: {
        date: string;
        today: string;
        /** Missing while the day loads. */
        day?: ActivityDay;
        onLog: (kind: ActivityKind, date: string) => void;
        onEdit: (entry: ActivityEntry) => void;
        onDelete: (entry: ActivityEntry) => void;
        onSetGoals: (date: string) => void;
        onWeek: () => void;
        /** The day the strip names; on phones its figures sit in the top bar. */
        inView?: boolean;
    } = $props();

    // Values and controls inside this day wait for this day, not for the page.
    providePageResource(() => ({ loading: day === undefined }));

    const titleId = $props.id();
    const loading = $derived(day === undefined);
    const entries = $derived(day?.entries ?? []);
    const label = $derived(`${dateTitleParts(date).weekday}, ${dateTitleParts(date).rest}`);
    const formatTime = (value: string): string => value.slice(11, 16) || "—";
</script>

<section class="day @container" aria-label={label} data-day={date}>
    <HealthDayTitle {date} {today} {onWeek} />
    <div class="body">
        {#snippet summary()}
            <ActivitySummary
                steps={day?.totals.steps ?? 0}
                stepsTarget={day?.goal?.steps_target ?? 0}
                activeCalories={day?.totals.activeCalories ?? 0}
                isToday={date === today}
                {loading}
                onSetGoals={() => onSetGoals(date)}
            />
        {/snippet}
        <!-- Phones keep the steps ring and active energy in the sheet behind the top bar's figure. -->
        <div class="max-md:hidden">{@render summary()}</div>
        {#if inView}
            <HealthGlance {date} {today} sources={{ meals: false, activity: true, body: false }} steps={loading ? null : (day?.totals.steps ?? 0)} {onWeek}>
                {@render summary()}
            </HealthGlance>
        {/if}

        <section class="stor-panel" aria-labelledby="{titleId}-title">
            <header class="stor-panel-header max-md:sr-only">
                <h2 id="{titleId}-title" class="font-semibold text-[var(--stor-ink)]">Diary</h2>
                <CommandOnly>
                    <div class="-mr-2 flex gap-2 max-md:hidden">
                        <Button variant="secondary" size="sm" aria-label="Log steps" onclick={() => onLog("steps", date)}><IconPlus class="h-4 w-4" />Steps</Button>
                        <Button variant="secondary" size="sm" aria-label="Log workout" onclick={() => onLog("workout", date)}><IconPlus class="h-4 w-4" />Workout</Button>
                    </div>
                </CommandOnly>
            </header>

            {#if loading}
                <div class="px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]"><DataPlaceholder rows={3} compact /></div>
            {:else if entries.length === 0}
                <EmptyState surface={false} title="No activity logged" description="Start with the day’s steps or a workout.">
                    <CommandOnly>
                        <Button size="sm" onclick={() => onLog("steps", date)}>Log steps</Button>
                    </CommandOnly>
                </EmptyState>
            {:else}
                <ol class="diary px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]">
                    {#each entries as entry, index (entry.id)}
                        {@const row = activityEntryRow(entry)}
                        {@const measure = timelineMeasure(row)}
                        <HealthRow
                            time={formatTime(entry.logged_at)}
                            datetime={entry.logged_at}
                            tone="move"
                            icon={activityIcon(timelineActivityKind(row))}
                            name={entry.name}
                            detail={[timelineDetail(row), entry.notes, entry.source ? `Synced · ${entry.source}` : ""].filter(Boolean).join(" · ")}
                            amount={measure ? formatNumber(measure.amount) : ""}
                            unit={measure?.unit ?? ""}
                            first={index === 0}
                            last={index === entries.length - 1}
                        >
                            {#snippet actions()}
                                <!-- A synced day belongs to its integration: the next sync would overwrite an edit. -->
                                {#if !entry.source}
                                    <CommandOnly>
                                        <div class="flex @lg:hidden">
                                            <HealthRowMenu name={entry.name} onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry)} />
                                        </div>
                                        <div class="hidden items-center gap-0.5 @lg:flex">
                                            <Button variant="ghost" size="icon" aria-label={`Edit ${entry.name}`} onclick={() => onEdit(entry)}><IconPencil class="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" aria-label={`Delete ${entry.name}`} onclick={() => onDelete(entry)}><IconTrash class="h-4 w-4" /></Button>
                                        </div>
                                    </CommandOnly>
                                {/if}
                            {/snippet}
                        </HealthRow>
                    {/each}
                </ol>
            {/if}
        </section>
    </div>
</section>

<style>
    .day { padding-bottom: var(--stor-section-gap); }
    .body { display: flex; flex-direction: column; gap: var(--stor-section-gap); }
    .diary { display: grid; max-width: 44rem; }
</style>
