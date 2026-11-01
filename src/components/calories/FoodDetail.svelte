<script lang="ts">
    import { queryDatabase, type FoodItem } from "@hearthlog/sdk/data";
    import { appClock, notify } from "@hearthlog/sdk/runtime";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconClose from "~icons/mdi/close";
    import type { FoodUsage } from "../../data/calories.js";
    import { effectiveMealSlots, resolveDefaultMeal, toLocalDateString, type MealSlotView } from "../../calories/logic.js";
    import { energyShares } from "../../calories/food-logic.js";
    import { addEntryEvent, draftFromFood, entryTime, foodPortions, lastPortion, logEntries } from "../../health/entries.js";
    import { shortDate } from "../../health/format.js";

    /**
     * One food beside the library: its values per 100 g, the portions it can
     * be logged in, when it gets eaten, and a food with a near-identical name
     * that may be the same one. Log it adds the usual portion to the meal of
     * the hour, with Undo.
     */
    let { food, onEdit, onSelect, onClose }: { food: FoodItem; onEdit: (food: FoodItem) => void; onSelect: (food: FoodItem) => void; onClose: () => void } = $props();

    let usage = $state<FoodUsage | null>(null);
    let similar = $state<FoodItem[]>([]);
    let slots = $state<MealSlotView[]>([]);
    let logging = $state(false);

    $effect(() => {
        const current = food;
        let live = true;
        const today = toLocalDateString(appClock.now());
        // The first word decides a likely duplicate: "Rohlík obyčejný" and "Rohlík bílý".
        const head = current.name.trim().split(/\s+/)[0] ?? "";
        void queryDatabase((repositories) => Promise.all([
            repositories.calories.getFoodUsage(current.id, today),
            head.length >= 3 ? repositories.calories.searchFoodItems({ search: head, favoritesOnly: false, sort: { column: null, desc: false }, limit: 6, offset: 0 }) : [],
            repositories.calories.getMealSlots(),
        ])).then(([used, matches, stored]) => {
            if (!live) return;
            usage = used;
            // Close in energy too, so "Rohlík celozrnný" does not read as a copy of "Rohlík obyčejný".
            similar = matches.filter((match) => match.id !== current.id && Math.abs(match.calories_per_100g - current.calories_per_100g) <= Math.max(10, current.calories_per_100g * 0.06)).slice(0, 2);
            slots = effectiveMealSlots(stored).filter((slot) => !slot.archived);
        }).catch(() => {
            if (live) usage = null;
        });
        return () => { live = false; };
    });

    const shares = $derived(energyShares(food));
    const portions = $derived(foodPortions(food).filter((choice) => choice.label !== "g"));
    const usual = $derived(lastPortion(food, usage?.last ?? undefined));
    const usualDraft = $derived(draftFromFood(food, usual.amount, usual.choice));
    const mealLabel = (id: string) => slots.find((slot) => slot.id === id)?.label ?? id;
    const maxUses = $derived(Math.max(1, ...(usage?.byMeal.map((meal) => meal.uses) ?? [1])));

    async function logIt(): Promise<void> {
        if (logging) return;
        logging = true;
        const now = appClock.now();
        const today = toLocalDateString(now);
        const meal = resolveDefaultMeal(slots, now);
        try {
            await logEntries([addEntryEvent(usualDraft, meal, entryTime(today, today, now))]);
        } catch (error) {
            console.error("Failed to log food:", error);
            notify.error("The food could not be logged");
        } finally {
            logging = false;
        }
    }
</script>

