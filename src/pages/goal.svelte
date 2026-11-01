<script lang="ts">
    import { untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { executeLocalCommand, queryDatabase } from "@hearthlog/sdk/data";
    import type { AddNutritionGoalEvent, UpdateNutritionGoalEvent } from "@hearthlog/sdk/data";
    import { contextualHref, notify, providePageResource, refreshPageData, tenant } from "@hearthlog/sdk/runtime";
    import { DataPlaceholder, PageDataStatus } from "@hearthlog/sdk/ui";
    import { formatFixed, formatNumber } from "@hearthlog/sdk/format";
    import IconMinus from "~icons/mdi/minus";
    import IconPlus from "~icons/mdi/plus";
    import HealthPageHeader from "../components/health/HealthPageHeader.svelte";
    import { calculateCalorieGoal, CALORIE_CALCULATION_METHOD, type CalorieActivityLevel, type CalorieCalculationSex } from "../calories/goal-calculator.js";
    import { shiftLocalDate } from "../calories/logic.js";
    import { arrivalDate, DAILY_LIFE, lowBudgetFloor, macroTargets, PACES, type PaceId } from "../health/budget.js";
    import { daysBetween, shortDate } from "../health/format.js";
    import type { GoalPageData } from "./goal.js";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    const data = $derived(resource.data as GoalPageData);
    providePageResource(() => resource);

    let weight = $state<number | null>(null);
    let heightCm = $state<number | null>(null);
    let age = $state<number | null>(null);
    let sex = $state<CalorieCalculationSex>("male");
    let level = $state<CalorieActivityLevel>("inactive");
    let goalKg = $state<number | null>(null);
    let pace = $state<PaceId>("steady");
    let saving = $state(false);

    // The form starts from the goal in force and today's trend, once the page has read them.
    let seeded = false;
    $effect(() => {
        if (resource.loading || seeded) return;
        seeded = true;
        untrack(() => {
            const goal = data.goal;
            weight = data.trendKg !== null ? Number(data.trendKg.toFixed(1)) : Number(goal?.calculation_current_weight_kg) || null;
            heightCm = data.heightCm ?? (Number(goal?.calculation_height_cm) || null);
            age = Number(goal?.calculation_age_years) || null;
            if (goal?.calculation_sex === "female" || goal?.calculation_sex === "male") sex = goal.calculation_sex;
            if (DAILY_LIFE.some((option) => option.level === goal?.calculation_activity_level)) level = goal!.calculation_activity_level as CalorieActivityLevel;
            goalKg = Number(goal?.calculation_target_weight_kg) || (weight ? Math.round(weight - 5) : null);
        });
    });

    /** A new goal starts tomorrow, so today keeps the budget it was eaten against; the first goal starts today. */
    const effectiveFrom = $derived(data.goal ? shiftLocalDate(data.today, 1) : data.today);
    const ready = $derived(weight !== null && weight > 0 && heightCm !== null && heightCm > 0 && age !== null && Number.isInteger(age) && age >= 18 && age <= 120 && goalKg !== null && goalKg > 0);
    const direction = $derived(weight !== null && goalKg !== null ? Math.sign(goalKg - weight) : 0);

    const options = $derived(PACES.map((option) => {
        if (!ready || weight === null || goalKg === null || heightCm === null || age === null) return { ...option, date: null, budget: null, maintenance: null };
        if (direction === 0) {
            const result = calculateCalorieGoal({ effectiveFrom, targetDate: shiftLocalDate(effectiveFrom, 28), currentWeightKg: weight, targetWeightKg: weight, heightCm, ageYears: age, sex, activityLevel: level });
            return { ...option, date: effectiveFrom, budget: Math.round(result.currentMaintenanceCalories / 10) * 10, maintenance: result.currentMaintenanceCalories };
        }
        const date = arrivalDate(effectiveFrom, weight, goalKg, direction * option.kgPerWeek);
        if (!date) return { ...option, date: null, budget: null, maintenance: null };
        try {
            const result = calculateCalorieGoal({ effectiveFrom, targetDate: date, currentWeightKg: weight, targetWeightKg: goalKg, heightCm, ageYears: age, sex, activityLevel: level });
            return { ...option, date, budget: result.reachGoalCalories !== null ? Math.round(result.reachGoalCalories / 10) * 10 : null, maintenance: result.currentMaintenanceCalories };
        } catch {
            return { ...option, date, budget: null, maintenance: null };
        }
    }));
    const chosen = $derived(options.find((option) => option.id === pace) ?? options[1]);
    const macros = $derived(chosen.budget && goalKg ? macroTargets(chosen.budget, goalKg) : null);
    const low = $derived(chosen.budget !== null && chosen.budget < lowBudgetFloor(sex));
    const goalBmi = $derived(goalKg && heightCm ? goalKg / (heightCm / 100) ** 2 : null);

    function nudgeGoal(step: number): void {
        goalKg = Math.max(30, Number(((goalKg ?? weight ?? 70) + step).toFixed(1)));
    }

    // The projection: each pace as a straight line from today's weight to the goal.
    const chart = $derived.by(() => {
        if (!ready || weight === null || goalKg === null || direction === 0) return null;
        const dates = options.map((option) => option.date).filter((date): date is string => date !== null);
        if (dates.length === 0) return null;
        const days = Math.max(...dates.map((date) => daysBetween(effectiveFrom, date)));
        const lo = Math.min(weight, goalKg) - 1;
        const hi = Math.max(weight, goalKg) + 1;
        const x = (date: string) => 40 + (daysBetween(effectiveFrom, date) / days) * 420;
        const y = (kg: number) => 16 + (1 - (kg - lo) / (hi - lo)) * 128;
        return {
            goalY: y(goalKg),
            startY: y(weight),
            lines: options.filter((option) => option.date).map((option) => ({ id: option.id, x2: x(option.date!), label: shortDate(option.date!, data.today) })),
            endLabel: shortDate(shiftLocalDate(effectiveFrom, days), data.today),
        };
    });

    async function save(): Promise<void> {
        if (!ready || saving || chosen.budget === null || !macros || weight === null || goalKg === null || heightCm === null || age === null) return;
        saving = true;
        const payload = {
            effectiveFrom,
            caloriesTarget: chosen.budget,
            proteinTargetG: macros.proteinG,
            carbsTargetG: macros.carbsG,
            fatTargetG: macros.fatG,
            calorieTargetSource: "calculator",
            calculationMethod: CALORIE_CALCULATION_METHOD,
            calculationResult: "reach_goal",
            calculatedCalories: chosen.budget,
            calculationCurrentWeightKg: weight,
            calculationTargetWeightKg: goalKg,
            calculationHeightCm: heightCm,
            calculationAgeYears: age,
            calculationSex: sex,
            calculationActivityLevel: level,
            calculationTargetDate: chosen.date ?? "",
        };
        try {
            const same = await queryDatabase((repositories) => repositories.calories.getNutritionGoalForDate(effectiveFrom));
            if (same) {
                const event: UpdateNutritionGoalEvent = { id: crypto.randomUUID(), type: "NUTRITION_GOAL_UPDATED", timestamp: Date.now(), payload: { id: same.id, ...payload } };
                await executeLocalCommand(event);
            } else {
                const event: AddNutritionGoalEvent = { id: crypto.randomUUID(), type: "NUTRITION_GOAL_ADDED", timestamp: Date.now(), payload: { id: crypto.randomUUID(), ...payload } };
                await executeLocalCommand(event);
            }
            await refreshPageData("app:calories");
            notify.success(`Goal saved: ${formatNumber(chosen.budget)} kcal plus steps from ${effectiveFrom === data.today ? "today" : "tomorrow"}`);
            void goto(contextualHref("/bmi"));
        } catch (error) {
            console.error("Failed to save goal:", error);
            notify.error("The goal could not be saved. Your choices are still here.");
        } finally {
            saving = false;
        }
    }
</script>

<svelte:head><title>Goal and pace | {tenant.title}</title></svelte:head>

<PageDataStatus {resource} />

<div class="stor-refined w-full overflow-x-hidden">
    <HealthPageHeader active="body" />
    <div class="stor-page p-2.5 sm:p-3">
        <div class="goal">
            <header class="gh">
                <p class="over">Body</p>
                <h1>Goal and pace</h1>
            </header>

            {#if resource.loading}
                <DataPlaceholder rows={8} label="Loading the goal" />
            {:else}
                <div class="grid">
                    <div class="col">
                        <section class="stor-panel card" aria-labelledby="you-title">
                            <h2 id="you-title" class="h">You, today</h2>
                            <div class="fields">
                                <label><span>Weight</span><span class="in"><input type="number" inputmode="decimal" step="0.1" min="30" bind:value={weight} /><small>kg</small></span>{#if data.trendKg !== null}<em>trend</em>{/if}</label>
                                <label><span>Height</span><span class="in"><input type="number" inputmode="numeric" step="1" min="100" bind:value={heightCm} /><small>cm</small></span></label>
                                <label><span>Age</span><span class="in"><input type="number" inputmode="numeric" step="1" min="18" max="120" bind:value={age} placeholder="—" /><small>years</small></span></label>
                                <div class="lab"><span>Sex</span>
                                    <div class="seg" role="radiogroup" aria-label="Sex used by the equation">
                                        <button type="button" role="radio" aria-checked={sex === "female"} class:on={sex === "female"} onclick={() => (sex = "female")}>Female</button>
                                        <button type="button" role="radio" aria-checked={sex === "male"} class:on={sex === "male"} onclick={() => (sex = "male")}>Male</button>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section class="stor-panel card" aria-labelledby="life-title">
                            <h2 id="life-title" class="h">Daily life, before steps</h2>
                            <div class="opts" role="radiogroup" aria-labelledby="life-title">
                                {#each DAILY_LIFE as option (option.level)}
                                    <button type="button" role="radio" aria-checked={level === option.level} class="opt" class:on={level === option.level} onclick={() => (level = option.level)}>
                                        <b>{option.label}</b><span>{option.detail}</span>
                                    </button>
                                {/each}
                            </div>
                            <p class="s">Synced steps are added to each day's budget on top of this, so leave walks out.</p>
                        </section>

                        <section class="stor-panel card" aria-labelledby="target-title">
                            <h2 id="target-title" class="h">Goal weight</h2>
                            <div class="stepper">
                                <button type="button" aria-label="0.5 kg less" onclick={() => nudgeGoal(-0.5)}><IconMinus class="h-5 w-5" /></button>
                                <label><span class="sr-only">Goal weight in kilograms</span><input type="number" inputmode="decimal" step="0.5" min="30" bind:value={goalKg} /></label>
                                <span class="u">kg</span>
                                <button type="button" aria-label="0.5 kg more" onclick={() => nudgeGoal(0.5)}><IconPlus class="h-5 w-5" /></button>
                            </div>
                            <p class="s">
                                {#if weight !== null && goalKg !== null}{direction === 0 ? "Keep your weight" : `${formatFixed(Math.abs(goalKg - weight), 1)} kg to ${direction < 0 ? "lose" : "gain"}`}{/if}
                                {#if goalBmi !== null} · BMI {formatFixed(goalBmi, 1)} at goal{/if}
                            </p>
                        </section>
                    </div>

                    <div class="col">
                        {#if direction !== 0}
                            <div class="paces" role="radiogroup" aria-label="Pace">
                                {#each options as option (option.id)}
                                    <button type="button" role="radio" aria-checked={pace === option.id} class="stor-panel pace" class:on={pace === option.id} onclick={() => (pace = option.id)} disabled={option.budget === null}>
                                        <span class="pn">{option.label}</span>
                                        <span class="pk">{formatFixed(option.kgPerWeek, 2)} kg / week</span>
                                        <span class="pb">{option.budget !== null ? formatNumber(option.budget) : "—"}<small>kcal</small></span>
                                        <span class="pd">{option.date ? `goal ~${shortDate(option.date, data.today)}` : "not reachable"}</span>
                                    </button>
                                {/each}
                            </div>
                        {/if}

                        {#if chart}
                            <section class="stor-panel card" aria-label="Projection">
                                <svg viewBox="0 0 480 170" class="proj" role="img" aria-label="Projected weight at each pace">
                                    <line class="gl" x1="40" x2="470" y1={chart.goalY} y2={chart.goalY} />
                                    <text class="ax" x="44" y={chart.goalY - 6}>Goal {formatFixed(goalKg ?? 0, 1)} kg</text>
                                    {#each chart.lines as line (line.id)}
                                        <line class:sel={line.id === pace} class="pl" x1="40" y1={chart.startY} x2={line.x2} y2={chart.goalY} />
                                        {#if line.id === pace}<circle class="end" cx={line.x2} cy={chart.goalY} r="4" /><text class="ax b" x={line.x2} y={chart.goalY + 18} text-anchor="middle">{line.label}</text>{/if}
                                    {/each}
                                    <circle class="start" cx="40" cy={chart.startY} r="4" />
                                    <text class="ax" x="40" y="164">{effectiveFrom === data.today ? "Today" : "Tomorrow"}</text>
                                </svg>
                            </section>
                        {/if}

                        <section class="stor-panel card sum" aria-labelledby="budget-title">
                            <h2 id="budget-title" class="h">Daily budget</h2>
                            <p class="big">{chosen.budget !== null ? formatNumber(chosen.budget) : "—"}<small>kcal + steps</small></p>
                            {#if chosen.budget !== null && chosen.maintenance !== null}
                                <dl class="facts">
                                    {#if chosen.date && direction !== 0}<div><dt>Arrives</dt><dd>~{shortDate(chosen.date, data.today)}</dd></div>
                                    <div><dt>Takes</dt><dd>{formatNumber(Math.round(daysBetween(effectiveFrom, chosen.date) / 7))} weeks</dd></div>{/if}
                                    <div><dt>{chosen.budget <= chosen.maintenance ? "Below" : "Above"} maintenance</dt><dd>{formatNumber(Math.abs(chosen.maintenance - chosen.budget))} kcal</dd></div>
                                </dl>
                            {:else if !ready}
                                <p class="s">Fill in weight, height, age and a goal weight.</p>
                            {/if}
                            {#if low}
                                <p class="warn">{formatNumber(chosen.budget ?? 0)} kcal is under {formatNumber(lowBudgetFloor(sex))}. A gentler pace is easier to keep and keeps enough protein in.</p>
                            {/if}
                            {#if macros}
                                <div class="split" aria-hidden="true">
                                    <i style:flex="{macros.proteinG * 4} 0 0" class="p"></i><i style:flex="{macros.carbsG * 4} 0 0" class="c"></i><i style:flex="{macros.fatG * 9} 0 0" class="f"></i>
                                </div>
                                <dl class="facts">
                                    <div><dt>Protein</dt><dd>{formatNumber(macros.proteinG)} g</dd></div>
                                    <div><dt>Carbs</dt><dd>{formatNumber(macros.carbsG)} g</dd></div>
                                    <div><dt>Fat</dt><dd>{formatNumber(macros.fatG)} g</dd></div>
                                </dl>
                                <p class="s">Protein at 1.6 g per kg of goal weight, fat at 30 % of energy, carbs the rest.</p>
                            {/if}
                        </section>
                    </div>
                </div>

                <footer class="foot">
                    <p class="s">{effectiveFrom === data.today ? "The goal starts today." : "Changes start tomorrow; today keeps the budget it was eaten against."}</p>
                    <a class="btn" href={contextualHref("/bmi")}>Cancel</a>
                    <button type="button" class="btn pri" disabled={!ready || chosen.budget === null || saving} onclick={() => void save()}>{saving ? "Saving…" : "Save goal"}</button>
                </footer>
            {/if}
        </div>
    </div>
</div>

<style>
    .goal { display: flex; flex-direction: column; gap: var(--stor-section-gap); padding-bottom: 24px; }
    .gh { display: flex; flex-direction: column; gap: 2px; }
    .over { font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    h1 { font-family: var(--stor-font-serif); font-size: 30px; font-weight: 500; line-height: 1.15; color: var(--stor-ink); }
    .h { font-size: 15px; font-weight: 650; color: var(--stor-ink); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: var(--stor-section-gap); align-items: start; }
    .col { display: flex; min-width: 0; flex-direction: column; gap: var(--stor-section-gap); }
    .card { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
    .fields label, .lab { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--stor-muted-text); }
    .fields em { font-style: normal; font-weight: 500; }
    .in { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border-radius: 10px; background: var(--stor-surface-muted); }
    .in input { min-width: 0; flex: 1; border: 0; background: transparent; font-size: 16px; font-weight: 600; color: var(--stor-ink); font-variant-numeric: tabular-nums; outline: none; }
    .in:focus-within { box-shadow: inset 0 0 0 1px var(--stor-action), 0 0 0 3px var(--stor-selected); }
    .in small { font-size: 12px; font-weight: 500; }
    .seg { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--stor-surface-muted); }
    .seg button { flex: 1; height: 34px; border-radius: 8px; font-size: 13.5px; font-weight: 600; color: var(--stor-muted-text); }
    .seg button.on { background: var(--stor-surface); color: var(--stor-ink); box-shadow: var(--stor-elevation-1); }
    .opts { display: flex; flex-direction: column; gap: 6px; }
    .opt { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 12px; text-align: left; box-shadow: inset 0 0 0 1px var(--stor-border); }
    .opt b { font-size: 14px; font-weight: 600; color: var(--stor-ink); }
    .opt span { font-size: 12.5px; color: var(--stor-muted-text); }
    .opt.on { box-shadow: inset 0 0 0 1.5px var(--stor-action); background: var(--stor-surface); }
    .s { font-size: 12.5px; line-height: 1.45; color: var(--stor-muted-text); }
    .stepper { display: flex; align-items: center; gap: 10px; }
    .stepper button { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 12px; color: var(--stor-ink); background: var(--stor-surface-muted); }
    .stepper label { min-width: 0; flex: 1; }
    .stepper input { width: 100%; height: 44px; border: 0; border-bottom: 2px solid var(--stor-health-body); background: transparent; text-align: center; font-size: 28px; font-weight: 650; color: var(--stor-ink); font-variant-numeric: tabular-nums; outline: none; }
    .u { font-size: 13px; color: var(--stor-muted-text); }
    .paces { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .pace { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; text-align: left; }
    .pace.on { box-shadow: inset 0 0 0 1.5px var(--stor-action), var(--stor-elevation-1); }
    .pace:disabled { opacity: .5; }
    .pn { font-size: 14px; font-weight: 650; color: var(--stor-ink); }
    .pk { font-size: 12px; color: var(--stor-muted-text); }
    .pb { margin-top: 8px; font-size: 24px; font-weight: 650; letter-spacing: -.02em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .pb small { margin-left: 4px; font-size: 12px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .pd { font-size: 12.5px; color: var(--stor-muted-text); }
    .proj { width: 100%; height: auto; }
    .gl { stroke: var(--stor-ink); stroke-opacity: .5; stroke-dasharray: 6 4; }
    .pl { stroke: var(--stor-muted-text); stroke-width: 1.4; stroke-dasharray: 4 4; }
    .pl.sel { stroke: var(--stor-action); stroke-width: 2.4; stroke-dasharray: none; }
    .end { fill: var(--stor-action); }
    .start { fill: var(--stor-health-body); }
    .ax { font-size: 11px; fill: var(--stor-muted-text); }
    .ax.b { font-weight: 650; fill: var(--stor-ink); }
    .big { font-size: 40px; font-weight: 650; line-height: 1; letter-spacing: -.03em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .big small { margin-left: 8px; font-size: 14px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .facts dt { font-size: 12px; color: var(--stor-muted-text); }
    .facts dd { margin: 2px 0 0; font-size: 15px; font-weight: 650; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .warn { padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.45; color: var(--stor-warning); background: var(--stor-warning-soft); }
    .split { display: flex; height: 10px; gap: 2px; }
    .split i { display: block; border-radius: 3px; }
    .split .p { background: var(--stor-ink); opacity: .8; }
    .split .c { background: var(--stor-ink); opacity: .45; }
    .split .f { background: var(--stor-ink); opacity: .22; }
    .foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
    .foot .s { margin-right: auto; }
    .btn { display: inline-flex; height: 42px; align-items: center; padding: 0 16px; border-radius: 12px; font-size: 14px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface); box-shadow: inset 0 0 0 1px var(--stor-border); text-decoration: none; }
    .btn.pri { color: var(--stor-action-text, #fff); background: var(--stor-action); box-shadow: none; }
    .btn:disabled { opacity: .5; }
    @media (max-width: 1023px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 639px) {
        h1 { font-size: 24px; }
        .paces { grid-template-columns: minmax(0, 1fr); }
        .foot { flex-wrap: wrap; }
        .foot .s { flex-basis: 100%; }
    }
</style>
