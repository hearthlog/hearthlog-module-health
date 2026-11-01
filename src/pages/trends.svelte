<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { executeLocalCommand, queryDatabase } from "@hearthlog/sdk/data";
    import type { AddNutritionGoalEvent, UpdateNutritionGoalEvent } from "@hearthlog/sdk/data";
    import { contextualHref, notify, providePageResource, refreshPageData, tenant } from "@hearthlog/sdk/runtime";
    import { DataPlaceholder, PageDataStatus } from "@hearthlog/sdk/ui";
    import { formatFixed, formatNumber } from "@hearthlog/sdk/format";
    import IconLeft from "~icons/mdi/chevron-left";
    import IconRight from "~icons/mdi/chevron-right";
    import HealthPageHeader from "../components/health/HealthPageHeader.svelte";
    import { shiftLocalDate } from "../calories/logic.js";
    import { minutesClock, monthTitle, shortDate, weekdayDate } from "../health/format.js";
    import type { TrendsPageData } from "./trends.js";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    const data = $derived(resource.data as TrendsPageData);
    providePageResource(() => resource);

    const s = $derived(data.summary);
    const weeks = $derived(Array.from({ length: Math.ceil(data.grid.length / 7) }, (_, index) => data.grid.slice(index * 7, index * 7 + 7)));
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let keepCalibration = $state(false);
    let applying = $state(false);

    function goMonth(step: number): void {
        const [year, month] = data.month.split("-").map(Number);
        const at = new Date(year, month - 1 + step, 1);
        const value = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
        const url = new URL(page.url.href);
        url.searchParams.set("month", value);
        void goto(`${url.pathname}${url.search}`, { replace: true, reset: false });
    }

    function weekSummary(days: typeof data.grid): { eaten: number; budget: number } | null {
        const logged = days.filter((day) => day.logged && day.date < data.today);
        if (logged.length === 0) return null;
        const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
        const budgets = logged.map((day) => day.budget).filter((value) => value > 0);
        return { eaten: avg(logged.map((day) => day.eaten)), budget: budgets.length > 0 ? avg(budgets) : 0 };
    }

    function isoWeek(date: string): number {
        const at = new Date(`${date}T12:00`);
        const thursday = new Date(at);
        thursday.setDate(at.getDate() + 3 - ((at.getDay() + 6) % 7));
        const firstThursday = new Date(thursday.getFullYear(), 0, 4);
        return 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
    }

    // Eight weeks: average eaten as bars against the average budget as ticks, the weight trend as a line.
    const chart = $derived.by(() => {
        const shown = data.weeks;
        if (shown.length === 0) return null;
        const high = Math.max(1, ...shown.map((week) => Math.max(week.eaten, week.budget))) * 1.1;
        const weights = shown.map((week) => week.weight).filter((value): value is number => value !== null);
        const lo = weights.length > 0 ? Math.min(...weights) - 0.5 : 0;
        const hi = weights.length > 0 ? Math.max(...weights) + 0.5 : 1;
        const column = 520 / shown.length;
        return {
            column,
            bars: shown.map((week, index) => ({
                ...week,
                x: 40 + index * column + column * 0.22,
                width: column * 0.56,
                eatenY: 170 - (week.eaten / high) * 150,
                budgetY: 170 - (week.budget / high) * 150,
                label: `W${isoWeek(week.start)}`,
                weightY: week.weight !== null ? 20 + (1 - (week.weight - lo) / (hi - lo)) * 130 : null,
                cx: 40 + index * column + column / 2,
            })),
            from: weights[0] ?? null,
            to: weights.at(-1) ?? null,
        };
    });
    const trendPath = $derived(chart ? chart.bars.filter((bar) => bar.weightY !== null).map((bar, index) => `${index === 0 ? "M" : "L"}${bar.cx},${bar.weightY}`).join(" ") : "");

    async function useCalibration(): Promise<void> {
        const suggested = data.calibration?.suggestedGoal;
        if (!suggested || applying) return;
        applying = true;
        const tomorrow = shiftLocalDate(data.today, 1);
        try {
            const [current, same] = await queryDatabase((repositories) => Promise.all([
                repositories.calories.getLatestNutritionGoal(data.today),
                repositories.calories.getNutritionGoalForDate(tomorrow),
            ]));
            if (!current) return;
            // The macros keep their grams; only the energy changes, and the goal says it was set by hand.
            const payload = {
                effectiveFrom: tomorrow,
                caloriesTarget: suggested,
                proteinTargetG: Number(current.protein_target_g),
                carbsTargetG: Math.max(0, Math.round((suggested - Number(current.protein_target_g) * 4 - Number(current.fat_target_g) * 9) / 4)),
                fatTargetG: Number(current.fat_target_g),
                calorieTargetSource: current.calculation_method ? "manual_override" : "manual",
                calculationMethod: current.calculation_method,
                calculationResult: current.calculation_result,
                calculatedCalories: Number(current.calculated_calories),
                calculationCurrentWeightKg: Number(current.calculation_current_weight_kg),
                calculationTargetWeightKg: Number(current.calculation_target_weight_kg),
                calculationHeightCm: Number(current.calculation_height_cm),
                calculationAgeYears: Number(current.calculation_age_years),
                calculationSex: current.calculation_sex,
                calculationActivityLevel: current.calculation_activity_level,
                calculationTargetDate: current.calculation_target_date,
            };
            if (same) {
                await executeLocalCommand({ id: crypto.randomUUID(), type: "NUTRITION_GOAL_UPDATED", timestamp: Date.now(), payload: { id: same.id, ...payload } } satisfies UpdateNutritionGoalEvent);
            } else {
                await executeLocalCommand({ id: crypto.randomUUID(), type: "NUTRITION_GOAL_ADDED", timestamp: Date.now(), payload: { id: crypto.randomUUID(), ...payload } } satisfies AddNutritionGoalEvent);
            }
            await refreshPageData("app:calories");
            notify.success(`Budget ${formatNumber(suggested)} kcal plus steps from tomorrow`);
        } catch (error) {
            console.error("Failed to apply calibration:", error);
            notify.error("The budget could not be changed");
        } finally {
            applying = false;
        }
    }
