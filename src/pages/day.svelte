<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { appClock, contextualHref, keepPageData, providePageResource, tenant } from "@hearthlog/sdk/runtime";
    import { CommandDrawer, DataPlaceholder, MobilePageAction, PageDataStatus } from "@hearthlog/sdk/ui";
    import { formatFixed, formatNumber } from "@hearthlog/sdk/format";
    import { shiftDay } from "@hearthlog/sdk/endless";
    import IconLeft from "~icons/mdi/chevron-left";
    import IconRight from "~icons/mdi/chevron-right";
    import IconPlus from "~icons/mdi/plus";
    import HealthPageHeader from "../components/health/HealthPageHeader.svelte";
    import WeekStrip from "../components/day/WeekStrip.svelte";
    import BudgetCard from "../components/day/BudgetCard.svelte";
    import DiaryTable from "../components/day/DiaryTable.svelte";
    import LogFoodSheet from "../components/day/LogFoodSheet.svelte";
    import WeighIn from "../components/body/WeighIn.svelte";
    import Sparkline from "../components/health/Sparkline.svelte";
    import { effectiveMealSlots, resolveDefaultMeal, toLocalDateString } from "../calories/logic.js";
    import { dayArrowStep } from "../health/day.js";
    import { dayTitle, shortDate } from "../health/format.js";
    import type { HealthPageData } from "./day.js";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    // The last day stays on screen while the next one loads, so stepping days never flashes the page.
    const kept = keepPageData(() => resource);
    providePageResource(() => kept.display);
    const data = $derived(kept.data as HealthPageData);
    const view = $derived(data.view);

    const now = $derived(appClock.now());
    const today = $derived(toLocalDateString(now));
    const date = $derived(data.selectedDate);
    const slots = $derived(effectiveMealSlots(data.mealSlots).filter((slot) => !slot.archived));
    const isToday = $derived(date === today);

    let logOpen = $state(false);
    let logMeal = $state("");
    let logTerm = $state("");
    let weighOpen = $state(false);

    function openLog(meal?: string, term = ""): void {
        logMeal = meal ?? resolveDefaultMeal(slots, isToday ? now : `${date}T12:00`);
        logTerm = term;
        logOpen = true;
    }

    function goToDay(day: string): void {
        const url = new URL(page.url.href);
        if (day === today) url.searchParams.delete("date");
        else url.searchParams.set("date", day);
        void goto(`${url.pathname}${url.search}`, { replace: true, reset: false });
    }

    // A shortcut from elsewhere (`?log=1`) opens the sheet once, then leaves the address.
    $effect(() => {
        if (kept.loading || !page.url.searchParams.has("log")) return;
        openLog();
        const url = new URL(page.url.href);
        url.searchParams.delete("log");
        void goto(`${url.pathname}${url.search}`, { replace: true, reset: false });
    });

    function keydown(event: KeyboardEvent): void {
        if (logOpen || weighOpen) return;
        const step = dayArrowStep(event);
        if (step !== 0) {
            event.preventDefault();
            goToDay(shiftDay(date, step));
            return;
        }
        const target = event.target as HTMLElement | null;
        if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
        const key = event.key.toLowerCase();
        if (key === "f" && data.sources.meals) { event.preventDefault(); openLog(); }
        else if (key === "w" && data.sources.body) { event.preventDefault(); weighOpen = true; }
        else if (key === "t" && !isToday) { event.preventDefault(); goToDay(today); }
    }

    const mealCalories = $derived(Object.fromEntries((view?.meals ?? []).map((meal) => [meal.slot.id, meal.calories])));
    const weight = $derived(view?.weight ?? null);
</script>

<svelte:window onkeydown={keydown} />
<svelte:head><title>Health day | {tenant.title}</title></svelte:head>

<PageDataStatus {resource} />