<aside class="stor-panel detail" aria-labelledby="food-detail-title">
    <header class="hd">
        <div class="min-w-0">
            <h2 id="food-detail-title">{food.name}</h2>
            <p class="src">{[food.brand, food.source_provider === "kal-api" ? "Kalorické tabulky" : "My food"].filter(Boolean).join(" · ")}</p>
        </div>
        <button type="button" class="x" aria-label="Close detail" onclick={onClose}><IconClose class="h-5 w-5" /></button>
    </header>

    <p class="k">Per 100 g</p>
    <div class="tiles">
        <div><b>{formatNumber(Math.round(food.calories_per_100g))}</b><span>kcal</span></div>
        <div><b>{formatNumber(food.protein_per_100g, 1)}</b><span>protein g</span></div>
        <div><b>{formatNumber(food.carbs_per_100g, 1)}</b><span>carbs g</span></div>
        <div><b>{formatNumber(food.fat_per_100g, 1)}</b><span>fat g</span></div>
    </div>
    {#if shares.protein + shares.carbs + shares.fat > 0}
        <div class="split" aria-label="Energy from protein {Math.round(shares.protein * 100)} %, carbs {Math.round(shares.carbs * 100)} %, fat {Math.round(shares.fat * 100)} %">
            <i class="p" style:flex="{shares.protein} 0 0"></i><i class="c" style:flex="{shares.carbs} 0 0"></i><i class="f" style:flex="{shares.fat} 0 0"></i>
        </div>
        <p class="s">Energy from protein {Math.round(shares.protein * 100)} %, carbs {Math.round(shares.carbs * 100)} %, fat {Math.round(shares.fat * 100)} %</p>
    {/if}

    <p class="k">Portions</p>
    <div class="list">
        {#each portions as choice (choice.label)}
            <div class="li"><span>{choice.label}<small>{formatNumber(choice.grams)} g</small></span><span class="n">{formatNumber(Math.round((food.calories_per_100g * choice.grams) / 100))} kcal</span>{#if usual.choice.label === choice.label}<em>Usual</em>{/if}</div>
        {/each}
        <div class="li"><span>Grams<small>any amount</small></span><span class="n">{formatNumber(Math.round(food.calories_per_100g))} kcal / 100 g</span>{#if usual.choice.label === "g"}<em>Usual</em>{/if}</div>
    </div>

    {#if usage}
        <p class="k">When you eat it <small>last 30 days</small></p>
        {#if usage.byMeal.length > 0}
            <div class="bars">
                {#each usage.byMeal as meal (meal.mealType)}
                    <div class="br"><span>{mealLabel(meal.mealType)}</span><span class="track"><i style:width="{(meal.uses / maxUses) * 100}%"></i></span><span class="n">{meal.uses}×</span></div>
                {/each}
            </div>
        {:else}
            <p class="s">Not in the last 30 days{usage.lastUsed ? `; last ${shortDate(usage.lastUsed, toLocalDateString(appClock.now()))}` : ""}.</p>
        {/if}
    {/if}

    {#each similar as match (match.id)}
        <div class="dup">
            <p><b>Maybe the same as “{match.name}”</b> · {formatNumber(Math.round(match.calories_per_100g))} kcal / 100 g</p>
            <button type="button" class="lnk" onclick={() => onSelect(match)}>Compare</button>
        </div>
    {/each}

    <div class="acts">
        <button type="button" class="btn pri" disabled={logging} onclick={() => void logIt()}>Log {usualDraft.portionLabel} · {formatNumber(usualDraft.calories)} kcal</button>
        <button type="button" class="btn" onclick={() => onEdit(food)}>Edit</button>
    </div>
</aside>

<style>
    .detail { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; }
    .hd { display: flex; align-items: flex-start; gap: 8px; }
    h2 { font-size: 18px; font-weight: 650; line-height: 1.25; color: var(--stor-ink); }
    .src { font-size: 12.5px; color: var(--stor-muted-text); }
    .x { display: grid; width: 36px; height: 36px; flex-shrink: 0; margin-left: auto; place-items: center; border-radius: 10px; color: var(--stor-muted-text); }
    .x:hover { background: var(--stor-surface-hover); color: var(--stor-ink); }
    .k { margin-top: 6px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .k small { font-weight: 500; }
    .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .tiles div { display: flex; flex-direction: column; padding: 8px 10px; border-radius: 10px; background: var(--stor-surface-muted); }
    .tiles b { font-size: 17px; font-weight: 650; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .tiles span { font-size: 11.5px; color: var(--stor-muted-text); }
    .split { display: flex; height: 8px; gap: 2px; }
    .split i { display: block; border-radius: 3px; }
    .split .p { background: var(--stor-ink); opacity: .8; }
    .split .c { background: var(--stor-ink); opacity: .45; }
    .split .f { background: var(--stor-ink); opacity: .22; }
    .s { font-size: 12.5px; color: var(--stor-muted-text); }
    .list { display: flex; flex-direction: column; }
    .li { display: flex; align-items: center; gap: 10px; min-height: 36px; font-size: 13.5px; color: var(--stor-ink); }
    .li + .li { border-top: 1px solid color-mix(in srgb, var(--stor-border) 50%, transparent); }
    .li span:first-child { display: flex; flex: 1; align-items: baseline; gap: 6px; }
    .li small { font-size: 12px; color: var(--stor-muted-text); }
    .n { font-variant-numeric: tabular-nums; color: var(--stor-muted-text); }
    .li em { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-style: normal; font-weight: 600; color: var(--stor-accent-strong); background: var(--stor-accent-soft); }
    .bars { display: flex; flex-direction: column; gap: 6px; }
    .br { display: grid; grid-template-columns: 80px minmax(0, 1fr) 36px; align-items: center; gap: 8px; font-size: 13px; color: var(--stor-ink); }
    .track { display: block; height: 6px; border-radius: 3px; background: var(--stor-surface-muted); overflow: hidden; }
    .track i { display: block; height: 100%; background: var(--stor-health-eat); }
    .br .n { text-align: right; }
    .dup { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; font-size: 12.5px; color: var(--stor-muted-text); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .dup p { flex: 1; }
    .dup b { color: var(--stor-ink); font-weight: 600; }
    .lnk { font-size: 13px; font-weight: 600; color: var(--stor-accent-text); }
    .acts { display: flex; gap: 8px; margin-top: 6px; }
    .btn { display: inline-flex; height: 40px; align-items: center; padding: 0 14px; border-radius: 12px; font-size: 13.5px; font-weight: 600; color: var(--stor-ink); background: var(--stor-surface); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .btn.pri { flex: 1; justify-content: center; color: var(--stor-action-text, #fff); background: var(--stor-action); box-shadow: none; }
    .btn:disabled { opacity: .5; }
</style>
