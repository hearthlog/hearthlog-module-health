<script lang="ts">
    import { formatNumber } from "@hearthlog/sdk/format";
    import { contextualHref } from "@hearthlog/sdk/runtime";
    import { budgetBar, dayStatus } from "../../health/budget.js";
    import type { DayView } from "../../health/day-page.js";
    import { weekdayLong } from "../../health/format.js";

    /**
     * One line answers "how much is left", with the sum behind it written out.
     * The usual next meal waits dashed on the bar; the steps' share sits last.
     */
    let { view, today }: { view: DayView; today: string } = $props();

    const budget = $derived(view.budget);
    const next = $derived(view.next);
    const nextLabel = $derived(next ? view.meals.find((meal) => meal.slot.id === next.slotId)?.slot.label.toLowerCase() ?? "meal" : "");
    const bar = $derived(budgetBar(view.meals.map((meal) => ({ key: meal.slot.id, label: meal.slot.label, calories: meal.calories })), view.date >= today ? next?.calories ?? 0 : 0, budget));
    const status = $derived(dayStatus(budget.eaten, budget.budget));
    const over = $derived(budget.budget > 0 && budget.left < 0);
    // Meals step down in shade along the bar, so neighbours stay apart without a legend.
    const shades = [100, 78, 60, 46, 36];
    const parts = $derived.by(() => {
        let eaten = 0;
        return bar.parts.filter((part) => part.kind !== "over").map((part) => ({ ...part, mix: part.kind === "eaten" ? shades[Math.min(eaten++, shades.length - 1)] : 0 }));
    });

    const macros = $derived([
        { key: "protein", label: "Protein", value: view.totals.proteinG, target: view.targets.proteinG, minimum: true },
        { key: "carbs", label: "Carbs", value: view.totals.carbsG, target: view.targets.carbsG, minimum: false },
        { key: "fat", label: "Fat", value: view.totals.fatG, target: view.targets.fatG, minimum: false },
    ]);
    const protein = $derived(macros[0]);
    const proteinShort = $derived(protein.target > 0 && protein.value < protein.target ? Math.round(protein.target - protein.value) : 0);
</script>

