<script lang="ts">
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import type { AddWeightlogEvent, RemoveWeightlogEvent } from "@hearthlog/sdk/data";
    import { appClock, contextualHref, notify, providePageResource, refreshPageData, tenant } from "@hearthlog/sdk/runtime";
    import { CommandDrawer, DataPlaceholder, MobilePageAction, PageDataStatus } from "@hearthlog/sdk/ui";
    import { formatFixed, formatNumber } from "@hearthlog/sdk/format";
    import HealthPageHeader from "../components/health/HealthPageHeader.svelte";
    import WeightChart from "../components/health/WeightChart.svelte";
    import WeighInsTable from "../components/health/WeighInsTable.svelte";
    import WeighIn from "../components/body/WeighIn.svelte";
    import { shiftLocalDate, toLocalDateString } from "../calories/logic.js";
    import { arrivalDate } from "../health/budget.js";
    import { daysBetween, dayTitle, shortDate } from "../health/format.js";
    import type { WeightPageData } from "../health/weight.js";
    import type { WeighInRow } from "../data/weight-logs.js";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    const data = $derived(resource.data as WeightPageData);
    providePageResource(() => resource);

    const today = $derived(toLocalDateString(appClock.now()));
    const latest = $derived(data.latest);
    const latestDate = $derived(latest ? String(latest.date).slice(0, 10) : "");
    const height = $derived(latest ? Number(latest.height) : 0);
    const bmi = $derived(latest && height > 0 ? Number(latest.weight) / (height / 100) ** 2 : null);
    const range = $derived(height > 0 ? { min: 18.5 * (height / 100) ** 2, max: 24.9 * (height / 100) ** 2 } : null);
    const goal = $derived(data.goal);
    const trendNow = $derived(data.trendNow);
    // The trend pauses after a week without a weigh-in instead of guessing.
    const stale = $derived(latestDate !== "" && daysBetween(latestDate, today) > 7);
    const arrival = $derived(goal && trendNow !== null && data.pace !== null && !stale ? arrivalDate(latestDate, trendNow, goal.targetKg, data.pace) : null);

    type Span = 90 | 365 | "all";
    let span = $state<Span>(90);
    const trend = $derived(data.trends[span === 90 ? 90 : span === 365 ? 365 : "all"]);
    // With a goal the axis runs on to where the trend meets it, or the planned date, up to a year ahead.
    const axisEnd = $derived.by(() => {
        if (!latestDate) return today;
        const ends = [latestDate, goal?.targetDate ?? "", arrival ?? ""].filter((date) => date && date <= shiftLocalDate(latestDate, 365));
        return ends.sort().at(-1) ?? latestDate;
    });

    let mobileWeighOpen = $state(false);
    let removing = $state<string | null>(null);

    async function remove(row: WeighInRow): Promise<void> {
        if (removing) return;
        removing = row.id;
        const event: RemoveWeightlogEvent = { id: crypto.randomUUID(), type: "WEIGHTLOG_REMOVED", timestamp: Date.now(), payload: { id: row.id } };
        try {
            await executeLocalCommand(event);
            await refreshPageData("app:weight-logs");
            notify.success(`Removed ${formatFixed(row.weight, 1)} kg from ${shortDate(row.date, today)}`, {
                label: "Undo",
                run: async () => {
                    const add: AddWeightlogEvent = { id: crypto.randomUUID(), type: "WEIGHTLOG_ADDED", timestamp: Date.now(), payload: { id: crypto.randomUUID(), weight: row.weight, height: row.height, date: row.date, notes: "" } };
                    try {
                        await executeLocalCommand(add);
                        await refreshPageData("app:weight-logs");
                    } catch {
                        notify.error("Could not undo");
                    }
                },
            });
        } catch (error) {
            console.error("Failed to remove weigh-in:", error);
            notify.error("Could not remove the weigh-in");
        } finally {
            removing = null;
        }
    }

    const bmiBands = [
        { label: "Under", to: 18.5 },
        { label: "Healthy", to: 25 },
        { label: "Over", to: 30 },
        { label: "Obese", to: 40 },
    ];
    const bmiAt = (value: number) => Math.min(100, Math.max(0, ((value - 15) / (40 - 15)) * 100));