<div class="stor-refined w-full overflow-x-hidden">
    <HealthPageHeader active="day" />
    <div class="stor-page p-2.5 sm:p-3">
        <div class="day">
            <header class="dh">
                <div class="nav">
                    <button type="button" class="sq" aria-label="Previous day" aria-keyshortcuts="ArrowLeft" onclick={() => goToDay(shiftDay(date, -1))}><IconLeft class="h-5 w-5" /></button>
                    <button type="button" class="sq" aria-label="Next day" aria-keyshortcuts="ArrowRight" onclick={() => goToDay(shiftDay(date, 1))}><IconRight class="h-5 w-5" /></button>
                    {#if !isToday}<button type="button" class="pill" aria-keyshortcuts="T" onclick={() => goToDay(today)}>Today</button>{/if}
                </div>
                <div class="ttl">
                    <p class="over">{#if isToday}<i class="now" aria-hidden="true"></i>Today · {now.toTimeString().slice(0, 5)}{:else}{date < today ? "Looking back" : "Ahead"}{/if}</p>
                    <h1>{dayTitle(date, today)}</h1>
                </div>
                <div class="acts">
                    {#if data.sources.body}<button type="button" class="btn" aria-keyshortcuts="W" onclick={() => (weighOpen = true)}>Weigh in <span class="kbd">W</span></button>{/if}
                    {#if data.sources.meals}<button type="button" class="btn pri" aria-keyshortcuts="F" onclick={() => openLog()}><IconPlus class="h-4 w-4" /> Log food <span class="kbd inv">F</span></button>{/if}
                </div>
            </header>

            {#if view && data.sources.meals}
                <WeekStrip week={view.week} selected={date} {today} />
            {/if}

            {#if !view}
                <DataPlaceholder rows={8} label="Loading the day" />
            {:else}
                <div class="grid">
                    <div class="main">
                        {#if data.sources.meals}
                            <BudgetCard {view} {today} />
                            <section class="stor-panel diary" aria-label="Food diary">
                                <DiaryTable {date} {today} meals={view.meals} next={view.next} onLog={(meal, term) => openLog(meal, term)} />
                            </section>
                        {/if}
                    </div>
                    <aside class="side">
                        {#if weight}
                            <a class="stor-panel card link" href={contextualHref("/bmi")}>
                                <p class="over">Weight trend</p>
                                {#if weight.trend !== null}
                                    <p class="big">{formatFixed(weight.trend, 1)}<small>kg</small></p>
                                    <p class="sub">
                                        {#if weight.pace !== null}<span>{formatFixed(weight.pace, 2, { signed: true })} kg/week</span>{/if}
                                        {#if weight.latest}<span>{weight.latest.date === date ? "Today" : `Last ${shortDate(weight.latest.date, date)}`} {formatFixed(weight.latest.weight, 1)}</span>{/if}
                                    </p>
                                    {#if weight.means.length > 1}
                                        <div class="spark"><Sparkline points={weight.means.map((point, index) => ({ x: index, y: point.mean }))} tone="body" label="Weight trend over 30 days" width={260} height={44} /></div>
                                    {/if}
                                    <p class="foot">{weight.weighIns30} weigh-ins in the last 30 days</p>
                                {:else}
                                    <p class="sub">No weigh-ins yet. One number in the morning is enough.</p>
                                {/if}
                            </a>
                        {/if}
                        {#if view.steps}
                            <a class="stor-panel card link" href={contextualHref("/activities")}>
                                <p class="over">Steps</p>
                                <p class="big">{formatNumber(view.steps.steps)}{#if view.budget.steps > 0}<small>+{formatNumber(view.budget.steps)} kcal</small>{/if}</p>
                                {#if view.steps.target > 0}
                                    <span class="sbar"><i style:width="{Math.min(100, (view.steps.steps / view.steps.target) * 100)}%"></i></span>
                                    <p class="sub"><span>{view.steps.steps >= view.steps.target ? "Target reached" : `${formatNumber(view.steps.target - view.steps.steps)} to ${formatNumber(view.steps.target)}`}</span></p>
                                {/if}
                                <p class="foot">Steps sync on their own and add to the day's budget.</p>
                            </a>
                        {/if}
                    </aside>
                </div>
            {/if}
        </div>
    </div>
</div>

{#if data.sources.meals && view}
    <LogFoodSheet
        show={logOpen}
        {date}
        {today}
        {slots}
        meal={logMeal}
        term={logTerm}
        eaten={view.budget.eaten}
        budget={view.budget.budget}
        {mealCalories}
        onClose={() => (logOpen = false)}
    />
{/if}

<CommandDrawer show={weighOpen} title="Weigh in" onClose={() => (weighOpen = false)}>
    {#if weighOpen}<WeighIn {date} onSaved={() => (weighOpen = false)} />{/if}
</CommandDrawer>

{#if data.sources.meals}
    <MobilePageAction hideWhenModalOpen isModalOpen={logOpen || weighOpen}>
        <button type="button" class="mob" onclick={() => openLog()}><IconPlus class="h-5 w-5" /> Log food</button>
    </MobilePageAction>
{/if}

<style>
    .day { display: flex; flex-direction: column; gap: var(--stor-section-gap); padding-bottom: 24px; }
    .dh { display: flex; align-items: center; gap: 16px; }
    .nav { display: flex; align-items: center; gap: 4px; }
    .sq { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 10px; color: var(--stor-ink); box-shadow: inset 0 0 0 1px var(--stor-border); background: var(--stor-surface); }
    .sq:hover { background: var(--stor-surface-hover); }
    .pill { height: 36px; padding: 0 12px; margin-left: 4px; border-radius: 10px; font-size: 13.5px; font-weight: 600; color: var(--stor-ink); box-shadow: inset 0 0 0 1px var(--stor-border); background: var(--stor-surface); }
    .ttl { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
    .over { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .now { width: 7px; height: 7px; border-radius: 50%; background: var(--stor-now); }
    h1 { font-family: var(--stor-font-serif); font-size: 30px; font-weight: 500; line-height: 1.15; letter-spacing: -.01em; color: var(--stor-ink); }
    .acts { display: flex; gap: 8px; }
    .btn { display: inline-flex; height: 40px; align-items: center; gap: 8px; padding: 0 14px; border-radius: 12px; font-size: 14px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .btn:hover { background: var(--stor-surface-hover); }
    .btn.pri { color: var(--stor-action-text, #fff); background: var(--stor-action); box-shadow: none; }
    .btn.pri:hover { background: var(--stor-action-hover); }
    .kbd { display: inline-grid; min-width: 20px; height: 20px; padding: 0 4px; place-items: center; border-radius: 5px; font-size: 11px; font-weight: 500; color: var(--stor-muted-text); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .kbd.inv { color: inherit; opacity: .75; box-shadow: inset 0 0 0 1px currentColor; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--stor-section-gap); align-items: start; }
    .main, .side { display: flex; min-width: 0; flex-direction: column; gap: var(--stor-section-gap); }
    .diary { padding: 8px 10px 12px; }
    .card { display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; color: inherit; text-decoration: none; }
    .link:hover { box-shadow: var(--stor-elevation-2); }
    .big { font-size: 34px; font-weight: 650; line-height: 1.05; letter-spacing: -.03em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .big small { margin-left: 8px; font-size: 13.5px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .sub { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .spark { height: 44px; margin-top: 4px; }
    .foot { margin-top: 2px; font-size: 12px; color: var(--stor-muted-text); }
    .sbar { display: block; height: 6px; margin-top: 4px; border-radius: 3px; background: var(--stor-surface-muted); overflow: hidden; }
    .sbar i { display: block; height: 100%; border-radius: inherit; background: var(--stor-health-move); }
    .mob { display: inline-flex; width: 100%; height: 48px; align-items: center; justify-content: center; gap: 8px; border-radius: 14px; font-size: 15px; font-weight: 600; color: var(--stor-action-text, #fff); background: var(--stor-action); }
    @media (max-width: 1100px) { .grid { grid-template-columns: minmax(0, 1fr); } .side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 767px) {
        .dh { flex-wrap: wrap; gap: 8px 12px; }
        .ttl { order: -1; flex-basis: 100%; }
        h1 { font-size: 24px; }
        .acts .pri, .kbd { display: none; }
        .acts { margin-left: auto; }
        .side { grid-template-columns: minmax(0, 1fr); }
        .diary { padding: 4px 4px 8px; }
    }
</style>
