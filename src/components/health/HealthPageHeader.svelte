<script lang="ts">
    import { PageHeader } from "@hearthlog/sdk/ui";
    import { RouteTabs } from "@hearthlog/sdk/ui";
    import { contextualHref, sectionLinks } from "@hearthlog/sdk/runtime";
    import { tenant } from "@hearthlog/sdk/runtime";
    import type { Snippet } from "svelte";

    type HealthSection = "day" | "body" | "nutrition" | "activities" | "foods";

    let {
        active,
        action,
    }: {
        active: HealthSection;
        action?: Snippet;
    } = $props();

    const visibleSections = sectionLinks("health", tenant.features);
    const tabs = $derived(visibleSections.map((section) => ({
        // "Food library" would clip the tab row on a phone; the sidebar keeps the full name.
        label: section.id === "foods" ? "Foods" : section.label,
        href: contextualHref(section.href),
        active: active === section.id,
    })));
</script>

{#snippet sectionTabs()}
    <RouteTabs label="Health sections" {tabs} />
{/snippet}

<PageHeader title="Health" class="stor-health-header max-md:sr-only" sidebarTabs tabs={sectionTabs}>
    {#if action}<div class="hidden shrink-0 lg:block">{@render action()}</div>{/if}
</PageHeader>
