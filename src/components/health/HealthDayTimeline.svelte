<script lang="ts">
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { EmptyState } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import HealthRow from "./HealthRow.svelte";
    import HealthNowRow from "./HealthNowRow.svelte";
    import RiverGutter from "./RiverGutter.svelte";
    import UsualPaceToggle from "./UsualPaceToggle.svelte";
    import { activityIcon, foodIcon } from "./health-icons.js";
    import { contextualHref } from "@hearthlog/sdk/runtime";
    import { formatNumber } from "@hearthlog/sdk/format";
    import { riverCells, riverScale, type RiverAnchor } from "../../health/river.js";
    import {
        nowMarkerIndex,
        timelineActivityKind,
        timelineDetail,
        timelineMeasure,
        timelineTone,
        type HealthSources,
    } from "../../health/day.js";
    import type { HealthTimelineRow, UsualPace } from "../../data/health-day.js";
    import IconPlus from "~icons/mdi/plus";

    /**
     * The day's log. From `lg` two gutters beside it draw the running totals,
     * calories on the left and steps on the right, stepping sideways at every
     * entry; the usual pace can be laid over the calories. Phones get the same
     * story as charts above the list, so the list keeps its width.
     */
    const titleId = $props.id();
    let {
        rows,
        loading,
        selectedDate,
        nowTime = null,
        nextMeal = null,
        targets,
        sources,
        usualPace = null,
        showUsual = false,
        onToggleUsual,
        class: className = "",
    }: {
        rows: HealthTimelineRow[];
        loading: boolean;
        selectedDate: string;
        /** `HH:mm` when the day is today; the marker is placed among rows already ordered by SQL. */
        nowTime?: string | null;
        /** The next meal slot with nothing logged; only offered on today. */
        nextMeal?: { id: string; label: string } | null;
        targets: { calories: number; steps: number };
        sources: HealthSources;
        usualPace?: UsualPace | null;
        showUsual?: boolean;
        onToggleUsual?: () => void;
        class?: string;
    } = $props();

    type Item =
        | { kind: "row"; row: HealthTimelineRow; index: number }
        | { kind: "now" }
        | { kind: "next"; slot: { id: string; label: string } };

    // Rows keep the order SQL gave them; the marker and the next meal are placed around them.
    const marker = $derived(nowTime !== null ? nowMarkerIndex(rows, nowTime) : -1);
    const items = $derived.by((): Item[] => {
        const list: Item[] = rows.map((row, index) => ({ kind: "row", row, index }));
        if (nowTime !== null) list.splice(marker, 0, { kind: "now" });
        if (nowTime !== null && nextMeal && rows.length > 0) list.push({ kind: "next", slot: nextMeal });
        return list;
    });

    // --- the river: everything below is layout of totals SQL already summed.
    const usualByTime = $derived(new Map((usualPace?.points ?? []).map((point) => [point.time, point.kcal])));
    const usualOn = $derived(showUsual && usualPace !== null);
    /** The item where the line stops: the marker on today, the last entry on other days. */
    const endItem = $derived.by(() => {
        if (nowTime !== null) return items.findIndex((item) => item.kind === "now");
        return items.length - 1;
    });
    const totalBefore = (index: number, key: "kcalTotal" | "stepsTotal"): number => (index > 0 ? rows[index - 1][key] : 0);
    const timeOf = (item: Item): string => (item.kind === "row" ? item.row.loggedAt.slice(11, 16) : item.kind === "now" && nowTime ? nowTime : "");

    function anchorsFor(key: "kcalTotal" | "stepsTotal", withUsual: boolean): RiverAnchor[] {
        const anchors: RiverAnchor[] = [];
        for (let position = 0; position <= endItem && position < items.length; position++) {
            const item = items[position];
            if (item.kind === "next") break;
            const before = item.kind === "row" ? totalBefore(item.index, key) : totalBefore(marker, key);
            const after = item.kind === "row" ? item.row[key] : before;
            anchors.push({ before, after, usual: withUsual ? usualByTime.get(timeOf(item)) ?? null : null });
        }
        return anchors;
    }

    const kcalAnchors = $derived(sources.meals && endItem >= 0 ? anchorsFor("kcalTotal", usualOn) : []);
    const stepAnchors = $derived(sources.activity && endItem >= 0 ? anchorsFor("stepsTotal", false) : []);
    const kcalScale = $derived(
        riverScale(targets.calories, kcalAnchors.at(-1)?.after ?? 0, ...(usualOn ? [...usualByTime.values()] : [])),
    );
    const stepScale = $derived(riverScale(targets.steps, stepAnchors.at(-1)?.after ?? 0));
    const kcalCells = $derived(riverCells(kcalAnchors, kcalScale));
    const stepCells = $derived(riverCells(stepAnchors, stepScale));
    const river = $derived(!loading && rows.length > 0 && (sources.meals || sources.activity));
</script>

