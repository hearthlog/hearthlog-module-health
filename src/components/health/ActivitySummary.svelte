<script lang="ts">
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { DataValue } from "@hearthlog/sdk/ui";
    import { Button } from "@hearthlog/sdk/ui";
    import HealthRing from "./HealthRing.svelte";
    import { goalProgress, moveStatus } from "../../health/day.js";
    import { formatNumber } from "@hearthlog/sdk/format";

    /**
     * The day's steps as a ring against the daily target, and active energy as a
     * plain figure: it is context, not a target. The week's workouts sit in the
     * week panel beside the list.
     */
    let {
        steps,
        stepsTarget,
        activeCalories,
        isToday,
        loading,
        onSetGoals,
    }: {
        steps: number;
        /** The daily steps goal; zero when none is set. */
        stepsTarget: number;
        activeCalories: number;
        isToday: boolean;
        loading: boolean;
        onSetGoals: () => void;
    } = $props();

    const goal = $derived(goalProgress(steps, stepsTarget, "minimum"));
    const stepsLine = $derived(moveStatus(steps, stepsTarget));
    const ringLabel = $derived(
        loading ? "Loading" : stepsTarget > 0 ? `${formatNumber(steps)} of ${formatNumber(stepsTarget)} steps` : `${formatNumber(steps)} steps, no target`,
    );
</script>

<section class="stor-panel hero" aria-label="Activity summary">
    <div class="cols">
        <div class="col steps stor-tone-move">
            <HealthRing ratio={goal.ratio} tone="move" value={formatNumber(steps)} unit="steps" label={ringLabel} met={!loading && goal.tone === "met"} />
            <div class="text">
                <p class="lab"><i></i>Steps</p>
                {#if !loading}
                    {#if stepsLine}<p class="main" class:pos={goal.tone === "met"}>{stepsLine}</p>{/if}
                    {#if stepsTarget <= 0}
                        <CommandOnly>
                            <Button variant="ghost" size="sm" class="-ml-3 mt-1" onclick={onSetGoals}>Set a daily target</Button>
                        </CommandOnly>
                    {/if}
                {/if}
            </div>
        </div>

        <div class="col energy stor-tone-move">
            <p class="lab"><i></i>{isToday ? "Active energy today" : "Active energy"}</p>
            <p class="big"><DataValue>{formatNumber(activeCalories)}</DataValue><small>kcal</small></p>
        </div>
    </div>
</section>

<style>
    /* The panel's own width picks the layout: stacked bands when narrow, two columns once it has room. */
    .hero { container-type: inline-size; }
    .cols { display: grid; grid-template-columns: minmax(0, 1fr); }
    .col { position: relative; min-width: 0; padding: 20px; }
    .col + .col::before { content: ""; position: absolute; top: 0; left: 24px; right: 24px; height: 1px; background: color-mix(in srgb, var(--stor-border) 70%, transparent); }
    .steps { --ring-size: 104px; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 16px; }
    .lab { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; letter-spacing: .02em; color: var(--stor-muted-text); }
    .lab i { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--tone); }
    .main { margin-top: 5px; font-size: 15px; font-weight: 650; letter-spacing: -.005em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .main.pos { color: var(--stor-positive); }
    .big { margin: 6px 0 0; font-size: 34px; font-weight: 650; line-height: 1.1; letter-spacing: -.03em; color: var(--stor-ink); font-variant-numeric: tabular-nums; }
    .big small { margin-left: 6px; font-size: 14px; font-weight: 500; letter-spacing: 0; color: var(--stor-muted-text); }
    .energy .big { margin-bottom: 6px; }

    @container (min-width: 30rem) {
        .cols { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); }
        .col { padding: 24px 26px; }
        .col + .col::before { top: 24px; bottom: 24px; left: 0; right: auto; width: 1px; height: auto; }
        .steps { --ring-size: 112px; gap: 20px; }
    }
</style>
