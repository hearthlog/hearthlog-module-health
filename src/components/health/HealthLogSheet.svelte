<script lang="ts">
    import { goto } from "$app/navigation";
    import { Button } from "@hearthlog/sdk/ui";
    import { CommandModal } from "@hearthlog/sdk/ui";
    import { MobilePageAction } from "@hearthlog/sdk/ui";
    import { healthLogItems } from "./log-items.js";
    import { contextualHref } from "@hearthlog/sdk/runtime";
    import IconChevronRight from "~icons/mdi/chevron-right";
    import IconPlus from "~icons/mdi/plus";
    import type { StoredMealSlot } from "../../calories/logic.js";
    import QuickFoodLog from "./QuickFoodLog.svelte";
    import QuickActivityLog from "./QuickActivityLog.svelte";
    import QuickWeighIn from "./QuickWeighIn.svelte";

    /**
     * One place to log from a day, on phones: the floating pill opens a sheet
     * with three large choices, and each opens its short form over the day.
     */
    let {
        date,
        today,
        sources,
        mealSlots,
    }: {
        date: string;
        today: string;
        sources: { meals: boolean; activity: boolean; body: boolean };
        mealSlots: StoredMealSlot[];
    } = $props();

    let open = $state(false);
    let form = $state<"food" | "activity" | "weigh-in" | null>(null);
    const items = $derived(healthLogItems(date, sources));

    function choose(id: string, href: string): void {
        open = false;
        if (id === "food" || id === "activity" || id === "weigh-in") form = id;
        else void goto(contextualHref(href));
    }
</script>

{#if items.length > 0}
    <MobilePageAction hideWhenModalOpen isModalOpen={open || form !== null}>
        <Button class="h-12 w-full text-[15px]" onclick={() => (open = true)}>
            <IconPlus class="h-5 w-5" /> <span class="stor-action-label">Log</span>
        </Button>
    </MobilePageAction>
    <CommandModal show={open} title="Log" onClose={() => (open = false)}>
        <ul class="-mx-2 flex flex-col">
            {#each items as item (item.id)}
                {@const Icon = item.icon}
                <li class="[&+li]:border-t [&+li]:border-[color-mix(in_srgb,var(--stor-border)_55%,transparent)]">
                    <button
                        type="button"
                        class="stor-tone-{item.tone} flex min-h-[64px] w-full items-center gap-4 rounded-2xl px-2 py-2 text-left hover:bg-[var(--stor-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)]"
                        onclick={() => choose(item.id, item.href)}
                    >
                        <span
                            class="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--tone)]"
                            style:background="color-mix(in srgb, var(--tone) 15%, var(--stor-surface))"
                        ><Icon class="h-6 w-6" /></span>
                        <span class="min-w-0 flex-1">
                            <span class="block text-base font-semibold text-[var(--stor-ink)]">{item.label}</span>
                            <span class="block text-[13px] text-[var(--stor-muted-text)]">{item.description}</span>
                        </span>
                        <IconChevronRight class="h-5 w-5 shrink-0 text-[var(--stor-muted-text)]" />
                    </button>
                </li>
            {/each}
        </ul>
    </CommandModal>
{/if}

<QuickFoodLog show={form === "food"} {date} {today} {mealSlots} onClose={() => (form = null)} />
<QuickActivityLog show={form === "activity"} {date} {today} onClose={() => (form = null)} />
<QuickWeighIn show={form === "weigh-in"} {date} {today} onClose={() => (form = null)} />
