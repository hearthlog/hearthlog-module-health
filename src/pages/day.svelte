<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { keepPageData } from "@hearthlog/sdk/runtime";
    import { PageDataStatus } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import HealthDaysShell from "../components/health/HealthDaysShell.svelte";
    import HealthDaysList from "../components/health/HealthDaysList.svelte";
    import HealthDayBlock from "../components/health/HealthDayBlock.svelte";
    import HealthWeekPanel from "../components/health/HealthWeekPanel.svelte";
    import HealthLogMenu from "../components/health/HealthLogMenu.svelte";
    import HealthLogSheet from "../components/health/HealthLogSheet.svelte";
    import HealthDayReadout from "../components/health/HealthDayReadout.svelte";
    import DayRiverCharts from "../components/health/DayRiverCharts.svelte";
    import HealthGlance from "../components/health/HealthGlance.svelte";
    import { BucketStore } from "@hearthlog/sdk/endless";
    import { tenant } from "@hearthlog/sdk/runtime";
    import { appClock } from "@hearthlog/sdk/runtime";
    import { toLocalDateString } from "../calories/logic.js";
    import { healthDayAxis } from "../health/day-list.js";
    import { dayBlocks, loadHealthDayBlock, loadHealthSide, type HealthDayBlock as HealthDay } from "../health/day-blocks.js";
    import { emptyHealthWeek } from "../health/week-data.js";
    import { WeekFollower } from "../health/week-follow.svelte.js";
    import { loadUsualPace, saveUsualPace } from "../health/usual-pace.js";
    import type { EndlessAxis } from "@hearthlog/sdk/endless";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    // The last data stays on screen while the next load runs, so a save never flashes the page.
    const kept = keepPageData(() => resource);
    providePageResource(() => kept.display);
    const data = $derived(kept.data);

    const today = $derived(toLocalDateString(appClock.now()));
    const showWeek = $derived(data.sources.meals || data.sources.activity || data.sources.body);

    // The usual pace is a device preference, off until someone wants the comparison.
    let showUsual = $state(false);
    let days = $state<ReturnType<typeof HealthDaysList>>();
    onMount(() => {
        void loadUsualPace().then((on) => {
            showUsual = on;
            if (on) days?.refresh();
        });
    });
    function toggleUsual(): void {
        showUsual = !showUsual;
        void saveUsualPace(showUsual).catch(() => undefined);
        // Days read without the pace read again with it.
        if (showUsual) days?.refresh();
    }

    // The list keeps its keys while it is open, so its axis is drawn once, from the first load.
    let drawn: EndlessAxis | undefined;
    const axis = $derived(kept.loading ? null : (drawn ??= healthDayAxis(untrack(() => data.today), untrack(() => data.firstLogged))));

    const blocks = new BucketStore<HealthDay>(
        dayBlocks((repositories, date) => loadHealthDayBlock(repositories, data.sources, date, {
            now: appClock.now(),
            today: toLocalDateString(appClock.now()),
            usualPace: showUsual,
        })),
        "Could not read Health days",
    );

    // The day at the top edge; the strip, the week panel, and the log menu follow it.
    let visible = $state(untrack(() => routeData.pageResource.data.selectedDate));
    const side = new WeekFollower((repositories, date) => loadHealthSide(repositories, data.sources, date), "Could not read the Health week");
    let sideRevision = -1;
    $effect(() => {
        const date = visible;
        const revision = kept.revision;
        if (kept.loading) return;
        if (revision !== sideRevision) {
            sideRevision = revision;
            untrack(() => side.refresh(date));
            return;
        }
        // A short pause, so a fast scroll reads the week it stops in, not every week it passes.
        const timer = setTimeout(() => side.follow(date), 120);
        return () => clearTimeout(timer);
    });
    const sideData = $derived(side.get(visible));
    const visibleDay = $derived(blocks.get(visible));

    let weekOpen = $state(false);
    /** How far the days sit past the day in view, so the strip follows a swipe. */
    let shift = $state(0);
</script>

<svelte:head><title>Health day | {tenant.title}</title></svelte:head>

<PageDataStatus {resource} />
<HealthDaysShell
    active="day"
    date={visible}
    {today}
    week={sideData?.week ?? emptyHealthWeek(visible)}
    targets={sideData?.targets ?? { calories: 0, steps: 0 }}
    sources={data.sources}
    onNavigate={(date) => days?.goTo(date, "smooth")}
    {shift}
    bind:weekOpen
    main="1.85fr"
>
    {#snippet action()}<HealthLogMenu date={visible} sources={data.sources} />{/snippet}
    {#snippet list()}
        {#if axis}
            <HealthDaysList
                bind:this={days}
                bind:visible
                bind:shift
                {axis}
                store={blocks}
                {today}
                opening={data.selectedDate}
                revision={kept.revision}
                blocked={weekOpen}
                label="Health days"
            >
                {#snippet block(date, day)}
                    <HealthDayBlock
                        {date}
                        {today}
                        {day}
                        sources={data.sources}
                        mealSlots={data.mealSlots}
                        {showUsual}
                        onToggleUsual={toggleUsual}
                        onWeek={() => (weekOpen = true)}
                    />
                {/snippet}
            </HealthDaysList>
        {:else}
            <DataPlaceholder rows={6} label="Loading days" />
        {/if}
    {/snippet}
    {#snippet aside()}
        {#if showWeek}
            <HealthWeekPanel
                week={sideData?.week ?? emptyHealthWeek(visible)}
                selected={visible}
                {today}
                targets={sideData?.targets ?? { calories: 0, steps: 0 }}
                averages={sideData?.averages ?? { calories: 0, steps: 0 }}
                sources={data.sources}
                body={sideData?.body ?? null}
                loading={sideData === undefined}
            />
        {/if}
    {/snippet}
</HealthDaysShell>
<HealthLogSheet date={visible} {today} sources={data.sources} mealSlots={data.mealSlots} />

<!-- Phones: the day's three figures in the top bar; the readout, the day's charts and the week in its sheet. -->
<HealthGlance date={visible} {today} sources={data.sources} eat={visibleDay?.eat?.calories ?? null} steps={visibleDay?.move?.steps ?? null} weight={visibleDay?.body?.weight ?? null}>
    <div class="flex flex-col gap-[var(--stor-section-gap)]">
        <HealthDayReadout date={visible} {today} sources={data.sources} day={visibleDay} loading={visibleDay === undefined} />
        {#if visibleDay}
            <DayRiverCharts
                rows={visibleDay.timeline}
                nowTime={visible === today ? appClock.now().toTimeString().slice(0, 5) : null}
                targets={visibleDay.targets}
                sources={data.sources}
                usualPace={visibleDay.usualPace}
                {showUsual}
                onToggleUsual={toggleUsual}
            />
        {/if}
        {#if showWeek}
            <HealthWeekPanel
                week={sideData?.week ?? emptyHealthWeek(visible)}
                selected={visible}
                {today}
                targets={sideData?.targets ?? { calories: 0, steps: 0 }}
                averages={sideData?.averages ?? { calories: 0, steps: 0 }}
                sources={data.sources}
                body={sideData?.body ?? null}
                loading={sideData === undefined}
            />
        {/if}
    </div>
</HealthGlance>