</script>

<svelte:head><title>Body | {tenant.title}</title></svelte:head>

<PageDataStatus {resource} />

<!-- Stable read-only hooks keep saved measurements observable to tests and assistive tooling. -->
<input id="height" type="hidden" value={height || ""} />
<input id="weight" type="hidden" value={latest ? Number(latest.weight) : ""} />

<div class="stor-refined w-full overflow-x-hidden">
    <HealthPageHeader active="body" />
    <div class="stor-page p-2.5 sm:p-3">
        <div class="body">
            <header class="bh">
                <div class="ttl">
                    <p class="over">{dayTitle(today, today)}{latestDate === today ? " · weighed" : ""}</p>
                    <h1>Body</h1>
                </div>
                {#if tenant.features.has("calories")}<a class="btn" href={contextualHref("/bmi/goal")}>Goal and pace</a>{/if}
            </header>

            {#if resource.loading}
                <DataPlaceholder rows={8} label="Loading weight" />
            {:else}
                <div class="top">
                    <section class="stor-panel weigh max-md:hidden" aria-labelledby="weigh-title">
                        <h2 id="weigh-title" class="h">{latestDate === today ? "Weigh again" : "This morning"}</h2>
                        <WeighIn date={today} />
                    </section>

                    <section class="stor-panel readout" aria-label="Weight at a glance">
                        <div class="cell lead">
                            <span class="k">Trend</span>
                            <span class="v">{trendNow !== null ? formatFixed(trendNow, 1) : "—"}<small>kg</small></span>
                            <span class="s">{stale ? `Paused · last weigh-in ${daysBetween(latestDate, today)} days ago` : "Seven-day average"}</span>
                        </div>
                        <div class="cell">
                            <span class="k">{latestDate === today ? "Today" : "Latest"}</span>
                            <span class="v">{latest ? formatFixed(Number(latest.weight), 1) : "—"}<small>kg</small></span>
                            <span class="s">{latestDate ? shortDate(latestDate, today) : "No weigh-ins yet"}</span>
                        </div>
                        <div class="cell">
                            <span class="k">Pace</span>
                            <span class="v">{data.pace !== null ? formatFixed(data.pace, 2, { signed: true }) : "—"}<small>kg/wk</small></span>
                            <span class="s">{goal?.plannedPace != null ? `plan ${formatFixed(goal.plannedPace, 2, { signed: true })}` : "last 30 days"}</span>
                        </div>
                        {#if goal}
                            <div class="cell">
                                <span class="k">To goal</span>
                                <span class="v">{trendNow !== null ? formatFixed(Math.abs(trendNow - goal.targetKg), 1) : "—"}<small>kg</small></span>
                                <span class="s">goal {formatFixed(goal.targetKg, 1)} kg</span>
                            </div>
                            <div class="cell">
                                <span class="k">Arrival</span>
                                <span class="v sm">{arrival ? `~${shortDate(arrival, arrival)}` : "—"}</span>
                                <span class="s">{goal.targetDate ? `planned ${shortDate(goal.targetDate, goal.targetDate)}` : arrival ? "at your actual pace" : "needs a steady pace"}</span>
                            </div>
                        {/if}
                        <div class="cell">
                            <span class="k">BMI</span>
                            <span class="v">{bmi !== null ? formatFixed(bmi, 1) : "—"}</span>
                            <span class="s">{height ? `${formatNumber(height)} cm` : ""}</span>
                        </div>
                    </section>
                </div>

                {#if trend.weighIns.length > 0}
                    <section class="stor-panel chart" aria-labelledby="chart-title">
                        <header class="ch">
                            <h2 id="chart-title" class="h">{goal ? "Weight and goal" : "Weight"}</h2>
                            <p class="legend" aria-hidden="true">
                                <span><i class="dot"></i>Weigh-in</span><span><i class="ln"></i>Trend</span>
                                {#if goal}<span><i class="dl"></i>Plan</span><span><i class="pj"></i>At your pace</span>{/if}
                            </p>
                            <div class="seg" role="radiogroup" aria-label="Range">
                                {#each [[90, "3 months"], [365, "Year"], ["all", "All"]] as [value, label] (value)}
                                    <button type="button" role="radio" aria-checked={span === value} class:on={span === value} onclick={() => (span = value as Span)}>{label}</button>
                                {/each}
                            </div>
                        </header>
                        <WeightChart
                            weighIns={trend.weighIns}
                            mean={trend.mean}
                            from={trend.from}
                            to={axisEnd}
                            band={goal ? null : range}
                            goal={goal?.targetKg ?? null}
                            plan={goal && goal.targetDate ? { from: goal.startDate, fromKg: goal.startKg, to: goal.targetDate, toKg: goal.targetKg } : null}
                            projection={arrival && trendNow !== null && goal ? { from: latestDate, fromKg: trendNow, to: arrival, toKg: goal.targetKg } : null}
                            today={axisEnd > today ? today : null}
                            label="Weight from {shortDate(trend.from, today)}{goal ? `, with the goal of ${formatFixed(goal.targetKg, 1)} kilograms` : ''}"
                        />
                    </section>
                {/if}

                <div class="bottom">
                    <section class="stor-panel list" aria-labelledby="weighins-title">
                        <header class="ch"><h2 id="weighins-title" class="h">Weigh-ins</h2>{#if data.total > 0}<span class="mt">{formatNumber(data.total)}</span>{/if}</header>
                        <WeighInsTable total={data.total} {today} revision={resource.revision} busyId={removing} onDelete={(row) => void remove(row)} />
                    </section>
                    <div class="side">
                        {#if bmi !== null && range}
                            <section class="stor-panel card" aria-labelledby="bmi-title">
                                <h2 id="bmi-title" class="h">BMI {formatFixed(bmi, 1)}</h2>
                                <div class="scale" aria-hidden="true">
                                    {#each bmiBands as band, index (band.label)}
                                        {@const from = index === 0 ? 15 : bmiBands[index - 1].to}
                                        <span class:healthy={band.label === "Healthy"} style:flex="{band.to - from} 0 0">{band.label}</span>
                                    {/each}
                                    <i style:left="{bmiAt(bmi)}%"></i>
                                </div>
                                <p class="s">Healthy range at {formatNumber(height)} cm is {formatFixed(range.min, 1)}–{formatFixed(range.max, 1)} kg.</p>
                                <p class="s">BMI is a screening estimate, not a diagnosis.</p>
                            </section>
                        {/if}
                        {#if goal}
                            {@const done = trendNow !== null ? Math.max(0, Math.min(Math.abs(goal.startKg - goal.targetKg), Math.abs(goal.startKg - trendNow))) : 0}
                            {@const total = Math.abs(goal.startKg - goal.targetKg)}
                            <a class="stor-panel card link" href={contextualHref("/bmi/goal")}>
                                <h2 class="h">Goal {formatFixed(goal.targetKg, 1)} kg</h2>
                                <span class="prog"><i style:width="{total > 0 ? (done / total) * 100 : 0}%"></i></span>
                                <p class="s">From {formatFixed(goal.startKg, 1)} kg on {shortDate(goal.startDate, today)}: {formatFixed(done, 1)} of {formatFixed(total, 1)} kg</p>
                                <p class="s">Budget {formatNumber(goal.calories)} kcal + steps{#if goal.proteinG > 0} · protein {formatNumber(goal.proteinG)} g{/if}</p>
                            </a>
                        {:else if tenant.features.has("calories")}
                            <a class="stor-panel card link" href={contextualHref("/bmi/goal")}>
                                <h2 class="h">No goal yet</h2>
                                <p class="s">Pick a goal weight and a pace; Health works out the daily budget and when you get there.</p>
                            </a>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

<CommandDrawer show={mobileWeighOpen} title="Weigh in" onClose={() => (mobileWeighOpen = false)}>
    {#if mobileWeighOpen}<WeighIn date={today} onSaved={() => (mobileWeighOpen = false)} />{/if}
</CommandDrawer>

<MobilePageAction hideWhenModalOpen isModalOpen={mobileWeighOpen}>
    <button type="button" class="mob" onclick={() => (mobileWeighOpen = true)} aria-label="Add weigh-in">Weigh in</button>
</MobilePageAction>

<style>
    .body { display: flex; flex-direction: column; gap: var(--stor-section-gap); padding-bottom: 24px; }
    .bh { display: flex; align-items: flex-end; gap: 16px; }
    .ttl { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
    .over { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    h1 { font-family: var(--stor-font-serif); font-size: 30px; font-weight: 500; line-height: 1.15; color: var(--stor-ink); }
    .h { font-size: 15px; font-weight: 650; color: var(--stor-ink); }
    .btn { display: inline-flex; height: 40px; align-items: center; padding: 0 14px; border-radius: 12px; font-size: 14px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface); box-shadow: inset 0 0 0 1px var(--stor-border); text-decoration: none; }
    .btn:hover { background: var(--stor-surface-hover); }
    .top { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: var(--stor-section-gap); }
    .weigh { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; }
    .readout { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); align-content: center; padding: 18px 8px; }
    .cell { display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 4px 16px; }
    .cell + .cell { border-left: 1px solid color-mix(in srgb, var(--stor-border) 60%, transparent); }
    .k { font-size: 12px; font-weight: 600; color: var(--stor-muted-text); }
    .v { font-size: 26px; font-weight: 650; line-height: 1.1; letter-spacing: -.02em; color: var(--stor-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .lead .v { font-size: 40px; color: var(--stor-ink); }
    .v.sm { font-size: 22px; }
    .v small { margin-left: 4px; font-size: 12.5px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .s { font-size: 12.5px; line-height: 1.45; color: var(--stor-muted-text); }
    .chart { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px 12px; }
    .ch { display: flex; align-items: center; gap: 16px; }
    .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-right: auto; font-size: 12px; color: var(--stor-muted-text); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend .dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: inset 0 0 0 1.4px var(--stor-health-body); }
    .legend .ln { width: 16px; height: 2.4px; border-radius: 2px; background: var(--stor-health-body); }
    .legend .dl { width: 16px; border-top: 1.6px dotted var(--stor-muted-text); }
    .legend .pj { width: 16px; border-top: 2px dashed var(--stor-health-body); }
    .seg { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--stor-surface-muted); }
    .seg button { height: 28px; padding: 0 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: var(--stor-muted-text); }
    .seg button.on { background: var(--stor-surface); color: var(--stor-ink); box-shadow: var(--stor-elevation-1); }
    .bottom { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--stor-section-gap); align-items: start; }
    .list { padding: 14px 8px 8px; }
    .list .ch { padding: 0 12px 6px; justify-content: space-between; }
    .mt { font-size: 12px; color: var(--stor-muted-text); }
    .side { display: flex; flex-direction: column; gap: var(--stor-section-gap); }
    .card { display: flex; flex-direction: column; gap: 8px; padding: 18px 20px; color: inherit; text-decoration: none; }
    .link:hover { box-shadow: var(--stor-elevation-2); }
    .scale { position: relative; display: flex; gap: 2px; margin: 6px 0 4px; }
    .scale span { display: block; padding-top: 12px; border-top: 6px solid var(--stor-surface-muted); font-size: 11px; color: var(--stor-muted-text); }
    .scale span.healthy { border-top-color: color-mix(in srgb, var(--stor-positive) 45%, var(--stor-surface-muted)); color: var(--stor-ink); }
    .scale i { position: absolute; top: -4px; width: 3px; height: 14px; margin-left: -1.5px; border-radius: 2px; background: var(--stor-ink); }
    .prog { display: block; height: 6px; border-radius: 3px; background: var(--stor-surface-muted); overflow: hidden; }
    .prog i { display: block; height: 100%; border-radius: inherit; background: var(--stor-health-body); }
    .mob { display: inline-flex; width: 100%; height: 48px; align-items: center; justify-content: center; border-radius: 14px; font-size: 15px; font-weight: 600; color: var(--stor-action-text, #fff); background: var(--stor-action); }
    @media (max-width: 1100px) { .top, .bottom { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 767px) {
        h1 { font-size: 24px; }
        .readout { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 14px; }
        .cell + .cell { border-left: 0; }
        .lead { grid-column: 1 / -1; }
        .ch { flex-wrap: wrap; gap: 8px; }
        .legend { order: 3; flex-basis: 100%; }
        .chart { padding: 14px 12px 8px; }
    }
</style>
