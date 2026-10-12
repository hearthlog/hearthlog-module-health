<script lang="ts">
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { DataValue } from "@hearthlog/sdk/ui";
    import HealthBudgetBar from "../health/HealthBudgetBar.svelte";
    import { Button } from "@hearthlog/sdk/ui";
    import { formatNumber } from "@hearthlog/sdk/format";

    /**
     * The day's calories as one figure, its meals cut into the budget, and the
     * three macros as meters. Goals are edited here, next to the goal itself.
     */
    let {
        calories,
        target,
        parts,
        macros,
        onEditGoals,
    }: {
        calories: number;
        /** The daily calorie goal; zero when none is set. */
        target: number;
        /** Calories per meal slot, in slot order, from the SQL meal totals. */
        parts: readonly { key: string; label: string; value: number }[];
        macros: readonly { label: string; value: number; target: number }[];
        onEditGoals: () => void;
    } = $props();

    const format = (value: number): string => formatNumber(value, 1);
    const difference = $derived(target > 0 ? target - calories : null);
    const over = $derived(difference !== null && difference < 0);
    const status = $derived(
        difference === null ? "" : over ? `${format(-difference)} kcal over target` : `${format(difference)} kcal to target`,
    );
    const barLabel = $derived(
        ["Meals against the daily budget", ...parts.filter((part) => part.value > 0).map((part) => `${part.label} ${format(part.value)}`)].join(", ")
            + (target > 0 ? `, of ${format(target)} kcal` : ""),
    );
    const share = (value: number, goal: number): number => (goal > 0 ? Math.min(100, (Math.max(0, value) / goal) * 100) : 0);
</script>

<section class="stor-panel hero stor-tone-eat" aria-label="Nutrition summary">
    <div class="top">
        <p class="lab"><i></i>Eat</p>
        <p class="big">
            <DataValue>{format(calories)}</DataValue>
            <small><DataValue>{target > 0 ? `of ${format(target)} kcal` : "kcal"}</DataValue></small>
        </p>
        {#if status}<p class="status" class:over>{status}</p>{/if}
        <div class="act">
            <CommandOnly>
                <Button variant="ghost" size="sm" onclick={onEditGoals}>{target > 0 ? "Edit goals" : "Set a daily target"}</Button>
            </CommandOnly>
        </div>
    </div>

    <HealthBudgetBar {parts} {target} tone="eat" label={barLabel} />

    <div class="macros">
        {#each macros as macro, index (macro.label)}
            <div class="macro">
                <span class="ml">{macro.label}</span>
                <span class="mv"><DataValue>{format(macro.value)}</DataValue><small><DataValue>{macro.target > 0 ? ` / ${format(macro.target)} g` : " g"}</DataValue></small></span>
                <i class="track" role="img" aria-label="{macro.label} against its goal"><b class="m{index}" style:width="{share(macro.value, macro.target)}%"></b></i>
            </div>
        {/each}
    </div>
</section>

<style>
    .hero { display: flex; flex-direction: column; gap: 14px; padding: 18px 18px 20px; }
    @media (min-width: 640px) { .hero { gap: 18px; padding: 22px 24px 24px; } }
    .top {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 8px;
        grid-template-areas: "lab act" "big big" "status status";
    }
    @media (min-width: 640px) {
        .top { grid-template-columns: minmax(0, 1fr) auto auto; align-items: end; gap: 6px 12px; grid-template-areas: "lab lab lab" "big status act"; }
    }
    .lab { grid-area: lab; display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .lab i { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); }
    .big { grid-area: big; font-size: 34px; font-weight: 650; line-height: 1.05; letter-spacing: -.035em; white-space: nowrap; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    @media (min-width: 640px) { .big { font-size: 40px; } }
    .big small { margin-left: 10px; font-size: 14px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .status { grid-area: status; font-size: 14px; font-weight: 650; color: var(--stor-ink); }
    .status.over { color: var(--stor-warning); }
    .act { grid-area: act; justify-self: end; }
    @media (min-width: 640px) { .status { padding-bottom: 6px; } .act { margin-bottom: -2px; } }

    .macros {
        display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; padding-top: 16px;
        border-top: 1px solid color-mix(in srgb, var(--stor-border) 70%, transparent);
    }
    .macro { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
    .ml { font-size: 12px; font-weight: 600; color: var(--stor-muted-text); }
    .mv { font-size: 17px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .mv small { font-size: 11px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .track { display: block; height: 5px; margin-top: 3px; overflow: hidden; border-radius: 3px; background: color-mix(in srgb, var(--tone) 14%, var(--stor-surface)); }
    .track b { display: block; height: 100%; border-radius: 3px; background: var(--tone); transition: width 500ms ease; }
    .track b.m1 { opacity: .72; }
    .track b.m2 { opacity: .5; }
    @media (prefers-reduced-motion: reduce) { .track b { transition: none; } }
</style>
