<script lang="ts">
    import { queryDatabase } from "@hearthlog/sdk/data";
    import type { CalorieEntry, FoodItem } from "@hearthlog/sdk/data";
    import { appClock, notify } from "@hearthlog/sdk/runtime";
    import { formatNumber } from "@hearthlog/sdk/format";
    import IconPlus from "~icons/mdi/plus";
    import { parseQuickEntry, quickCalories, quickPortion, searchStems } from "../../health/quick-entry.js";
    import { addEntryEvent, draftFromEntry, draftFromFood, entryTime, foodPortions, lastPortion, logEntries, type EntryDraft } from "../../health/entries.js";

    /**
     * A meal's add row. Type "2 rohlíky", "150 g kuře" or "650 canteen" and
     * Enter logs the first match; the arrows choose another. Matching is SQL
     * over the library and earlier entries; a shorter form of the last word is
     * tried when the typed one finds nothing.
     */
    let {
        date,
        today,
        slotId,
        slotLabel,
        onMore,
    }: {
        date: string;
        today: string;
        slotId: string;
        slotLabel: string;
        /** Opens the full log sheet with what was typed. */
        onMore: (term: string) => void;
    } = $props();

    interface Option {
        key: string;
        draft: EntryDraft;
        detail: string;
    }

    const inputId = $props.id();
    let text = $state("");
    let options = $state<Option[]>([]);
    let active = $state(0);
    let saving = $state(false);
    let focused = $state(false);

    const parsed = $derived(parseQuickEntry(text));
    const plain = $derived(quickCalories(parsed));
    // The number-with-a-name option comes first only when nothing in the library matches.
    const choices = $derived.by((): Option[] => {
        const asNumber = plain ? [{ key: "plain", draft: { name: plain.name, calories: plain.calories, proteinG: 0, carbsG: 0, fatG: 0, foodItemId: "", quantityG: 0, portionLabel: "" }, detail: "Just the number, no food" }] : [];
        return parsed.unit === "kcal" || options.length === 0 ? [...asNumber, ...options] : [...options, ...asNumber];
    });
    const open = $derived(focused && text.trim().length > 0);

    function describe(draft: EntryDraft): string {
        const macros = draft.foodItemId || draft.proteinG ? ` · P ${formatNumber(Math.round(draft.proteinG))} · C ${formatNumber(Math.round(draft.carbsG))} · F ${formatNumber(Math.round(draft.fatG))}` : "";
        return `${draft.portionLabel || "as before"}${macros}`;
    }

    function fromFood(food: FoodItem, last: CalorieEntry | undefined): EntryDraft {
        const portion = quickPortion(parsed);
        const choices = foodPortions(food);
        if (portion.kind === "grams") return draftFromFood(food, portion.grams, choices[choices.length - 1]);
        if (portion.kind === "count") {
            const named = choices[0];
            return named.label === "g" ? draftFromFood(food, portion.count * (Number(food.default_serving_g) || 100), named) : draftFromFood(food, portion.count, named);
        }
        const usual = lastPortion(food, last);
        return draftFromFood(food, usual.amount, usual.choice);
    }

    $effect(() => {
        const term = parsed.term;
        if (!term) {
            options = [];
            return;
        }
        let current = true;
        const timer = setTimeout(() => {
            void queryDatabase(async (repositories) => {
                // The first stem that finds anything wins, so "rohlíky" lands on "Rohlík".
                for (const stem of searchStems(term)) {
                    const [foods, recent] = await Promise.all([
                        repositories.calories.searchFoodItems({ search: stem, favoritesOnly: false, sort: { column: null, desc: false }, limit: 4, offset: 0 }),
                        repositories.calories.getRecentEntries(stem, 4),
                    ]);
                    if (foods.length === 0 && recent.length === 0) continue;
                    const lasts = await repositories.calories.getLastEntriesForFoods(foods.map((food) => food.id));
                    return { foods, recent, lasts };
                }
                return { foods: [], recent: [], lasts: [] };
            }).then(({ foods, recent, lasts }) => {
                if (!current) return;
                const count = quickPortion(parsed);
                const fromLibrary = foods.map((food): Option => {
                    const draft = fromFood(food, lasts.find((entry) => entry.food_item_id === food.id));
                    return { key: `food:${food.id}`, draft, detail: describe(draft) };
                });
                // Earlier entries without a library food come back as they were, times a count when one was typed.
                const fromHistory = recent
                    .filter((entry) => !entry.food_item_id || !foods.some((food) => food.id === entry.food_item_id))
                    .map((entry): Option => {
                        const draft = draftFromEntry(entry, count.kind === "count" ? count.count : 1);
                        return { key: `entry:${entry.id}`, draft, detail: describe(draft) };
                    });
                options = [...fromLibrary, ...fromHistory].slice(0, 5);
                active = 0;
            }).catch(() => {
                if (current) options = [];
            });
        }, 120);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    });

    async function add(option: Option | undefined): Promise<void> {
        if (!option || saving) return;
        saving = true;
        try {
            const loggedAt = entryTime(date, today, appClock.now());
            await logEntries([addEntryEvent(option.draft, slotId, loggedAt)]);
            text = "";
            options = [];
        } catch (error) {
            console.error("Failed to log food:", error);
            notify.error("The food could not be saved. What you typed is still here.");
        } finally {
            saving = false;
        }
    }

    function keydown(event: KeyboardEvent): void {
        if (event.key === "ArrowDown" && choices.length > 0) {
            event.preventDefault();
            active = (active + 1) % (choices.length + 1);
        } else if (event.key === "ArrowUp" && choices.length > 0) {
            event.preventDefault();
            active = (active - 1 + choices.length + 1) % (choices.length + 1);
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (active === choices.length) onMore(text.trim());
            else if (choices.length > 0) void add(choices[active]);
            else if (text.trim()) onMore(text.trim());
        } else if (event.key === "Escape") {
            text = "";
            (event.currentTarget as HTMLInputElement).blur();
        }
    }
