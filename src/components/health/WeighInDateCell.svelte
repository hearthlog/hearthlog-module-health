<script lang="ts">
    import { dateTitleParts, formatShortDate } from "../../health/day.js";

    /** A weigh-in's day: `Sep 24`, with the weekday beside it from `sm`. */
    let { date, today }: { date: string; today: string } = $props();
</script>

<span class="whitespace-nowrap font-semibold text-[var(--stor-ink)]">{formatShortDate(date, today)}<span class="ml-2 hidden text-xs font-medium text-[var(--stor-muted-text)] sm:inline">{dateTitleParts(date).weekday.slice(0, 3)}</span></span>