</script>

<svelte:head><title>Trends | {tenant.title}</title></svelte:head>

<PageDataStatus {resource} />

<div class="stor-refined w-full overflow-x-hidden">
    <HealthPageHeader active="trends" />
    <div class="stor-page p-2.5 sm:p-3">
        <div class="trends">
            <header class="th">
                <div class="ttl">
                    <p class="over">Look back</p>
                    <h1>{monthTitle(data.month)}</h1>
                </div>
                <div class="nav">
                    <button type="button" class="sq" aria-label="Previous month" onclick={() => goMonth(-1)}><IconLeft class="h-5 w-5" /></button>
                    <button type="button" class="sq" aria-label="Next month" onclick={() => goMonth(1)} disabled={data.month >= data.today.slice(0, 7)}><IconRight class="h-5 w-5" /></button>
                </div>
            </header>

            {#if resource.loading}
                <DataPlaceholder rows={8} label="Loading the month" />
            {:else}
                <section class="stor-panel readout" aria-label="The month in numbers">
                    <div class="cell"><span class="k">Average eaten</span><span class="v">{s.logged > 0 ? formatNumber(Math.round(s.averageEaten)) : "—"}</span><span class="sub">{s.averageBudget > 0 ? `of ${formatNumber(Math.round(s.averageBudget))} budget` : `${s.logged} days logged`}</span></div>
                    <div class="cell"><span class="k">Within 5 %</span><span class="v">{s.within}<small>days</small></span><span class="sub">of {s.logged} logged</span></div>
                    <div class="cell"><span class="k">Over by more</span><span class="v" class:neg={s.over.length > 0}>{s.over.length}<small>days</small></span><span class="sub">{s.over.map((day) => `${shortDate(day.date, data.today)} +${formatNumber(day.by)}`).join(", ") || "none"}</span></div>
                    <div class="cell"><span class="k">Protein met</span><span class="v">{s.proteinMet}<small>days</small></span><span class="sub">marked P below</span></div>
                    {#if s.weightFrom !== null && s.weightTo !== null}
                        <div class="cell"><span class="k">Weight trend</span><span class="v">{formatFixed(s.weightTo - s.weightFrom, 1, { signed: true })}<small>kg</small></span><span class="sub">{formatFixed(s.weightFrom, 1)} → {formatFixed(s.weightTo, 1)} · {s.weighIns} weigh-ins</span></div>
                    {/if}
                </section>

                <div class="grid">
                    <section class="stor-panel cal" aria-label="Days of {monthTitle(data.month)}">
                        <div class="crow head" aria-hidden="true"><span class="wk"></span>{#each weekdays as day (day)}<span>{day}</span>{/each}<span class="ws">Week</span></div>
                        {#each weeks as week (week[0].date)}
                            {@const summary = weekSummary(week)}
                            <div class="crow">
                                <span class="wk">W{isoWeek(week[0].date)}</span>
                                {#each week as day (day.date)}
                                    {@const outside = day.date.slice(0, 7) !== data.month}
                                    {@const future = day.date > data.today}
                                    <a
                                        class="cell-day"
                                        class:out={outside}
                                        class:fut={future}
                                        class:now={day.date === data.today}
                                        class:over={day.status === "over"}
                                        href={contextualHref(`/health?date=${day.date}`)}
                                        aria-label="{weekdayDate(day.date)}: {day.logged ? `${formatNumber(day.eaten)} of ${formatNumber(day.budget)} kcal` : 'nothing logged'}"
                                    >
                                        <span class="dn">{Number(day.date.slice(8))}{#if day.proteinMet}<b class="pm" title="Protein target met">P</b>{/if}</span>
                                        {#if day.logged && !future}
                                            <span class="kc">{formatNumber(day.eaten)}{#if day.status === "over"}<small> +{formatNumber(day.eaten - day.budget)}</small>{/if}</span>
                                            <span class="bar"><i style:width="{day.budget > 0 ? Math.min(100, (day.eaten / day.budget) * 100) : 0}%"></i></span>
                                            {#if day.date === data.today}<span class="so">so far</span>{/if}
                                        {/if}
                                    </a>
                                {/each}
                                <span class="ws">{#if summary}<b>{formatNumber(Math.round(summary.eaten))}</b>{#if summary.budget > 0}<small>of {formatNumber(Math.round(summary.budget))}</small>{/if}{/if}</span>
                            </div>
                        {/each}
                    </section>

                    <div class="side">
                        {#if data.calibration && !keepCalibration}
                            {@const c = data.calibration}
                            <section class="stor-panel card" aria-labelledby="calibration-title">
                                <h2 id="calibration-title" class="h">Your days burn {c.gap > 0 ? "less" : "more"} than estimated</h2>
                                <p class="s">Over the last four weeks the logged food predicts {formatFixed(c.expectedKgPerWeek, 2, { signed: true })} kg a week; the scale shows {formatFixed(c.actualKgPerWeek, 2, { signed: true })}. That is about <b>{formatNumber(Math.abs(c.gap))} kcal a day</b> the estimate does not account for.</p>
                                <div class="row">
                                    <button type="button" class="btn pri" disabled={applying} onclick={() => void useCalibration()}>Budget {formatNumber(c.suggestedGoal)} from tomorrow</button>
                                    <button type="button" class="btn" onclick={() => (keepCalibration = true)}>Keep {formatNumber(data.goal)}</button>
                                </div>
                            </section>
                        {/if}
                        <section class="stor-panel card" aria-labelledby="meals-title">
                            <h2 id="meals-title" class="h">Meals in {monthTitle(data.month).split(" ")[0]}</h2>
                            {#if data.habits.length > 0}
                                <div class="tbl" role="table">
                                    <div class="tr th" role="row"><span role="columnheader">Meal</span><span role="columnheader" class="r">Usually</span><span role="columnheader" class="r">kcal</span><span role="columnheader" class="r">Days</span></div>
                                    {#each data.habits as habit (habit.mealType)}
                                        <div class="tr" role="row"><span role="cell">{habit.label}</span><span role="cell" class="r">{minutesClock(habit.averageMinutes)}</span><span role="cell" class="r b">{formatNumber(Math.round(habit.averageCalories))}</span><span role="cell" class="r">{habit.days}</span></div>
                                    {/each}
                                </div>
                            {:else}
                                <p class="s">Nothing logged this month.</p>
                            {/if}
                        </section>
                    </div>
                </div>

                <div class="grid two">
                    {#if chart}
                        <section class="stor-panel card" aria-labelledby="weeks-title">
                            <header class="ch">
                                <h2 id="weeks-title" class="h">Eight weeks</h2>
                                <p class="legend" aria-hidden="true"><span><i class="bx"></i>Eaten, daily average</span><span><i class="tk"></i>Budget</span>{#if chart.from !== null}<span><i class="ln"></i>Weight trend</span>{/if}</p>
                            </header>
                            <svg viewBox="0 0 580 196" class="wk8" role="img" aria-label="Average eaten and budget per week for eight weeks{chart.from !== null && chart.to !== null ? `, weight from ${formatFixed(chart.from, 1)} to ${formatFixed(chart.to, 1)} kilograms` : ''}">
                                <line class="base" x1="40" x2="560" y1="170" y2="170" />
                                {#each chart.bars as bar (bar.start)}
                                    {#if bar.days > 0}
                                        <rect class="bx" x={bar.x} y={bar.eatenY} width={bar.width} height={170 - bar.eatenY} rx="3" />
                                        {#if bar.budget > 0}<line class="tk" x1={bar.x - 4} x2={bar.x + bar.width + 4} y1={bar.budgetY} y2={bar.budgetY} />{/if}
                                    {/if}
                                    <text class="ax" x={bar.cx} y="188" text-anchor="middle">{bar.label}</text>
                                {/each}
                                {#if trendPath}<path class="ln" d={trendPath} />{/if}
                                {#each chart.bars as bar (bar.start)}{#if bar.weightY !== null}<circle class="pt" cx={bar.cx} cy={bar.weightY} r="3" />{/if}{/each}
                            </svg>
                        </section>
                    {/if}
                    <section class="stor-panel card" aria-labelledby="staples-title">
                        <h2 id="staples-title" class="h">Staples</h2>
                        {#if data.staples.length > 0}
                            <div class="tbl" role="table">
                                <div class="tr th" role="row"><span role="columnheader">Food</span><span role="columnheader" class="r">Times</span><span role="columnheader" class="r">kcal each</span></div>
                                {#each data.staples as staple (staple.name)}
                                    <div class="tr" role="row"><span role="cell" class="nm">{staple.name}</span><span role="cell" class="r b">{staple.uses}×</span><span role="cell" class="r">{formatNumber(Math.round(staple.averageCalories))}</span></div>
                                {/each}
                            </div>
                            <a class="more" href={contextualHref("/calories/foods")}>Food library</a>
                        {:else}
                            <p class="s">Nothing logged this month.</p>
                        {/if}
                    </section>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .trends { display: flex; flex-direction: column; gap: var(--stor-section-gap); padding-bottom: 24px; }
    .th { display: flex; align-items: flex-end; gap: 16px; }
    .ttl { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
    .over { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    h1 { font-family: var(--stor-font-serif); font-size: 30px; font-weight: 500; line-height: 1.15; color: var(--stor-ink); }
    .h { font-size: 15px; font-weight: 650; color: var(--stor-ink); }
    .nav { display: flex; gap: 4px; }
    .sq { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 10px; color: var(--stor-ink); box-shadow: inset 0 0 0 1px var(--stor-border); background: var(--stor-surface); }
    .sq:disabled { opacity: .4; }
    .readout { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); padding: 16px 8px; }
    .cell { display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 2px 16px; }
    .cell + .cell { border-left: 1px solid color-mix(in srgb, var(--stor-border) 60%, transparent); }
    .k { font-size: 12px; font-weight: 600; color: var(--stor-muted-text); }
    .v { font-size: 26px; font-weight: 650; line-height: 1.1; letter-spacing: -.02em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .v.neg { color: var(--stor-negative); }
    .v small { margin-left: 4px; font-size: 12.5px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--stor-muted-text); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: var(--stor-section-gap); align-items: start; }
    .grid.two { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); }
    .side { display: flex; flex-direction: column; gap: var(--stor-section-gap); }
    .cal { display: flex; flex-direction: column; gap: 4px; padding: 12px; }
    .crow { display: grid; grid-template-columns: 36px repeat(7, minmax(0, 1fr)) 92px; gap: 4px; }
    .crow.head { font-size: 12px; font-weight: 600; color: var(--stor-muted-text); padding-bottom: 2px; }
    .crow.head span { padding: 0 8px; }
    .wk { align-self: center; font-size: 11.5px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .cell-day { display: flex; min-height: 76px; flex-direction: column; gap: 4px; padding: 8px; border-radius: 10px; background: color-mix(in srgb, var(--stor-surface-muted) 55%, transparent); color: var(--stor-ink); text-decoration: none; }
    .cell-day:hover { background: var(--stor-surface-hover); }
    .cell-day.out { opacity: .45; }
    .cell-day.fut { background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--stor-border) 50%, transparent); }
    .cell-day.now { box-shadow: inset 0 0 0 1.5px var(--stor-now); }
    .dn { display: flex; align-items: center; justify-content: space-between; font-family: var(--stor-font-serif); font-size: 15px; }
    .pm { display: inline-grid; width: 16px; height: 16px; place-items: center; border-radius: 4px; font-family: var(--stor-font-sans); font-size: 10px; font-weight: 700; color: var(--stor-positive); box-shadow: inset 0 0 0 1px currentColor; }
    .kc { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .kc small { font-size: 11px; color: var(--stor-negative); }
    .bar { display: block; height: 4px; margin-top: auto; border-radius: 2px; background: var(--stor-surface); overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--stor-health-eat); }
    .over .bar i { background: var(--stor-negative); }
    .so { font-size: 11px; color: var(--stor-muted-text); }
    .ws { display: flex; flex-direction: column; justify-content: center; padding: 0 6px; font-size: 13px; font-variant-numeric: tabular-nums; }
    .ws b { font-weight: 650; color: var(--stor-ink); }
    .ws small { font-size: 11.5px; color: var(--stor-muted-text); }
    .card { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; }
    .s { font-size: 13px; line-height: 1.5; color: var(--stor-muted-text); }
    .s b { color: var(--stor-ink); }
    .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn { display: inline-flex; height: 38px; align-items: center; padding: 0 14px; border-radius: 11px; font-size: 13.5px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .btn.pri { color: var(--stor-action-text, #fff); background: var(--stor-action); box-shadow: none; }
    .tbl { display: flex; flex-direction: column; }
    .tr { display: grid; grid-template-columns: minmax(0, 1fr) 70px 70px 50px; align-items: center; gap: 8px; min-height: 36px; font-size: 13.5px; color: var(--stor-ink); }
    .tr + .tr { border-top: 1px solid color-mix(in srgb, var(--stor-border) 50%, transparent); }
    .tr.th { min-height: 28px; font-size: 12px; font-weight: 600; color: var(--stor-muted-text); }
    .r { text-align: right; font-variant-numeric: tabular-nums; color: var(--stor-muted-text); }
    .r.b { font-weight: 600; color: var(--stor-ink); }
    .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .grid.two .tbl .tr { grid-template-columns: minmax(0, 1fr) 60px 80px; }
    .more { align-self: flex-start; font-size: 13px; font-weight: 600; color: var(--stor-accent-text); }
    .ch { display: flex; align-items: center; gap: 16px; }
    .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-left: auto; font-size: 12px; color: var(--stor-muted-text); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend .bx { width: 10px; height: 10px; border-radius: 2px; background: color-mix(in srgb, var(--stor-health-eat) 70%, transparent); }
    .legend .tk { width: 14px; border-top: 2px solid var(--stor-ink); }
    .legend .ln { width: 14px; border-top: 2px solid var(--stor-health-body); }
    .wk8 { width: 100%; height: auto; }
    .wk8 .base { stroke: var(--stor-border); }
    .wk8 .bx { fill: color-mix(in srgb, var(--stor-health-eat) 70%, transparent); }
    .wk8 .tk { stroke: var(--stor-ink); stroke-width: 2; }
    .wk8 .ln { fill: none; stroke: var(--stor-health-body); stroke-width: 2; }
    .wk8 .pt { fill: var(--stor-surface); stroke: var(--stor-health-body); stroke-width: 1.6; }
    .wk8 .ax { font-size: 11px; fill: var(--stor-muted-text); }
    @media (max-width: 1100px) { .grid, .grid.two { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 767px) {
        h1 { font-size: 24px; }
        .readout { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 14px; }
        .cell + .cell { border-left: 0; }
        .cal { padding: 6px; }
        .crow { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
        .wk, .ws { display: none; }
        .crow.head span { padding: 0 2px; text-align: center; }
        .cell-day { min-height: 54px; padding: 4px; }
        .kc { font-size: 11px; }
        .kc small { display: none; }
        .so { display: none; }
    }
</style>
