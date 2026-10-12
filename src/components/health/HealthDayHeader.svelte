<script lang="ts">
    import type { Snippet } from "svelte";
    import { shiftDay } from "@hearthlog/sdk/endless";
    import { dateTitleParts, dayRatio, type HealthWeekDay } from "../../health/day.js";
    import IconChevronLeft from "~icons/mdi/chevron-left";
    import IconChevronRight from "~icons/mdi/chevron-right";

    /**
     * The week around the day in view: seven days, Monday first, each with a pip
     * for Eat, Move and Weigh so a week reads at a glance. Days after today are
     * dimmed but reachable. Choosing a day scrolls the list to it, and the pill
     * slides with the list while it moves between days.
     */
    let {
        date,
        today,
        week,
        targets,
        sources,
        onNavigate,
        shift = 0,
        action,
    }: {
        date: string;
        today: string;
        /** The seven days of the strip, Monday first. */
        week: readonly HealthWeekDay[];
        targets: { calories: number; steps: number };
        sources: { meals: boolean; activity: boolean; body: boolean };
        onNavigate: (date: string) => void | Promise<void>;
        /** How far the list sits past the day in view, in days, from -0.5 to 0.5. */
        shift?: number;
        /** The page's primary action, shown beside the strip from `lg`; phones use the floating pill. */
        action?: Snippet;
    } = $props();

    const days = $derived(week.map((day) => ({
        ...day,
        parts: dateTitleParts(day.date),
        future: day.date > today,
        eat: sources.meals ? dayRatio(day.calories, targets.calories) : null,
        move: sources.activity ? dayRatio(day.steps, targets.steps) : null,
        body: sources.body ? day.weighed : null,
    })));
    const selected = $derived(days.findIndex((day) => day.date === date));

    // Phones swipe the strip sideways by a week instead of using the arrows.
    let swipeStart: { x: number; y: number } | null = null;
    let swiped = false;
    function stripDown(event: PointerEvent): void {
        swipeStart = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY };
        swiped = false;
    }
    function stripUp(event: PointerEvent): void {
        if (!swipeStart) return;
        const dx = event.clientX - swipeStart.x;
        const dy = event.clientY - swipeStart.y;
        swipeStart = null;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        swiped = true;
        void onNavigate(shiftDay(date, dx < 0 ? 7 : -7));
    }
    function stripClick(event: MouseEvent): void {
        if (!swiped) return;
        swiped = false;
        event.preventDefault();
        event.stopPropagation();
    }
</script>