<section class="stor-panel card" aria-labelledby="budget-title">
    <div class="main">
        {#if budget.budget > 0}
            <p class="over-line" id="budget-title">{view.date === today ? "Left today" : view.date > today ? "Budget" : over ? "Over" : "Left"}</p>
            <p class="big" class:neg={status === "over"}>{formatNumber(Math.abs(budget.left))}<small>kcal{over ? " over" : ""}</small></p>
            <p class="sum">
                Goal {formatNumber(budget.goal)}
                {#if budget.steps > 0}<span class="op">+</span> steps {formatNumber(budget.steps)}{/if}
                <span class="op">−</span> eaten {formatNumber(budget.eaten)}
                <span class="op">=</span> <b>{formatNumber(budget.left)}</b>
            </p>
            <div class="bar" role="img" aria-label="{formatNumber(budget.eaten)} of {formatNumber(budget.budget)} kcal eaten">
                {#each parts as part (part.key)}
                    <i class={part.kind} style:flex="{part.value} 0 0" style:--mix="{part.mix}%" title="{part.label} · {formatNumber(part.value)}"></i>
                {/each}
                {#if over}<i class="excess" style:flex="{budget.eaten - budget.budget} 0 0"></i>{/if}
            </div>
            <div class="scale" aria-hidden="true">
                <span>0</span>
                <span class="mid">Goal {formatNumber(budget.goal)}{#if budget.steps > 0} · steps +{formatNumber(budget.steps)}{/if}</span>
                <span>{formatNumber(budget.budget)}</span>
            </div>
            {#if next && view.date >= today && !over}
                <p class="fore">
                    <i class="dash" aria-hidden="true"></i>
                    {formatNumber(Math.max(0, budget.left - next.calories))} kcal left after {nextLabel} like {weekdayLong(next.from, view.date)}
                    <span class="mt">· {formatNumber(next.calories)} kcal</span>
                </p>
            {:else if status === "over"}
                <p class="fore mt">Tomorrow starts at {formatNumber(budget.goal)} plus steps, as usual.</p>
            {/if}
        {:else}
            <p class="over-line" id="budget-title">Eaten</p>
            <p class="big">{formatNumber(budget.eaten)}<small>kcal</small></p>
            <p class="sum">Set a goal and Health shows what is left, steps included. <a href={contextualHref("/bmi/goal")}>Set a goal</a></p>
        {/if}
    </div>

    <div class="macros">
        <p class="over-line">Macros</p>
        {#each macros as macro (macro.key)}
            {@const met = macro.target > 0 && macro.minimum && macro.value >= macro.target}
            <div class="mac">
                <b>{macro.label}</b>
                <span class="mbar" class:done={met}><i style:width="{macro.target > 0 ? Math.min(100, (macro.value / macro.target) * 100) : 0}%"></i></span>
                <span class="v" class:pos={met}>{formatNumber(Math.round(macro.value))}{#if macro.target > 0}<small> / {formatNumber(macro.target)} g</small>{:else}<small> g</small>{/if}</span>
            </div>
        {/each}
        {#if proteinShort > 0 && view.date >= today}
            <p class="note">Protein is {formatNumber(proteinShort)} g short{#if next && next.proteinG > 0}; {nextLabel} like last time brings {formatNumber(Math.round(next.proteinG))} g{/if}.</p>
        {/if}
    </div>
</section>

<style>
    .card { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 28px; padding: 22px 24px 20px; }
    @media (max-width: 1023px) { .card { grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 18px; } }
    .main { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
    .over-line { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .big { font-size: 44px; font-weight: 650; line-height: 1; letter-spacing: -.035em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .big small { margin-left: 8px; font-size: 15px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .big.neg { color: var(--stor-negative); }
    .sum { font-size: 13.5px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .sum b { font-weight: 650; color: var(--stor-ink); }
    .sum a { margin-left: 4px; font-weight: 600; color: var(--stor-accent-text); }
    .op { margin: 0 3px; color: var(--stor-muted-text); }
    .bar { display: flex; height: 14px; gap: 2px; margin-top: 6px; }
    .bar i { display: block; min-width: 3px; border-radius: 4px; }
    .bar .eaten { background: color-mix(in srgb, var(--stor-health-eat) var(--mix), var(--stor-surface)); }
    .bar .next { background: color-mix(in srgb, var(--stor-health-eat) 10%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--stor-health-eat) 55%, transparent); background-image: repeating-linear-gradient(-45deg, transparent 0 4px, color-mix(in srgb, var(--stor-health-eat) 18%, transparent) 4px 5px); }
    .bar .rest { background: var(--stor-surface-muted); }
    .bar .steps { background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--stor-health-move) 22%, var(--stor-surface-muted)) 0 4px, var(--stor-surface-muted) 4px 7px); }
    .bar .excess { background: var(--stor-negative); }
    .scale { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .scale .mid { margin-left: auto; margin-right: 4px; }
    .fore { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; font-size: 13.5px; color: var(--stor-ink); }
    .fore .mt, .mt { color: var(--stor-muted-text); }
    .dash { width: 18px; height: 8px; border-radius: 2px; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--stor-health-eat) 55%, transparent); }
    .macros { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
    @media (min-width: 1024px) { .macros { padding-left: 24px; border-left: 1px solid color-mix(in srgb, var(--stor-border) 60%, transparent); } }
    .mac { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 13px; }
    .mac b { font-weight: 600; color: var(--stor-ink); }
    .mbar { display: block; height: 6px; border-radius: 3px; background: var(--stor-surface-muted); overflow: hidden; }
    .mbar i { display: block; height: 100%; border-radius: inherit; background: var(--stor-ink); opacity: .72; }
    .mbar.done i { background: var(--stor-positive); opacity: 1; }
    .v { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--stor-ink); text-align: right; min-width: 84px; }
    .v small { font-weight: 500; color: var(--stor-muted-text); }
    .v.pos { color: var(--stor-positive); }
    .note { font-size: 12.5px; line-height: 1.45; color: var(--stor-muted-text); }
</style>