<section class="stor-panel {className}" aria-labelledby="{titleId}-title">
    <!-- Phones: the top bar names the day; the log needs no heading of its own. -->
    <header class="stor-panel-header max-md:sr-only">
        <h2 id="{titleId}-title" class="font-semibold text-[var(--stor-ink)]">Timeline</h2>
        {#if !loading && rows.length > 0}
            <span class="text-xs text-[var(--stor-muted-text)]">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
        {/if}
    </header>
    {#if loading}
        <div class="px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]"><DataPlaceholder rows={4} compact /></div>
    {:else if rows.length === 0}
        <EmptyState surface={false} title="Nothing logged on this day" description="Meals and movement appear here in the order they happened." />
    {:else}
        <div class="body px-[var(--stor-panel-padding)] pb-[var(--stor-panel-padding)]" class:river style:--gutter-l={sources.meals ? "112px" : "0px"} style:--gutter-r={sources.activity ? "112px" : "0px"}>
            {#if river}
                <div class="heads">
                    <div class="head stor-tone-eat">
                        {#if sources.meals}<b>Eaten so far</b>{#if targets.calories > 0}<span>target {formatNumber(targets.calories)} kcal</span>{/if}{/if}
                    </div>
                    <div class="legend">
                        {#if sources.meals && usualPace && onToggleUsual}
                            <UsualPaceToggle pressed={showUsual} onToggle={onToggleUsual} />
                        {/if}
                    </div>
                    <div class="head right stor-tone-move">
                        {#if sources.activity}<b>Steps so far</b>{#if targets.steps > 0}<span>target {formatNumber(targets.steps)}</span>{/if}{/if}
                    </div>
                </div>
            {/if}
            <ol class="timeline">
                {#each items as item, index (item.kind === "row" ? item.row.kind + item.row.id : item.kind)}
                    {@const first = index === 0}
                    {@const last = index === items.length - 1}
                    {#if item.kind === "now" && nowTime}
                        <HealthNowRow time={nowTime} {first} {last}>
                            {#snippet lead()}{#if sources.meals}<RiverGutter side="left" tone="eat" budget cell={kcalCells[index] ?? null} target={targets.calories} scale={kcalScale} label={formatNumber(kcalAnchors[index]?.after ?? 0)} />{/if}{/snippet}
                            {#snippet trail()}{#if sources.activity}<RiverGutter side="right" tone="move" cell={stepCells[index] ?? null} target={targets.steps} scale={stepScale} label={formatNumber(stepAnchors[index]?.after ?? 0)} />{/if}{/snippet}
                        </HealthNowRow>
                    {:else if item.kind === "next"}
                        <HealthRow
                            tone="eat"
                            icon={IconPlus}
                            name={item.slot.label}
                            detail="Not logged yet"
                            ghost
                            {first}
                            {last}
                        >
                            {#snippet action()}
                                <CommandOnly>
                                    <a
                                        class="inline-flex h-11 items-center rounded-xl bg-[var(--stor-surface-raised)] px-3 text-sm font-semibold text-[var(--stor-ink)] shadow-[var(--stor-shadow-sm)] hover:bg-[var(--stor-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)] sm:h-9"
                                        href={contextualHref(`/calories?date=${selectedDate}&newEntry=1&meal=${item.slot.id}`)}
                                        aria-label="Log {item.slot.label}"
                                    >Log</a>
                                </CommandOnly>
                            {/snippet}
                            {#snippet lead()}{#if sources.meals}<RiverGutter side="left" tone="eat" budget cell={null} target={targets.calories} scale={kcalScale} />{/if}{/snippet}
                            {#snippet trail()}{#if sources.activity}<RiverGutter side="right" tone="move" cell={null} target={targets.steps} scale={stepScale} />{/if}{/snippet}
                        </HealthRow>
                    {:else if item.kind === "row"}
                        {@const row = item.row}
                        {@const measure = timelineMeasure(row)}
                        <HealthRow
                            time={row.loggedAt.slice(11, 16)}
                            datetime={row.loggedAt}
                            tone={timelineTone(row)}
                            icon={row.kind === "meal" ? foodIcon : activityIcon(timelineActivityKind(row))}
                            name={row.name}
                            detail={timelineDetail(row)}
                            amount={measure ? formatNumber(measure.amount) : ""}
                            unit={measure?.unit ?? ""}
                            {first}
                            {last}
                        >
                            {#snippet lead()}{#if sources.meals}<RiverGutter side="left" tone="eat" budget cell={kcalCells[index] ?? null} target={targets.calories} scale={kcalScale} label={formatNumber(kcalAnchors[index]?.after ?? 0)} />{/if}{/snippet}
                            {#snippet trail()}{#if sources.activity}<RiverGutter side="right" tone="move" cell={stepCells[index] ?? null} target={targets.steps} scale={stepScale} label={formatNumber(stepAnchors[index]?.after ?? 0)} />{/if}{/snippet}
                        </HealthRow>
                    {/if}
                {/each}
            </ol>
        </div>
    {/if}
</section>

<style>
    .timeline { display: grid; max-width: 44rem; }
    .heads, .legend { display: none; }
    /* A wide day sets the log between two gutters; the headers line up with them. */
    @container health-day (min-width: 32rem) {
        .body.river .timeline { max-width: none; }
        .heads {
            display: grid; grid-template-columns: var(--gutter-l) minmax(0, 1fr) var(--gutter-r); column-gap: 14px; align-items: end;
            padding-bottom: 6px;
        }
        .head { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 12px; color: var(--stor-muted-text); }
        .head b { font-size: 12.5px; font-weight: 650; color: var(--stor-ink); }
        .head.right { align-items: flex-end; text-align: right; }
        .legend { display: flex; justify-content: center; }
    }
</style>
