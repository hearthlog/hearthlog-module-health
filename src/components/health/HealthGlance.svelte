<script lang="ts">
    import type { Snippet } from "svelte";
    import { format, parseISO } from "date-fns";
    import { PhoneGlance } from "@hearthlog/sdk/ui";
    import { formatFixed, formatNumber } from "@hearthlog/sdk/format";
    import type { HealthSources } from "../../health/day.js";

    /**
     * Health's figures in the phone top bar: the day's calories, steps and
     * weight in their domain colours (only the domains the page shows). The
     * bar names the day beside the section, and the sheet holds the rest.
     */
    let {
        date,
        today,
        sources,
        eat = null,
        steps = null,
        weight = null,
        title,
        onWeek,
        actions = [],
        children,
    }: {
        date: string;
        today: string;
        sources: HealthSources;
        eat?: number | null;
        steps?: number | null;
        weight?: number | null;
        /** The sheet's title; the day by default. */
        title?: string;
        /** Opens the week panels from the sheet. */
        onWeek?: () => void;
        /** More ways on from the sheet, e.g. Edit meals. */
        actions?: { label: string; run: () => void }[];
        children: Snippet;
    } = $props();

    const dayLabel = $derived(date === today ? `Today, ${format(parseISO(date), "EEE d MMM")}` : format(parseISO(date), "EEE d MMM"));
    const parts = $derived([
        sources.meals && eat !== null ? { tone: "eat", value: formatNumber(eat), unit: "kcal", name: "Eaten", label: `${formatNumber(eat)} kcal` } : null,
        sources.activity && steps !== null ? { tone: "move", value: formatNumber(steps), unit: "steps", name: "Steps", label: `${formatNumber(steps)} steps` } : null,
        sources.body && weight !== null ? { tone: "body", value: formatFixed(weight, 1), unit: "kg", name: "Weight", label: `${formatFixed(weight, 1)} kg` } : null,
    ].filter((part) => part !== null));
</script>

{#snippet chip()}
    {#if parts.length === 1}
        {@const part = parts[0]}
        <!-- One figure reads with its name, like the other pages' figures. -->
        <span class="stor-tone-{part.tone} flex flex-col items-end leading-tight">
            <span class="flex items-center gap-1 text-[10.5px] font-medium text-[var(--stor-muted-text)]"><span class="h-1.5 w-1.5 rounded-full bg-[var(--tone)]" aria-hidden="true"></span>{part.name}{date === today ? " today" : ""}</span>
            <span class="text-[14.5px] font-semibold tabular-nums text-[var(--stor-ink)]">{part.value}<span class="ml-0.5 text-[11px] font-medium text-[var(--stor-muted-text)]">{part.unit}</span></span>
        </span>
    {:else}
    <span class="flex items-center gap-2.5">
        {#each parts as part (part.tone)}
            <span class="stor-tone-{part.tone} flex items-center gap-1 text-[14px] font-semibold tabular-nums text-[var(--stor-ink)]">
                <span class="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--tone)]" aria-hidden="true"></span>{part.value}
            </span>
        {:else}
            <span class="text-[13px] font-semibold text-[var(--stor-muted-text)]">Summary</span>
        {/each}
    </span>
    {/if}
{/snippet}

<PhoneGlance
    title={title ?? dayLabel}
    context={format(parseISO(date), "EEE d MMM")}
    hideLog={parts.length > 1}
    ariaLabel={parts.length ? `${dayLabel}: ${parts.map((part) => part.label).join(", ")}` : `${dayLabel} summary`}
    {chip}
    more={[...actions, ...(onWeek ? [{ label: "This week", run: onWeek }] : [])]}
>
    {@render children()}
</PhoneGlance>
