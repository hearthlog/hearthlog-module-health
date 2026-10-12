<script lang="ts">
    import { DropdownMenu } from "bits-ui";
    import { goto } from "$app/navigation";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { healthLogItems } from "./log-items.js";
    import { contextualHref } from "@hearthlog/sdk/runtime";
    import IconChevronDown from "~icons/mdi/chevron-down";
    import IconPlus from "~icons/mdi/plus";

    /** One place to log from a day, on desktop: a menu of what the tenant tracks. */
    let {
        date,
        sources,
    }: {
        date: string;
        sources: { meals: boolean; activity: boolean; body: boolean };
    } = $props();

    const items = $derived(healthLogItems(date, sources));
    const itemClass =
        "flex cursor-default items-center gap-3 rounded-lg px-2 py-2 text-sm font-semibold text-[var(--stor-ink)] outline-none data-[highlighted]:bg-[var(--stor-surface-muted)]";
</script>

{#if items.length > 0}
    <CommandOnly>
        <DropdownMenu.Root>
            <DropdownMenu.Trigger
                class="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--stor-action)] px-4 text-sm font-semibold text-[var(--stor-action-text)] transition-[background-color,box-shadow] hover:bg-[var(--stor-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stor-focus)] data-[state=open]:ring-2 data-[state=open]:ring-[var(--stor-selected)] sm:h-9"
            >
                <IconPlus class="h-4 w-4" />
                Log
                <IconChevronDown class="h-4 w-4" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    loop
                    class="stor-menu z-[var(--stor-layer-menu)] w-56 overflow-hidden p-2"
                >
                    <p class="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--stor-muted-text)]">Log</p>
                    {#each items as item (item.id)}
                        {@const Icon = item.icon}
                        <DropdownMenu.Item class={itemClass} onSelect={() => void goto(contextualHref(item.href))}>
                            <span
                                class="stor-tone-{item.tone} grid h-7 w-7 place-items-center rounded-lg text-[var(--tone)]"
                                style:background="color-mix(in srgb, var(--tone) 15%, var(--stor-surface))"
                            ><Icon class="h-4 w-4" /></span>
                            {item.label}
                        </DropdownMenu.Item>
                    {/each}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    </CommandOnly>
{/if}
