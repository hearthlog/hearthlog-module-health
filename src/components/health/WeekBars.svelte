<script lang="ts">
    import { weekdayShort, type HealthTone } from "../../health/day.js";

    /**
     * Seven pill columns on a tinted track with a dotted goal, the chosen day at
     * full strength and days after today left empty. A budget past its goal is
     * hatched amber above the goal; a minimum that is reached earns a check.
     */
    let {
        values,
        dates,
        selected,
        today,
        target,
        tone,
        mode,
        format,
        label,
        width = 300,
        plotHeight = 92,
    }: {
        values: readonly number[];
        dates: readonly string[];
        selected: string;
        today: string;
        /** Zero draws no goal line. */
        target: number;
        tone: HealthTone;
        mode: "budget" | "minimum";
        format: (value: number) => string;
        /** Spoken form, for example "Calories, last seven days". */
        label: string;
        width?: number;
        plotHeight?: number;
    } = $props();

    const uid = $props.id();
    const columnWidth = 14;
    const top = 18;
    const bottomLabel = 18;
    const radius = columnWidth / 2;

    const maximum = $derived(Math.max(target > 0 ? target * 1.14 : 0, ...values, 1) * 1.02);
    const gap = $derived((width - values.length * columnWidth) / (values.length - 1));
    const y = (value: number): number => top + plotHeight - (value / maximum) * plotHeight;
    const baseline = top + plotHeight;
    const total = top + plotHeight + bottomLabel + 4;
</script>

<svg class="week-bars stor-tone-{tone}" viewBox="0 0 {width} {total}" role="img" aria-label={label}>
    <defs>
        <pattern id="{uid}-over" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--stor-warning-soft)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--stor-warning)" stroke-width="2.2" />
        </pattern>
    </defs>
    {#each values as value, index (dates[index])}
        {@const x = index * (columnWidth + gap)}
        {@const date = dates[index]}
        {@const future = date > today}
        {@const isSelected = date === selected}
        {@const over = mode === "budget" && target > 0 && value > target}
        {@const met = mode === "minimum" && target > 0 && value >= target}
        {@const fillTop = over ? y(target) : y(value)}
        <rect class="track" class:future {x} y={top} width={columnWidth} height={plotHeight} rx={radius} />
        {#if value > 0}
            <rect class="fill" class:selected={isSelected} {x} y={fillTop} width={columnWidth} height={baseline - fillTop} rx={radius} />
            {#if over}
                <path d="M{x} {y(target) + radius}V{y(value) + radius}a{radius} {radius} 0 0 1 {columnWidth} 0V{y(target) + radius}z" fill="url(#{uid}-over)" />
            {/if}
        {:else if !future}
            <rect class="stub" x={x + 3} y={baseline - 4} width={columnWidth - 6} height="3" rx="1.5" />
        {/if}
        {#if met}
            <circle class="met" cx={x + columnWidth / 2} cy={y(value) - 9} r="6.5" />
            <path class="met-check" d="M{x + columnWidth / 2 - 3} {y(value) - 9}l2.2 2.3 4-4.4" />
        {:else if isSelected && value > 0}
            <text class="value" x={index === values.length - 1 ? x + columnWidth : x + columnWidth / 2} y={Math.min(y(value), target > 0 ? y(target) : y(value)) - 5} text-anchor={index === values.length - 1 ? "end" : "middle"}>{format(value)}</text>
        {/if}
        <text class="day" class:selected={isSelected} class:future x={x + columnWidth / 2} y={baseline + 16} text-anchor="middle">{weekdayShort(date)}</text>
    {/each}
    {#if target > 0}<line class="goal" x1="0" x2={width} y1={y(target)} y2={y(target)} />{/if}
</svg>
<ul class="sr-only">
    {#each values as value, index (dates[index])}
        <li>{dates[index]}: {format(value)}</li>
    {/each}
</ul>

<style>
    /* Panels that span a tablet would blow the columns up; the chart stops growing at a comfortable width. */
    .week-bars { display: block; width: 100%; max-width: 30rem; height: auto; overflow: visible; }
    .track { fill: color-mix(in srgb, var(--tone) 17%, var(--stor-surface)); }
    .track.future { opacity: .45; }
    .fill { fill: color-mix(in srgb, var(--tone) 58%, var(--stor-surface)); }
    .fill.selected { fill: var(--tone); }
    .stub { fill: var(--stor-border); }
    .goal { stroke: var(--stor-muted-text); stroke-opacity: .55; stroke-width: 1; stroke-dasharray: 2 3; }
    .value { font-size: 11px; font-weight: 650; fill: var(--stor-ink); }
    .day { font-size: 11px; font-weight: 600; fill: var(--stor-muted-text); }
    .day.selected { fill: var(--stor-ink); }
    .day.future { opacity: .55; }
    .met { fill: var(--stor-positive); }
    .met-check { fill: none; stroke: var(--stor-surface); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
</style>
