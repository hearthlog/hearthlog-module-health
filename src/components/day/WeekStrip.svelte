<script lang="ts">
    import { goto } from "$app/navigation";
    import { formatNumber } from "@hearthlog/sdk/format";
    import { contextualHref } from "@hearthlog/sdk/runtime";
    import { weekdayShort } from "../../health/day.js";
    import type { WeekStripDay } from "../../health/day-page.js";

    /**
     * The week around the day in view: eaten against budget per day, a thin bar
     * under each. Red only for a day more than 5 % over; the day in view is
     * outlined and days still to come stay quiet.
     */
    let { week, selected, today }: { week: WeekStripDay[]; selected: string; today: string } = $props();
</script>

<nav class="strip" aria-label="Days of the week">
    {#each week as day (day.date)}
        {@const future = day.date > today}
        {@const ratio = day.budget > 0 ? Math.min(1, day.eaten / day.budget) : 0}
        <a
            class="day"
            class:on={day.date === selected}
            class:fut={future}
            class:over={day.status === "over"}
            href={contextualHref(`/health?date=${day.date}`)}
            aria-current={day.date === selected ? "date" : undefined}
            onclick={(event) => {
                // Stepping through the week keeps the page where it is and adds no history.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                void goto(event.currentTarget.href, { replace: true, reset: false });
            }}
        >
            <span class="wd">{weekdayShort(day.date)} <b>{Number(day.date.slice(8))}</b>{#if day.date === today}<i class="now" aria-label="today"></i>{/if}</span>
            <span class="kc">{future || day.eaten === 0 ? "—" : formatNumber(day.eaten)}{#if day.status === "over"}<small> +{formatNumber(day.eaten - day.budget)}</small>{/if}</span>
            <span class="bar"><i style:width="{ratio * 100}%"></i></span>
        </a>
    {/each}
</nav>

<style>
    .strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
    .day {
        display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 8px 10px 9px; border-radius: 12px;
        color: var(--stor-ink); text-decoration: none; transition: background-color .12s;
    }
    .day:hover { background: var(--stor-surface-hover); }
    .day.on { background: var(--stor-surface); box-shadow: inset 0 0 0 1.5px var(--stor-action), var(--stor-elevation-1); }
    .wd { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--stor-muted-text); }
    .wd b { font-weight: 650; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .now { width: 6px; height: 6px; border-radius: 50%; background: var(--stor-now); }
    .kc { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kc small { font-size: 11.5px; font-weight: 600; color: var(--stor-negative); }
    .fut .kc { color: var(--stor-muted-text); font-weight: 500; }
    .bar { display: block; height: 4px; border-radius: 2px; background: var(--stor-surface-muted); overflow: hidden; }
    .bar i { display: block; height: 100%; border-radius: inherit; background: var(--stor-health-eat); }
    .over .bar i { background: var(--stor-negative); }
    @media (max-width: 639px) {
        .strip { gap: 2px; }
        .day { padding: 6px 4px 7px; align-items: center; }
        .kc { font-size: 12px; }
        .kc small { display: none; }
        .bar { align-self: stretch; }
    }
</style>
