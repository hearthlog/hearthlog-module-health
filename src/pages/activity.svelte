<script lang="ts">
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { keepPageData } from "@hearthlog/sdk/runtime";
    import { PageDataStatus } from "@hearthlog/sdk/ui";
    import ActivityDiary from "../components/health/ActivityDiary.svelte";
    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    // The last data stays on screen while the next load runs, so a save never flashes the page.
    const kept = keepPageData(() => resource);
    providePageResource(() => kept.display);
</script>
<PageDataStatus {resource} />
<ActivityDiary data={kept.data} loading={kept.loading} revision={kept.revision} />
