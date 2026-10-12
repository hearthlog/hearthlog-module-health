<script lang="ts">
    import { energyShares, type EnergyShares } from "../../calories/food-logic.js";
    import type { FoodItem } from "../../data/calories.js";

    /**
     * Where a food's energy comes from, as one bar in the Eat colour: protein
     * strongest, then carbs, then fat. Shares come from its macros per 100 g.
     */
    let { food }: { food: Pick<FoodItem, "protein_per_100g" | "carbs_per_100g" | "fat_per_100g"> } = $props();

    const shares = $derived<EnergyShares>(energyShares(food));
    const percent = (share: number): number => Math.round(share * 100);
    const label = $derived(
        shares.protein + shares.carbs + shares.fat > 0
            ? `Energy from protein ${percent(shares.protein)}%, carbs ${percent(shares.carbs)}%, fat ${percent(shares.fat)}%`
            : "No macros recorded",
    );
</script>

<span class="fp stor-tone-eat" role="img" aria-label={label}>
    <i class="protein" style:flex={shares.protein} style:min-width={shares.protein > 0 ? "3px" : "0"}></i>
    <i class="carbs" style:flex={shares.carbs} style:min-width={shares.carbs > 0 ? "3px" : "0"}></i>
    <i class="fat" style:flex={shares.fat} style:min-width={shares.fat > 0 ? "3px" : "0"}></i>
</span>

<style>
    .fp { display: flex; width: 100%; min-width: 60px; height: 6px; gap: 2px; border-radius: 3px; background: color-mix(in srgb, var(--tone) 10%, var(--stor-surface)); }
    i { display: block; border-radius: 3px; }
    .protein { background: var(--tone); }
    .carbs { background: color-mix(in srgb, var(--tone) 52%, var(--stor-surface)); }
    .fat { background: color-mix(in srgb, var(--tone) 26%, var(--stor-surface)); }
</style>
