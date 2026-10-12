<script lang="ts">
    import type { ComponentProps, Snippet } from "svelte";
    import { Modal } from "@hearthlog/sdk/ui";
    import HealthPageHeader from "./HealthPageHeader.svelte";
    import HealthDayHeader from "./HealthDayHeader.svelte";
    import type { HealthSources, HealthWeekDay } from "../../health/day.js";

    /**
     * The frame of a day-based Health page: the section tabs, the week strip,
     * the days side by side, and beside them the week panels for the day in
     * view. Phones have no room beside the list, so the panels open in a sheet,
     * and the page itself scrolls the day under the strip.
     */
    let {
        active,
        date,
        today,
        week,
        targets,
        sources,
        onNavigate,
        shift = 0,
        weekOpen = $bindable(false),
        main = "1.5fr",
        action,
        list,
        aside,
    }: {
        active: ComponentProps<typeof HealthPageHeader>["active"];
        /** The day in view. */
        date: string;
        today: string;
        week: readonly HealthWeekDay[];
        targets: { calories: number; steps: number };
        sources: HealthSources;
        onNavigate: (date: string) => void | Promise<void>;
        /** How far the list sits past the day in view, so the strip's pill follows a swipe. */
        shift?: number;
        /** Whether the week sheet is open (phones). */
        weekOpen?: boolean;
        /** The list's share of the width from `lg`, against 1fr for the week panels. */
        main?: string;
        /** The page's primary action, beside the strip from `lg`. */
        action?: Snippet;
        list: Snippet;
        aside: Snippet;
    } = $props();
</script>

<div class="stor-days w-full">
    <HealthPageHeader {active} />
    <div class="stor-days-body stor-page p-2.5 sm:p-3">
        <!-- Below lg the page scrolls the day and the strip stays at the top, so the day in view is always named. -->
        <div class="stor-days-strip" data-days-strip><HealthDayHeader {date} {today} {week} {targets} {sources} {onNavigate} {shift} {action} /></div>
        <div class="stor-days-layout" style:--days-main={main}>
            <div class="stor-days-list">{@render list()}</div>
            <aside class="stor-days-aside" aria-label="This week">{@render aside()}</aside>
        </div>
    </div>
</div>

<Modal show={weekOpen} title="This week" onClose={() => (weekOpen = false)}>
    <div class="flex flex-col gap-[var(--stor-section-gap)]">{@render aside()}</div>
</Modal>