<div class="day-header">
    <div class="strip" role="group" aria-label="Week" onpointerdown={stripDown} onpointerup={stripUp} onpointercancel={() => (swipeStart = null)} onclickcapture={stripClick}>
        <button type="button" class="week-arrow" style:grid-column="1" aria-label="Previous week" onclick={() => onNavigate(shiftDay(date, -7))}>
            <IconChevronLeft class="h-[18px] w-[18px]" />
        </button>
        {#if selected >= 0}
            <span class="pill" aria-hidden="true" style:grid-column={selected + 2} style:--shift={shift}></span>
        {/if}
        {#each days as day, index (day.date)}
            <button
                type="button"
                class="day"
                style:grid-column={index + 2}
                class:on={day.date === date}
                class:today={day.date === today}
                class:future={day.future}
                aria-current={day.date === date ? "date" : undefined}
                aria-label="{day.parts.weekday}, {day.parts.rest}{day.date === today ? ', today' : ''}"
                onclick={() => onNavigate(day.date)}
            >
                <span class="wd">
                    {#if day.date === today}Today{:else}<span class="max-sm:hidden">{day.parts.weekday.slice(0, 3)}</span><span class="sm:hidden">{day.parts.weekday.slice(0, 2)}</span>{/if}
                </span>
                <span class="dn">{Number(day.date.slice(8, 10))}</span>
                <span class="pips" aria-hidden="true">
                    {#if !day.future}
                        {#if day.eat !== null}<i class="pip stor-tone-eat"><b class:over={day.eat > 1} style:width="{Math.min(1, day.eat) * 100}%"></b></i>{/if}
                        {#if day.move !== null}<i class="pip stor-tone-move"><b style:width="{Math.min(1, day.move) * 100}%"></b></i>{/if}
                        {#if day.body !== null}<i class="pip stor-tone-body"><b style:width={day.body ? "100%" : "0"}></b></i>{/if}
                    {/if}
                </span>
            </button>
        {/each}
        <button type="button" class="week-arrow" style:grid-column="9" aria-label="Next week" onclick={() => onNavigate(shiftDay(date, 7))}>
            <IconChevronRight class="h-[18px] w-[18px]" />
        </button>
    </div>
    {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
    .day-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .action { display: none; flex-shrink: 0; }
    @media (min-width: 1024px) { .action { display: block; } }

    .strip {
        --gap: 2px;
        display: grid; min-width: 0; flex: 1 1 auto; grid-template-columns: 24px repeat(7, minmax(0, 1fr)) 24px; align-items: center; gap: var(--gap);
    }
    @media (min-width: 640px) {
        .strip { --gap: 6px; flex: 0 1 auto; grid-template-columns: 32px repeat(7, 5rem) 32px; justify-content: start; }
    }
    /* Phones swipe the strip by a week; the arrows step aside. */
    @media (max-width: 767px) {
        .strip { grid-template-columns: 0 repeat(7, minmax(0, 1fr)) 0; touch-action: pan-y; }
        .week-arrow { display: none !important; }
    }
    .week-arrow { grid-row: 1; display: grid; place-items: center; height: 44px; border-radius: 10px; color: var(--stor-muted-text); }
    .week-arrow:hover { color: var(--stor-ink); background: var(--stor-surface-hover); }
    .week-arrow:focus-visible, .day:focus-visible { outline: 2px solid var(--stor-focus); outline-offset: 2px; }
    .day {
        position: relative; z-index: 1; grid-row: 1; display: flex; min-height: 44px; flex-direction: column; align-items: center; gap: 1px;
        padding: 8px 0 9px; border-radius: 14px; color: var(--stor-muted-text);
    }
    @media (min-width: 640px) { .day { padding: 10px 0 11px; border-radius: 16px; } }
    .day:hover:not(.on) { background: var(--stor-surface-hover); }
    /* The selected day's pill sits under the buttons and slides by the share of a day the list has moved. */
    .pill {
        grid-row: 1; align-self: stretch; border-radius: 14px; pointer-events: none;
        background: var(--stor-surface-raised); box-shadow: var(--stor-shadow-sm);
        transform: translateX(calc(var(--shift, 0) * (100% + var(--gap))));
    }
    @media (min-width: 640px) { .pill { border-radius: 16px; } }
    .day.future:not(.on) { opacity: .5; }
    .wd { font-size: 11px; font-weight: 600; letter-spacing: .03em; }
    .day.on .wd, .day.today .wd { color: var(--stor-accent-text); }
    .dn { font-size: 17px; font-weight: 600; line-height: 1.2; letter-spacing: -.02em; color: var(--stor-ink); }
    @media (min-width: 640px) { .dn { font-size: 19px; } }
    .pips { display: flex; flex-direction: column; gap: 3px; width: 24px; min-height: 16px; margin-top: 5px; }
    @media (min-width: 640px) { .pips { width: 30px; } }
    .pip { display: block; height: 4px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--tone) 20%, var(--stor-surface)); }
    .pip b { display: block; height: 100%; border-radius: 2px; background: var(--tone); transition: width 200ms ease; }
    /* Past the calorie goal the pip ends in amber stripes: colour is never the only signal. */
    .pip b.over { background: repeating-linear-gradient(135deg, var(--tone) 0 3px, var(--stor-warning) 3px 5px); }
</style>