</script>

<div class="add" class:open>
    <label class="field" for={inputId}>
        <IconPlus class="h-4 w-4 shrink-0" aria-hidden="true" />
        <input
            id={inputId}
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="Add to {slotLabel.toLowerCase()} — “2 rohlíky”, “150 g kuře”, “650 canteen”"
            aria-label="Add to {slotLabel}"
            role="combobox"
            aria-expanded={open}
            aria-controls="{inputId}-list"
            aria-activedescendant={open && choices.length > 0 ? `${inputId}-${active}` : undefined}
            bind:value={text}
            onfocus={() => (focused = true)}
            onblur={() => setTimeout(() => (focused = false), 120)}
            onkeydown={keydown}
            disabled={saving}
        />
    </label>
    {#if open}
        <ul class="list" id="{inputId}-list" role="listbox" aria-label="Matches">
            {#each choices as option, index (option.key)}
                <li id="{inputId}-{index}" role="option" aria-selected={index === active}>
                    <button type="button" class:on={index === active} onmousedown={(event) => event.preventDefault()} onclick={() => void add(option)}>
                        {#if index === active}<span class="kbd" aria-hidden="true">↵</span>{/if}
                        <span class="nm">{option.key === "plain" ? `Log ${formatNumber(option.draft.calories)} kcal as “${option.draft.name}”` : option.draft.name}<small>{option.detail}</small></span>
                        {#if option.key !== "plain"}<span class="kc">{formatNumber(option.draft.calories)}</span>{/if}
                    </button>
                </li>
            {/each}
            <li id="{inputId}-{choices.length}" role="option" aria-selected={active === choices.length}>
                <button type="button" class="more" class:on={active === choices.length} onmousedown={(event) => event.preventDefault()} onclick={() => onMore(text.trim())}>
                    {choices.length === 0 ? `Nothing yet for “${parsed.term || text.trim()}”. Search online or scan` : "More results, online catalog, scan"}
                </button>
            </li>
        </ul>
    {/if}
</div>

<style>
    .add { position: relative; }
    .field { display: flex; height: 38px; align-items: center; gap: 8px; padding: 0 10px; border-radius: 10px; color: var(--stor-muted-text); cursor: text; }
    .field:hover { background: var(--stor-surface-hover); }
    .open .field, .field:focus-within { background: var(--stor-surface); box-shadow: inset 0 0 0 1px var(--stor-action), 0 0 0 3px var(--stor-selected); color: var(--stor-ink); }
    input { min-width: 0; flex: 1; border: 0; background: transparent; font-size: 13.5px; color: var(--stor-ink); outline: none; }
    input::placeholder { color: var(--stor-muted-text); }
    .list {
        position: absolute; z-index: var(--stor-layer-menu, 40); left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 4px; list-style: none;
        border-radius: 12px; background: var(--stor-surface-raised); box-shadow: var(--stor-elevation-3);
    }
    .list button { display: flex; width: 100%; min-height: 44px; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 8px; text-align: left; font-size: 13.5px; color: var(--stor-ink); }
    .list button.on { background: var(--stor-surface-muted); }
    .nm { display: flex; min-width: 0; flex: 1; flex-direction: column; font-weight: 600; }
    .nm small { font-size: 12px; font-weight: 500; color: var(--stor-muted-text); font-variant-numeric: tabular-nums; }
    .kc { font-weight: 600; font-variant-numeric: tabular-nums; }
    .kbd { display: inline-grid; min-width: 20px; height: 20px; place-items: center; border-radius: 5px; font-size: 11px; color: var(--stor-muted-text); box-shadow: inset 0 0 0 1px var(--stor-border); }
    .more { color: var(--stor-muted-text) !important; font-weight: 500; }
</style>
