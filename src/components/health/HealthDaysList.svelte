<script lang="ts" generics="T">
    import { untrack, type Snippet } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { MediaQuery } from "svelte/reactivity";
    import { DayPager } from "@hearthlog/sdk/endless";
    import type { BucketStore } from "@hearthlog/sdk/endless";
    import { parseSelectedDate } from "../../calories/logic.js";
    import { dayArrowStep } from "../../health/day.js";
    import { nearestKey, shiftDay, type EndlessAxis } from "@hearthlog/sdk/endless";

    /**
     * Days of one Health domain, one at a time: swipe across to change the day,
     * scroll down to read it. Each day is read from SQL as it comes into view.
     * The address follows the day in view once scrolling rests, so a reload
     * opens there, and the arrow keys step it.
     */
    let {
        axis,
        store,
        today,
        opening,
        revision,
        visible = $bindable(),
        shift = $bindable(0),
        blocked = false,
        label,
        block,
    }: {
        axis: EndlessAxis;
        store: BucketStore<T>;
        today: string;
        /** The day the list opens at, read once. */
        opening: string;
        /** Changes after a save or a sync; the days on screen then read again. */
        revision: number;
        /** The day in view; start it at the opening day. */
        visible: string;
        /** How far the list sits past the day in view, for the week strip. */
        shift?: number;
        /** A drawer or dialog owns the keyboard. */
        blocked?: boolean;
        label: string;
        /** Draws one day; its data is missing while it loads. */
        block: Snippet<[date: string, data: T | undefined]>;
    } = $props();

    let pager = $state<ReturnType<typeof DayPager>>();
    let wrapper = $state<HTMLDivElement>();
    /** Below `lg` the page scrolls the day, so a phone has one scrolling surface, not one per day. */
    const paged = new MediaQuery("max-width: 1023px");
    /** A day's start lands under the week strip, which stays at the top while the page scrolls. */
    function edge(): number | undefined {
        return wrapper?.closest(".stor-days")?.querySelector("[data-days-strip]")?.getBoundingClientRect().bottom;
    }
    const start = untrack(() => nearestKey(axis, opening));
    /** The day the address last named, so only a different one counts as a trip somewhere else. */
    let named = start;
    let addressTimer: ReturnType<typeof setTimeout> | undefined;

    /** Scrolls to a day; the strip and the arrow keys come here. */
    export function goTo(date: string, behavior: ScrollBehavior = "auto"): void {
        visible = nearestKey(axis, date);
        pager?.scrollTo(visible, behavior);
    }

    /** Re-reads the days on screen, for example after a setting that changes how a day reads. */
    export function refresh(): void {
        pager?.refresh();
    }

    function follow(date: string): void {
        clearTimeout(addressTimer);
        addressTimer = setTimeout(() => {
            const url = new URL(window.location.href);
            if ((url.searchParams.get("date") ?? today) === date) {
                named = date;
                return;
            }
            if (date === today) url.searchParams.delete("date");
            else url.searchParams.set("date", date);
            named = date;
            void goto(`${url.pathname}${url.search}${url.hash}`, { shallow: true, replace: true });
        }, 250);
    }

    $effect(() => () => clearTimeout(addressTimer));

    // A link or Back/Forward to another day while the list is open scrolls there.
    $effect(() => {
        const requested = parseSelectedDate(page.url.searchParams.get("date"), today);
        untrack(() => {
            if (requested === named) return;
            named = requested;
            goTo(requested);
        });
    });

    function handleKeydown(event: KeyboardEvent): void {
        if (blocked) return;
        const step = dayArrowStep(event);
        if (!step) return;
        event.preventDefault();
        goTo(shiftDay(visible, step), "smooth");
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="stor-days-scroller" bind:this={wrapper}>
    <DayPager
        bind:this={pager}
        bind:shift
        {axis}
        {store}
        opening={start}
        {revision}
        home={{ key: nearestKey(axis, today), label: "Today" }}
        flow={paged.current}
        {edge}
        item={block}
        onVisibleChange={(date) => (visible = date)}
        onSettle={follow}
        role="region"
        aria-label={label}
        data-days-pager
    />
</div>
