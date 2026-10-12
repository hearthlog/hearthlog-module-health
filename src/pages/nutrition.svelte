<script lang="ts">
    import { formatNumber as formatCount } from "@hearthlog/sdk/format";
    import { DataValue } from "@hearthlog/sdk/ui";
    import { providePageResource } from "@hearthlog/sdk/runtime";
    import { keepPageData } from "@hearthlog/sdk/runtime";
    import { PageDataStatus } from "@hearthlog/sdk/ui";
    import { DataPlaceholder } from "@hearthlog/sdk/ui";
    import { goto} from "$app/navigation";
    import { refreshPageData as invalidate } from "@hearthlog/sdk/runtime";
    import { page } from "$app/state";
    import { tick, untrack } from "svelte";
    import {
        getKalFood,
        getKalMeta,
        searchKalFoods,
        type KalEanConfidence,
        type KalEanLookupResponse,
        type KalFood,
    } from "../api/kal.js";
    import {
        effectiveMealSlots,
        loggedAtOnDate,
        normalizeLocalDateTime,
        resolveDefaultMeal,
        shiftLocalDate,
        shiftLoggedAt,
        toLocalDateString,
        toLocalDateTimeString,
        validateCalorieEntryDraft,
        validateNutritionGoalDraft,
        type CalorieEntryDraft,
        type MealSlotView,
        type NutritionGoalDraft,
        type StoredMealSlot,
    } from "../calories/logic.js";
    import {
        CALORIE_ACTIVITY_LEVELS,
        CALORIE_CALCULATION_METHOD,
        calculateCalorieGoal,
        validateCalorieGoalCalculationInput,
        type CalorieActivityLevel,
        type CalorieCalculationSelection,
        type CalorieCalculationSex,
        type CalorieGoalCalculationResult,
        type CalorieTargetSource,
    } from "../calories/goal-calculator.js";
    import {
        calculateNutritionForQuantity,
        calculatePer100gFromEntry,
        rankFoodItems,
        specificServingLabel,
    } from "../calories/food-logic.js";
    import {
        externalImportToFoodItem,
        hasKnownCalories,
        loadMissingImportedServings,
        toExternalFoodImport,
        KAL_SOURCE_PROVIDER,
        type ExternalFoodImport,
    } from "../calories/external-food.js";
    import {
        parseStoredServings,
        selectableServings,
        servingGrams,
        servingLabel,
        servingOptionLabel,
    } from "../calories/servings.js";
    import { CommandConfirmDialog } from "@hearthlog/sdk/ui";
    import { CommandDrawer } from "@hearthlog/sdk/ui";
    import { CommandOnly } from "@hearthlog/sdk/ui";
    import { MobilePageAction } from "@hearthlog/sdk/ui";
    import QuickFoodLog from "../components/health/QuickFoodLog.svelte";
    import { ChoiceChips } from "@hearthlog/sdk/ui";
    import { FoldLine } from "@hearthlog/sdk/ui";
    import IconChevronRight from "~icons/mdi/chevron-right";
    import FoodBarcodeScanner from "../components/calories/FoodBarcodeScanner.svelte";
    import MealSlotManager from "../components/calories/MealSlotManager.svelte";
    import { commitMealSlotEvents, mealSlotAddEvent, mealSlotBootstrapEvents } from "../calories/slot-commands.js";
    import HealthDaysShell from "../components/health/HealthDaysShell.svelte";
    import HealthDaysList from "../components/health/HealthDaysList.svelte";
    import NutritionDayBlock from "../components/calories/NutritionDayBlock.svelte";
    import NutritionWeekPanel from "../components/calories/NutritionWeekPanel.svelte";
    import { BucketStore } from "@hearthlog/sdk/endless";
    import { dayBlocks } from "../health/day-blocks.js";
    import { healthDayAxis } from "../health/day-list.js";
    import { emptyHealthWeek } from "../health/week-data.js";
    import { WeekFollower } from "../health/week-follow.svelte.js";
    import {
        loadNutritionDay,
        loadNutritionSide,
        type MealDrag,
        type NutritionDayBlock as NutritionDay,
    } from "../calories/page-data.js";
    import type { EndlessAxis } from "@hearthlog/sdk/endless";
    import { isFeatureEnabled, tenant } from "@hearthlog/sdk/runtime";
    import { Button } from "@hearthlog/sdk/ui";
    import { Checkbox } from "@hearthlog/sdk/ui";
    import { DateTimePicker } from "@hearthlog/sdk/ui";
    import { Field } from "@hearthlog/sdk/ui";
    import { Input } from "@hearthlog/sdk/ui";
    import { Select } from "@hearthlog/sdk/ui";
    import { Textarea } from "@hearthlog/sdk/ui";
    import type { CalorieEntry, FoodItem, NutritionGoal } from "../data/calories.js";
    import { queryDatabase } from "@hearthlog/sdk/data";
    import {
        type AddCalorieEntryEvent,
        type AddFoodItemEvent,
        type AddNutritionGoalEvent,
        type RemoveCalorieEntryEvent,
        type UpdateCalorieEntryEvent,
        type UpdateFoodItemEvent,
        type UpdateNutritionGoalEvent,
    } from "@hearthlog/sdk/data";
    import { executeLocalCommand } from "@hearthlog/sdk/data";
    import { notify } from "@hearthlog/sdk/runtime";
    import { appClock, contextualHref } from "@hearthlog/sdk/runtime";
    import { runCommandAction as runWorkspaceCommandAction } from "@hearthlog/sdk/runtime";
    import IconBarcodeScan from "~icons/mdi/barcode-scan";
    import IconPlus from "~icons/mdi/plus";

    let { data: routeData } = $props();
    const resource = $derived(routeData.pageResource);
    // The last data stays on screen while the next load runs, so a save never flashes the page.
    const kept = keepPageData(() => resource);
    providePageResource(() => kept.display);
    const data = $derived(kept.data);
    function runCommandAction(action: () => void): boolean {
        return !kept.loading && runWorkspaceCommandAction(action);
    }
    const boundaryToday = $derived(toLocalDateString(appClock.now()));

    const calculationSexOptions = [
        { value: "female", label: "Female" },
        { value: "male", label: "Male" },
    ];
    const calculationActivityOptions = CALORIE_ACTIVITY_LEVELS.map((level) => ({
        value: level.value,
        label: `${level.label} · PAL ${level.pal}`,
    }));

    let foodItems = $derived((data.foodItems ?? []) as FoodItem[]);
    let recentFoodItemIds = $derived((data.recentFoodItemIds ?? []) as string[]);
    let storedMealSlots = $derived((data.mealSlots ?? []) as StoredMealSlot[]);
    let mealSlots = $derived(effectiveMealSlots(storedMealSlots));
    let activeMealSlots = $derived(mealSlots.filter((slot) => !slot.archived));

    // The list keeps its keys while it is open, so its axis is drawn once, from the first load.
    let drawn: EndlessAxis | undefined;
    const axis = $derived(kept.loading ? null : (drawn ??= healthDayAxis(untrack(() => data.today), untrack(() => data.firstLogged))));
    const blocks = new BucketStore<NutritionDay>(dayBlocks(loadNutritionDay), "Could not read Nutrition days");
    let days = $state<ReturnType<typeof HealthDaysList>>();

    // The day at the top edge; the strip, the week panel, and the Log button follow it.
    let visible = $state(untrack(() => routeData.pageResource.data.selectedDate));
    let weekOpen = $state(false);
    /** How far the days sit past the day in view, so the strip follows a swipe. */
    let shift = $state(0);
    const side = new WeekFollower((repositories, date) => loadNutritionSide(repositories, tenant.features, date), "Could not read the Nutrition week");
    let sideRevision = -1;
    $effect(() => {
        const date = visible;
        const revision = kept.revision;
        if (kept.loading) return;
        if (revision !== sideRevision) {
            sideRevision = revision;
            untrack(() => side.refresh(date));
            return;
        }
        // A short pause, so a fast scroll reads the week it stops in, not every week it passes.
        const timer = setTimeout(() => side.follow(date), 120);
        return () => clearTimeout(timer);
    });
    const sideData = $derived(side.get(visible));

    let entryDrawerOpen = $state(false);
    let entryMode = $state<"form" | "scan">("form");
    let goalDrawerOpen = $state(false);
    let slotManagerOpen = $state(false);
    let goalCalculatorOpen = $state(false);
    let goalCalculation = $state<CalorieGoalCalculationResult | null>(null);
    let goalCalculationStale = $state(false);
    let goalPrefilledFromBody = $state(false);
    let editingEntryId = $state<string | null>(null);
    let savingEntry = $state(false);
    let savingGoal = $state(false);
    let entryErrors = $state<Record<string, string>>({});
    // Phones ask for the food, part of day and calories first; the rest folds until asked for or wrong.
    // The phone form layout is the form layout at every width (docs/design-concepts/desktop-backport-2026-10-05).
    const compactForm = true;
    let entryDetailsOpen = $state(false);
    let goalMoreOpen = $state(false);
    $effect(() => { if (!goalDrawerOpen) goalMoreOpen = false; });
    const foldOptional = $derived(
        compactForm && !entryDetailsOpen
            && !entryErrors.quantityG && !entryErrors.proteinG && !entryErrors.carbsG && !entryErrors.fatG,
    );
    $effect(() => { if (!entryDrawerOpen) entryDetailsOpen = false; });
    let goalErrors = $state<Record<string, string>>({});
    let deleteEntry = $state<CalorieEntry | null>(null);
    let handledNewEntryRequest = $state("");
    let foodSearch = $state("");
    let mealManuallyChosen = $state(false);
    let creatingMealSlot = $state(false);
    let newMealSlotLabel = $state("");
    let savingMealSlot = $state(false);
    let selectedFoodId = $state("");
    let selectedExternalImport = $state<ExternalFoodImport | null>(null);
    let externalFoods = $state<KalFood[]>([]);
    let externalLoading = $state(false);
    let externalError = $state("");
    let importingExternalId = $state<string | null>(null);
    let externalRequestId = 0;
    let portionMode = $state<"grams" | "servings">("grams");
    let portionValue = $state<number | null>(null);
    let activeServingIndex = $state(0);
    let servingsRefreshRequestId = 0;
    let nutritionLinked = $state(false);
    let saveAsReusableFood = $state(false);
    let pendingManualEan = $state("");

    let drag = $state<MealDrag>({ entryId: null, active: false, dropDate: null, dropSlotId: null });
    let draggingEntry: CalorieEntry | null = null;
    let dragPointerId: number | null = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPointerX = 0;
    let dragPointerY = 0;
    let dragAutoScrollFrame = 0;

    let entryDraft = $state<CalorieEntryDraft>(emptyEntryDraft());
    let goalDraft = $state<NutritionGoalDraft>(emptyGoalDraft(untrack(() => routeData.pageResource.data.selectedDate), null, null, null));
    let selectedFood = $derived(
        foodItems.find((food) => food.id === selectedFoodId)
            ?? (selectedExternalImport ? externalImportToFoodItem(selectedExternalImport) : null),
    );
    let mealChips = $derived.by(() => {
        const chips = [...activeMealSlots];
        const current = mealSlots.find((slot) => slot.id === entryDraft.mealType);
        if (current?.archived) chips.push(current);
        return chips;
    });
    let selectedServings = $derived.by(() => {
        const food = selectedFood;
        return food ? selectableServings(parseStoredServings(food.source_servings_json)) : [];
    });
    let foodSuggestions = $derived(
        rankFoodItems(foodItems, foodSearch, recentFoodItemIds).slice(0, 6),
    );
    let importedExternalFoods = $derived(externalFoods);

    $effect(() => {
        if (kept.loading) return;
        const query = entryDrawerOpen && !selectedFoodId ? foodSearch.trim() : "";
        const requestId = ++externalRequestId;
        if (query.length < 2) {
            externalFoods = [];
            externalError = "";
            externalLoading = false;
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            externalLoading = true;
            externalError = "";
            void searchKalFoods(query, { signal: controller.signal })
                .then((result) => {
                    if (requestId === externalRequestId) externalFoods = result.items;
                })
                .catch((error) => {
                    if (error instanceof DOMException && error.name === "AbortError") return;
                    if (requestId !== externalRequestId) return;
                    externalFoods = [];
                    externalError = "Online food search is temporarily unavailable.";
                })
                .finally(() => {
                    if (requestId === externalRequestId) externalLoading = false;
                });
        }, 250);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    });

    $effect(() => {
        if (kept.loading) return;
        const requestKey = page.url.searchParams.has("newEntry")
            ? `${page.url.pathname}${page.url.search}`
            : "";
        if (!requestKey) {
            handledNewEntryRequest = "";
            return;
        }
        if (requestKey === handledNewEntryRequest) return;
        const requestedMeal = page.url.searchParams.get("meal") ?? "";
        if (runCommandAction(() => {
            // The address names the day (the Log sheet sends it); the day in view may not have settled yet.
            startCreateEntry(
                activeMealSlots.some((slot) => slot.id === requestedMeal)
                    ? requestedMeal
                    : undefined,
                page.url.searchParams.get("date") || visible,
            );
        })) handledNewEntryRequest = requestKey;
    });

    // Until the user picks a meal by hand, the logged time decides it, so
    // correcting "now" to 08:15 also corrects Snack to Breakfast.
    $effect(() => {
        const loggedAt = entryDraft.loggedAt;
        if (!entryDrawerOpen || mealManuallyChosen) return;
        const inferred = resolveDefaultMeal(mealSlots, loggedAt);
        if (inferred !== entryDraft.mealType) entryDraft.mealType = inferred;
    });

    // Pointer capture can outlive the component on an interrupted gesture.
    $effect(() => () => endDrag());

    function emptyEntryDraft(mealSlotId?: string, date: string = visible): CalorieEntryDraft {
        const loggedAt = date === boundaryToday
            ? toLocalDateTimeString(appClock.now())
            : `${date}T12:00`;
        return {
            name: "",
            calories: null,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            mealType: mealSlotId ?? resolveDefaultMeal(mealSlots, loggedAt),
            loggedAt,
            foodItemId: "",
            quantityG: null,
            portionLabel: "",
            notes: "",
        };
    }

    /**
     * Goals apply from a day onward: `goal` is the one in force there, `sameDateGoal`
     * the one saved for exactly that day, and the weigh-in seeds the calculator.
     */
    function emptyGoalDraft(
        date: string,
        goal: NutritionGoal | null,
        sameDateGoal: NutritionGoal | null,
        latestWeightLog: { weight: number; height: number } | null,
    ): NutritionGoalDraft {
        const profileGoal = sameDateGoal ?? goal;
        const hasSavedProfile = profileGoal?.calculation_method === CALORIE_CALCULATION_METHOD;
        const restoreExactProfile = sameDateGoal !== null && hasSavedProfile;
        const inheritedTargetDate = profileGoal?.calculation_target_date ?? "";
        const targetDate = inheritedTargetDate > date ? inheritedTargetDate : "";
        const source = restoreExactProfile
            ? parseCalorieTargetSource(profileGoal.calorie_target_source)
            : "manual";
        return {
            effectiveFrom: date,
            caloriesTarget: goal?.calories_target ?? null,
            proteinTargetG: goal?.protein_target_g ?? 0,
            carbsTargetG: goal?.carbs_target_g ?? 0,
            fatTargetG: goal?.fat_target_g ?? 0,
            calorieTargetSource: source,
            calculationMethod: hasSavedProfile ? CALORIE_CALCULATION_METHOD : "",
            calculationResult: restoreExactProfile
                ? parseCalculationResult(profileGoal.calculation_result)
                : "",
            calculatedCalories: restoreExactProfile && profileGoal.calculated_calories > 0
                ? profileGoal.calculated_calories
                : null,
            calculationCurrentWeightKg: restoreExactProfile && profileGoal.calculation_current_weight_kg > 0
                ? profileGoal.calculation_current_weight_kg
                : latestWeightLog?.weight ?? (
                    profileGoal && profileGoal.calculation_current_weight_kg > 0
                        ? profileGoal.calculation_current_weight_kg
                        : null
                ),
            calculationTargetWeightKg: profileGoal && profileGoal.calculation_target_weight_kg > 0
                ? profileGoal.calculation_target_weight_kg
                : null,
            calculationHeightCm: restoreExactProfile && profileGoal.calculation_height_cm > 0
                ? profileGoal.calculation_height_cm
                : latestWeightLog?.height ?? (
                    profileGoal && profileGoal.calculation_height_cm > 0
                        ? profileGoal.calculation_height_cm
                        : null
                ),
            calculationAgeYears: profileGoal && profileGoal.calculation_age_years > 0
                ? profileGoal.calculation_age_years
                : null,
            calculationSex: parseCalculationSex(profileGoal?.calculation_sex),
            calculationActivityLevel: parseActivityLevel(profileGoal?.calculation_activity_level),
            calculationTargetDate: restoreExactProfile
                ? profileGoal.calculation_target_date
                : targetDate,
        };
    }

    function parseCalorieTargetSource(value: string | undefined): CalorieTargetSource {
        return value === "calculator" || value === "manual_override" ? value : "manual";
    }

    function parseCalculationResult(value: string | undefined): CalorieCalculationSelection | "" {
        return value === "reach_goal" || value === "target_maintenance" ? value : "";
    }

    function parseCalculationSex(value: string | undefined): CalorieCalculationSex | "" {
        return value === "female" || value === "male" ? value : "";
    }

    function parseActivityLevel(value: string | undefined): CalorieActivityLevel | "" {
        return CALORIE_ACTIVITY_LEVELS.some((level) => level.value === value)
            ? value as CalorieActivityLevel
            : "";
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && drag.active) endDrag();
    }

    /** New entries go through the short form over the page; the full form stays a tap away from it. */
    let quickFood = $state<{ date: string; meal?: string } | null>(null);
    function logFood(mealSlotId?: string, date: string = visible): void {
        quickFood = { date, meal: mealSlotId };
    }

    function startCreateEntry(mealSlotId?: string, date: string = visible) {
        editingEntryId = null;
        entryMode = "form";
        mealManuallyChosen = Boolean(mealSlotId);
        entryDraft = emptyEntryDraft(mealSlotId, date);
        foodSearch = "";
        selectedFoodId = "";
        selectedExternalImport = null;
        importingExternalId = null;
        portionMode = "grams";
        portionValue = null;
        activeServingIndex = 0;
        nutritionLinked = false;
        saveAsReusableFood = false;
        pendingManualEan = "";
        creatingMealSlot = false;
        newMealSlotLabel = "";
        entryErrors = {};
        entryDrawerOpen = true;
    }

    function startEditEntry(entry: CalorieEntry) {
        editingEntryId = entry.id;
        entryMode = "form";
        mealManuallyChosen = true;
        entryDraft = {
            name: entry.name,
            calories: entry.calories,
            proteinG: entry.protein_g,
            carbsG: entry.carbs_g,
            fatG: entry.fat_g,
            mealType: entry.meal_type,
            loggedAt: normalizeLocalDateTime(entry.logged_at),
            foodItemId: entry.food_item_id,
            quantityG: entry.quantity_g || null,
            portionLabel: entry.portion_label,
            notes: entry.notes ?? "",
        };
        foodSearch = "";
        selectedFoodId = entry.food_item_id;
        selectedExternalImport = null;
        portionMode = "grams";
        portionValue = entry.quantity_g || null;
        activeServingIndex = 0;
        nutritionLinked = false;
        saveAsReusableFood = false;
        pendingManualEan = "";
        entryErrors = {};
        entryDrawerOpen = true;
    }

    function closeEntryDrawer() {
        entryDrawerOpen = false;
        entryMode = "form";
        pendingManualEan = "";
        editingEntryId = null;
        entryErrors = {};
        if (!page.url.searchParams.has("newEntry") && !page.url.searchParams.has("meal")) return;
        const next = new URL(page.url);
        next.searchParams.delete("newEntry");
        next.searchParams.delete("meal");
        void goto(`${next.pathname}${next.search}${next.hash}`, {
            replace: true,
            reset: false,
            });
    }

    function selectFood(food: FoodItem) {
        selectedFoodId = food.id;
        selectedExternalImport = null;
        entryDraft.foodItemId = food.id;
        entryDraft.name = food.name;
        foodSearch = "";
        activeServingIndex = 0;
        const name = servingName(food);
        portionMode = name ? "servings" : "grams";
        portionValue = portionMode === "servings" ? 1 : food.default_serving_g;
        nutritionLinked = true;
        saveAsReusableFood = false;
        updatePortion(food);
        void backfillServings(food);
    }

    async function selectExternalFood(
        food: KalFood,
        provenance: { ean?: string; eanConfidence?: KalEanConfidence | "" } = {},
    ) {
        if (importingExternalId) return;
        if (!hasKnownCalories(food)) {
            notify.error("This catalog item has no calorie value to use");
            return;
        }
        const existing = foodItems.find((item) =>
            item.source_provider === KAL_SOURCE_PROVIDER && item.source_id === food.guid);
        if (existing) {
            selectFood(existing);
            return;
        }

        importingExternalId = food.guid;
        try {
            const [metaResult, detailResult] = await Promise.allSettled([
                getKalMeta(),
                getKalFood(food.slug),
            ]);
            const dataVersion = metaResult.status === "fulfilled" ? metaResult.value.dataVersion : "";
            const servings = detailResult.status === "fulfilled" ? detailResult.value.servings : [];
            const imported = toExternalFoodImport(food, { dataVersion, ...provenance, servings });
            const importedFood = externalImportToFoodItem(imported);
            selectedExternalImport = imported;
            selectedFoodId = imported.id;
            entryDraft.foodItemId = imported.id;
            entryDraft.name = imported.name;
            foodSearch = "";
            activeServingIndex = 0;
            const name = servingName(importedFood);
            portionMode = name ? "servings" : "grams";
            portionValue = portionMode === "servings" ? 1 : importedFood.default_serving_g;
            nutritionLinked = true;
            saveAsReusableFood = false;
            updatePortion(importedFood);
        } finally {
            importingExternalId = null;
        }
    }

    /**
     * Backfill serving metadata for foods imported before the source API
     * exposed servings. Never blocks selection; only promotes the refreshed
     * serving when the user has not touched the portion yet.
     */
    async function backfillServings(food: FoodItem) {
        const requestId = ++servingsRefreshRequestId;
        const update = await loadMissingImportedServings(food);
        if (!update) return;
        const untouched = requestId === servingsRefreshRequestId
            && selectedFoodId === food.id
            && portionMode === "grams"
            && portionValue === food.default_serving_g;
        try {
            const event: UpdateFoodItemEvent = {
                id: crypto.randomUUID(),
                type: "FOOD_ITEM_UPDATED",
                timestamp: Date.now(),
                payload: update,
            };
            await executeLocalCommand(event);
            await invalidate("app:foods", "app:calories");
        } catch (error) {
            console.error("Failed to refresh source servings:", error);
            return;
        }
        if (!untouched || update.defaultServingG === undefined) return;
        const refreshed: FoodItem = {
            ...food,
            source_servings_json: update.sourceServingsJson,
            default_serving_g: update.defaultServingG,
            serving_label: update.servingLabel ?? food.serving_label,
        };
        activeServingIndex = 0;
        if (!servingName(refreshed)) return;
        portionMode = "servings";
        portionValue = 1;
        updatePortion(refreshed);
    }

    function useManualEntry() {
        const typedName = foodSearch.trim();
        selectedFoodId = "";
        selectedExternalImport = null;
        entryDraft.foodItemId = "";
        entryDraft.name = typedName || entryDraft.name;
        entryDraft.quantityG = null;
        entryDraft.portionLabel = "";
        portionMode = "grams";
        portionValue = null;
        activeServingIndex = 0;
        nutritionLinked = false;
        saveAsReusableFood = false;
        foodSearch = "";
    }

    function startBarcodeScan() {
        entryMode = "scan";
    }

    function returnFromBarcodeScan(focusId = "food-library-search") {
        entryMode = "form";
        void tick().then(() => document.getElementById(focusId)?.focus());
    }

    function selectScannedLocalFood(food: FoodItem) {
        selectFood(food);
        pendingManualEan = "";
        returnFromBarcodeScan("calorie-entry-quantity");
    }

    async function selectScannedExternalFood(result: KalEanLookupResponse) {
        await selectExternalFood(result.food, {
            ean: result.ean,
            eanConfidence: result.confidence,
        });
        pendingManualEan = "";
        returnFromBarcodeScan("calorie-entry-quantity");
    }

    function searchAfterBarcodeScan() {
        pendingManualEan = "";
        returnFromBarcodeScan();
    }

    function enterManualAfterBarcodeScan(ean: string) {
        useManualEntry();
        pendingManualEan = ean;
        returnFromBarcodeScan("calorie-entry-name");
    }

    /** Selected serving size in grams, or the food's default serving. */
    function servingSize(food: FoodItem | null): number {
        if (!food) return 0;
        const servings = selectableServings(parseStoredServings(food.source_servings_json));
        const serving = servings[activeServingIndex];
        return serving ? servingGrams(serving) : food.default_serving_g;
    }

    /** Name of the selected serving, falling back to the food's own label. */
    function servingName(food: FoodItem | null): string | null {
        if (!food) return null;
        const servings = selectableServings(parseStoredServings(food.source_servings_json));
        const serving = servings[activeServingIndex];
        return serving ? servingLabel(serving) : specificServingLabel(food);
    }

    function selectActiveServing(value: string) {
        const index = Number(value);
        if (!selectedServings[index]) return;
        activeServingIndex = index;
        updatePortion();
    }

    function setPortionMode(mode: "grams" | "servings") {
        if (!selectedFood) return;
        const size = servingSize(selectedFood);
        if (mode === "servings" && (!servingName(selectedFood) || size <= 0)) return;
        portionMode = mode;
        portionValue = mode === "servings"
            ? Number(((entryDraft.quantityG || size) / size).toFixed(2))
            : entryDraft.quantityG || size;
        updatePortion();
    }

    function updatePortion(food: FoodItem | null = selectedFood) {
        const value = Number(portionValue ?? 0);
        if (!Number.isFinite(value) || value <= 0) {
            entryDraft.quantityG = null;
            entryDraft.portionLabel = "";
            return;
        }
        const name = servingName(food);
        const size = servingSize(food);
        const useServings = Boolean(food && portionMode === "servings" && name && size > 0);
        const quantityG = useServings ? value * size : value;
        entryDraft.quantityG = Number(quantityG.toFixed(1));
        entryDraft.portionLabel = useServings && name
            ? `${value} × ${name}`
            : `${Number(quantityG.toFixed(1))} g`;
        if (food && nutritionLinked) applySelectedFoodNutrition(food);
    }

    function handlePortionInput(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        portionValue = Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber;
        updatePortion();
    }

    function handleManualQuantityInput(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        entryDraft.quantityG = Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber;
        entryDraft.portionLabel = entryDraft.quantityG ? `${entryDraft.quantityG} g` : "";
    }

    function applySelectedFoodNutrition(food: FoodItem | null = selectedFood) {
        if (!food || !entryDraft.quantityG) return;
        const calculated = calculateNutritionForQuantity(food, entryDraft.quantityG);
        entryDraft.calories = calculated.calories;
        entryDraft.proteinG = calculated.proteinG;
        entryDraft.carbsG = calculated.carbsG;
        entryDraft.fatG = calculated.fatG;
    }

    function relinkNutrition() {
        nutritionLinked = true;
        applySelectedFoodNutrition();
    }

    async function saveEntry(event: SubmitEvent) {
        event.preventDefault();
        if (savingEntry) return;
        entryErrors = validateCalorieEntryDraft(entryDraft);
        if (saveAsReusableFood && (!entryDraft.quantityG || entryDraft.quantityG <= 0)) {
            entryErrors.quantityG = "Enter the quantity represented by this nutrition.";
        }
        if (Object.keys(entryErrors).length > 0) return;

        savingEntry = true;
        const payload = {
            name: entryDraft.name.trim(),
            calories: Number(entryDraft.calories),
            proteinG: Number(entryDraft.proteinG ?? 0),
            carbsG: Number(entryDraft.carbsG ?? 0),
            fatG: Number(entryDraft.fatG ?? 0),
            mealType: entryDraft.mealType,
            loggedAt: normalizeLocalDateTime(entryDraft.loggedAt),
            foodItemId: entryDraft.foodItemId,
            quantityG: Number(entryDraft.quantityG ?? 0),
            portionLabel: entryDraft.portionLabel,
            notes: entryDraft.notes.trim(),
        };

        try {
            if (editingEntryId) {
                const updateEvent: UpdateCalorieEntryEvent = {
                    id: crypto.randomUUID(),
                    type: "CALORIE_ENTRY_UPDATED",
                    timestamp: Date.now(),
                    payload: { id: editingEntryId, ...payload },
                };
                await executeLocalCommand(updateEvent);
                notify.success("Food entry updated");
            } else {
                const entryId = crypto.randomUUID();
                const addEvent: AddCalorieEntryEvent = {
                    id: crypto.randomUUID(),
                    type: "CALORIE_ENTRY_ADDED",
                    timestamp: Date.now(),
                    payload: { id: entryId, ...payload },
                };
                if (selectedExternalImport) {
                    const foodEvent: AddFoodItemEvent = {
                        id: crypto.randomUUID(),
                        type: "FOOD_ITEM_ADDED",
                        timestamp: Date.now(),
                        payload: {
                            ...selectedExternalImport,
                        },
                    };
                    await executeLocalCommand([foodEvent, addEvent]);
                    notify.success("Food imported and saved to the diary");
                } else if (saveAsReusableFood && !entryDraft.foodItemId && entryDraft.quantityG) {
                    const foodItemId = crypto.randomUUID();
                    const per100g = calculatePer100gFromEntry(
                        {
                            calories: Number(entryDraft.calories),
                            proteinG: Number(entryDraft.proteinG ?? 0),
                            carbsG: Number(entryDraft.carbsG ?? 0),
                            fatG: Number(entryDraft.fatG ?? 0),
                        },
                        entryDraft.quantityG,
                    );
                    const foodEvent: AddFoodItemEvent = {
                        id: crypto.randomUUID(),
                        type: "FOOD_ITEM_ADDED",
                        timestamp: Date.now(),
                        payload: {
                            id: foodItemId,
                            name: entryDraft.name.trim(),
                            brand: "",
                            caloriesPer100g: per100g.calories,
                            proteinPer100g: per100g.proteinG,
                            carbsPer100g: per100g.carbsG,
                            fatPer100g: per100g.fatG,
                            defaultServingG: entryDraft.quantityG,
                            servingLabel: entryDraft.portionLabel,
                            favorite: false,
                            sourceProvider: "manual",
                            sourceId: "",
                            sourceSlug: "",
                            sourceDataVersion: "",
                            sourceMissingNutrients: "",
                            sourceEan: pendingManualEan,
                            sourceEanConfidence: "",
                            sourceServingsJson: "[]",
                        },
                    };
                    addEvent.payload.foodItemId = foodItemId;
                    await executeLocalCommand([foodEvent, addEvent]);
                    notify.success("Food saved to the library and diary");
                } else {
                    await executeLocalCommand(addEvent);
                    notify.success("Food entry saved");
                }
            }
            closeEntryDrawer();
            await invalidate("app:calories");
            if (saveAsReusableFood) await invalidate("app:foods");
        } catch (error) {
            console.error("Failed to save calorie entry:", error);
            notify.error("Could not save the food entry");
        } finally {
            savingEntry = false;
        }
    }

    async function openGoalDrawer(date: string = visible) {
        const [goal, sameDateGoal, latestWeightLog] = await queryDatabase((repositories) => Promise.all([
            repositories.calories.getLatestNutritionGoal(date),
            repositories.calories.getNutritionGoalForDate(date),
            isFeatureEnabled("bmi") ? repositories.weightLogs.getLatestWeightLog(date) : null,
        ]));
        goalDraft = emptyGoalDraft(date, goal, sameDateGoal, latestWeightLog);
        goalPrefilledFromBody = latestWeightLog !== null;
        goalCalculatorOpen = goalDraft.calculationMethod === CALORIE_CALCULATION_METHOD;
        goalCalculation = null;
        goalCalculationStale = false;
        goalErrors = {};
        goalDrawerOpen = true;
        if (goalCalculatorOpen) calculateGoalEstimates();
    }

    function calculationInput() {
        return {
            effectiveFrom: goalDraft.effectiveFrom,
            targetDate: goalDraft.calculationTargetDate,
            currentWeightKg: goalDraft.calculationCurrentWeightKg ?? Number.NaN,
            targetWeightKg: goalDraft.calculationTargetWeightKg ?? Number.NaN,
            heightCm: goalDraft.calculationHeightCm ?? Number.NaN,
            ageYears: goalDraft.calculationAgeYears ?? Number.NaN,
            sex: goalDraft.calculationSex || undefined,
            activityLevel: goalDraft.calculationActivityLevel || undefined,
        };
    }

    function withoutCalculationErrors(errors: Record<string, string>): Record<string, string> {
        const next = { ...errors };
        for (const key of [
            "currentWeightKg",
            "targetWeightKg",
            "heightCm",
            "ageYears",
            "sex",
            "activityLevel",
            "targetDate",
            "calculationMethod",
            "calculationResult",
            "calculatedCalories",
        ]) delete next[key];
        return next;
    }

    function calculateGoalEstimates() {
        const input = calculationInput();
        const errors = validateCalorieGoalCalculationInput(input);
        goalErrors = { ...withoutCalculationErrors(goalErrors), ...errors };
        if (Object.keys(errors).length > 0) {
            goalCalculation = null;
            goalCalculationStale = true;
            return;
        }
        goalCalculation = calculateCalorieGoal(input as Parameters<typeof calculateCalorieGoal>[0]);
        goalDraft.calculationMethod = CALORIE_CALCULATION_METHOD;
        goalCalculationStale = false;

        if (goalDraft.calculationResult) {
            const calculated = goalDraft.calculationResult === "reach_goal"
                ? goalCalculation.reachGoalCalories
                : goalCalculation.targetMaintenanceCalories;
            goalDraft.calculatedCalories = calculated;
            goalDraft.calorieTargetSource = calculated !== null
                && Number(goalDraft.caloriesTarget) === calculated
                ? "calculator"
                : "manual_override";
        }
    }

    function markCalculationProfileChanged() {
        goalCalculation = null;
        goalCalculationStale = true;
        goalErrors = withoutCalculationErrors(goalErrors);
        if (goalDraft.calorieTargetSource === "calculator") {
            goalDraft.calorieTargetSource = "manual_override";
        }
    }

    function setCalculationSex(value: string) {
        goalDraft.calculationSex = parseCalculationSex(value);
        markCalculationProfileChanged();
    }

    function setCalculationActivity(value: string) {
        goalDraft.calculationActivityLevel = parseActivityLevel(value);
        markCalculationProfileChanged();
    }

    function applyGoalEstimate(selection: CalorieCalculationSelection) {
        if (!goalCalculation) return;
        const calories = selection === "reach_goal"
            ? goalCalculation.reachGoalCalories
            : goalCalculation.targetMaintenanceCalories;
        if (calories === null) return;
        goalDraft.caloriesTarget = calories;
        goalDraft.calorieTargetSource = "calculator";
        goalDraft.calculationMethod = CALORIE_CALCULATION_METHOD;
        goalDraft.calculationResult = selection;
        goalDraft.calculatedCalories = calories;
        goalCalculationStale = false;
        goalErrors = withoutCalculationErrors(goalErrors);
    }

    function markDailyCaloriesManual() {
        if (goalDraft.calorieTargetSource === "calculator") {
            goalDraft.calorieTargetSource = "manual_override";
        }
    }

    function clearGoalCalculator() {
        goalCalculatorOpen = false;
        goalCalculation = null;
        goalCalculationStale = false;
        goalDraft.calorieTargetSource = "manual";
        goalDraft.calculationMethod = "";
        goalDraft.calculationResult = "";
        goalDraft.calculatedCalories = null;
        goalDraft.calculationCurrentWeightKg = null;
        goalDraft.calculationTargetWeightKg = null;
        goalDraft.calculationHeightCm = null;
        goalDraft.calculationAgeYears = null;
        goalDraft.calculationSex = "";
        goalDraft.calculationActivityLevel = "";
        goalDraft.calculationTargetDate = "";
        goalErrors = withoutCalculationErrors(goalErrors);
    }

    async function saveGoal(event: SubmitEvent) {
        event.preventDefault();
        if (savingGoal) return;
        goalErrors = validateNutritionGoalDraft(goalDraft);
        if (goalDraft.calorieTargetSource !== "manual" && goalCalculationStale) {
            goalErrors.calculatedCalories = "Recalculate the estimate after changing its profile.";
        }
        if (Object.keys(goalErrors).length > 0) return;

        savingGoal = true;
        const sameDateGoal = await queryDatabase((repositories) =>
            repositories.calories.getNutritionGoalForDate(goalDraft.effectiveFrom),
        );
        const payload = {
            effectiveFrom: goalDraft.effectiveFrom,
            caloriesTarget: Number(goalDraft.caloriesTarget),
            proteinTargetG: Number(goalDraft.proteinTargetG ?? 0),
            carbsTargetG: Number(goalDraft.carbsTargetG ?? 0),
            fatTargetG: Number(goalDraft.fatTargetG ?? 0),
            calorieTargetSource: goalDraft.calorieTargetSource,
            calculationMethod: goalDraft.calorieTargetSource === "manual"
                ? ""
                : goalDraft.calculationMethod,
            calculationResult: goalDraft.calorieTargetSource === "manual"
                ? ""
                : goalDraft.calculationResult,
            calculatedCalories: goalDraft.calorieTargetSource === "manual"
                ? 0
                : Number(goalDraft.calculatedCalories ?? 0),
            calculationCurrentWeightKg: goalDraft.calorieTargetSource === "manual"
                ? 0
                : Number(goalDraft.calculationCurrentWeightKg ?? 0),
            calculationTargetWeightKg: goalDraft.calorieTargetSource === "manual"
                ? 0
                : Number(goalDraft.calculationTargetWeightKg ?? 0),
            calculationHeightCm: goalDraft.calorieTargetSource === "manual"
                ? 0
                : Number(goalDraft.calculationHeightCm ?? 0),
            calculationAgeYears: goalDraft.calorieTargetSource === "manual"
                ? 0
                : Number(goalDraft.calculationAgeYears ?? 0),
            calculationSex: goalDraft.calorieTargetSource === "manual"
                ? ""
                : goalDraft.calculationSex,
            calculationActivityLevel: goalDraft.calorieTargetSource === "manual"
                ? ""
                : goalDraft.calculationActivityLevel,
            calculationTargetDate: goalDraft.calorieTargetSource === "manual"
                ? ""
                : goalDraft.calculationTargetDate,
        };

        try {
            if (sameDateGoal) {
                const updateEvent: UpdateNutritionGoalEvent = {
                    id: crypto.randomUUID(),
                    type: "NUTRITION_GOAL_UPDATED",
                    timestamp: Date.now(),
                    payload: { id: sameDateGoal.id, ...payload },
                };
                await executeLocalCommand(updateEvent);
            } else {
                const addEvent: AddNutritionGoalEvent = {
                    id: crypto.randomUUID(),
                    type: "NUTRITION_GOAL_ADDED",
                    timestamp: Date.now(),
                    payload: { id: crypto.randomUUID(), ...payload },
                };
                await executeLocalCommand(addEvent);
            }
            goalDrawerOpen = false;
            notify.success("Nutrition goals saved");
            await invalidate("app:calories");
        } catch (error) {
            console.error("Failed to save nutrition goal:", error);
            notify.error("Could not save nutrition goals");
        } finally {
            savingGoal = false;
        }
    }

    async function removeEntry() {
        if (!deleteEntry) return;
        const entryId = deleteEntry.id;
        deleteEntry = null;
        try {
            const removeEvent: RemoveCalorieEntryEvent = {
                id: crypto.randomUUID(),
                type: "CALORIE_ENTRY_REMOVED",
                timestamp: Date.now(),
                payload: { id: entryId },
            };
            await executeLocalCommand(removeEvent);
            notify.success("Food entry removed");
            await invalidate("app:calories");
        } catch (error) {
            console.error("Failed to remove calorie entry:", error);
            notify.error("Could not remove the food entry");
        }
    }

    function selectMealSlot(slotId: string) {
        entryDraft.mealType = slotId;
        mealManuallyChosen = true;
    }

    function openSlotManager() {
        slotManagerOpen = true;
    }

    function closeSlotManager() {
        slotManagerOpen = false;
    }

    async function createMealSlot(): Promise<void> {
        const label = newMealSlotLabel.trim();
        if (!label || savingMealSlot) return;
        savingMealSlot = true;
        const slotId = crypto.randomUUID();
        const sortOrder = await queryDatabase((repositories) =>
            repositories.calories.getMaxMealSlotSortOrder(),
        ) + 1;
        try {
            await commitMealSlotEvents([
                ...mealSlotBootstrapEvents(storedMealSlots),
                mealSlotAddEvent(label, sortOrder, slotId),
            ]);
            entryDraft.mealType = slotId;
            mealManuallyChosen = true;
            creatingMealSlot = false;
            newMealSlotLabel = "";
            notify.success(`“${label}” added`);
        } catch (error) {
            console.error("Failed to add meal slot:", error);
            notify.error("Could not add the meal slot");
        } finally {
            savingMealSlot = false;
        }
    }

    async function runEntryUpdate(
        entry: CalorieEntry,
        changes: { mealType?: string; loggedAt?: string },
        message: string,
    ): Promise<void> {
        try {
            const event: UpdateCalorieEntryEvent = {
                id: crypto.randomUUID(),
                type: "CALORIE_ENTRY_UPDATED",
                timestamp: Date.now(),
                payload: { id: entry.id, ...changes },
            };
            await executeLocalCommand(event);
            await invalidate("app:calories");
            notify.success(message);
        } catch (error) {
            console.error("Failed to update calorie entry:", error);
            notify.error("Could not update the food entry");
        }
    }

    async function moveEntryToMeal(entry: CalorieEntry, slotId: string) {
        const slot = mealSlots.find((candidate) => candidate.id === slotId);
        if (!slot || slot.id === entry.meal_type) return;
        await runEntryUpdate(
            entry,
            { mealType: slotId },
            `Moved to ${slot.label}`,
        );
    }

    async function moveEntryByDays(entry: CalorieEntry, days: number) {
        await runEntryUpdate(
            entry,
            { loggedAt: shiftLoggedAt(entry.logged_at, days) },
            days < 0 ? "Moved to the previous day" : "Moved to the next day",
        );
    }

    async function duplicateEntry(entry: CalorieEntry) {
        const id = crypto.randomUUID();
        try {
            const event: AddCalorieEntryEvent = {
                id: crypto.randomUUID(),
                type: "CALORIE_ENTRY_ADDED",
                timestamp: Date.now(),
                payload: {
                    id,
                    name: entry.name,
                    calories: entry.calories,
                    proteinG: entry.protein_g,
                    carbsG: entry.carbs_g,
                    fatG: entry.fat_g,
                    mealType: entry.meal_type,
                    loggedAt: entry.logged_at,
                    foodItemId: entry.food_item_id,
                    quantityG: entry.quantity_g,
                    portionLabel: entry.portion_label,
                    notes: entry.notes ?? "",
                },
            };
            await executeLocalCommand(event);
            await invalidate("app:calories");
            notify.success(`Duplicated “${entry.name}”`);
        } catch (error) {
            console.error("Failed to duplicate calorie entry:", error);
            notify.error("Could not duplicate the food entry");
        }
    }

    async function copyMealFromYesterday(slot: MealSlotView, date: string) {
        const source = await queryDatabase((repositories) =>
            repositories.calories.getCalorieEntriesForDate(shiftLocalDate(date, -1), slot.id),
        );
        if (source.length === 0) return;
        try {
            const events = source.map((entry): AddCalorieEntryEvent => {
                const id = crypto.randomUUID();
                return {
                    id: crypto.randomUUID(),
                    type: "CALORIE_ENTRY_ADDED",
                    timestamp: Date.now(),
                    payload: {
                        id,
                        name: entry.name,
                        calories: entry.calories,
                        proteinG: entry.protein_g,
                        carbsG: entry.carbs_g,
                        fatG: entry.fat_g,
                        mealType: entry.meal_type,
                        loggedAt: loggedAtOnDate(entry.logged_at, date),
                        foodItemId: entry.food_item_id,
                        quantityG: entry.quantity_g,
                        portionLabel: entry.portion_label,
                        notes: entry.notes ?? "",
                    },
                };
            });
            await executeLocalCommand(events);
            await invalidate("app:calories");
            notify.success(`Copied ${source.length} ${source.length === 1 ? "entry" : "entries"} into ${slot.label}`);
        } catch (error) {
            console.error("Failed to copy yesterday's meal:", error);
            notify.error("Could not copy yesterday's meal");
        }
    }

    function handleDragPointerDown(event: PointerEvent, entry: CalorieEntry) {
        if (event.button !== 0 || drag.active) return;
        dragPointerId = event.pointerId;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragPointerX = event.clientX;
        dragPointerY = event.clientY;
        draggingEntry = entry;
        drag.entryId = entry.id;
        if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        window.addEventListener("pointermove", handleDragPointerMove);
        window.addEventListener("pointerup", handleDragPointerUp);
        window.addEventListener("pointercancel", handleDragPointerUp);
    }

    function handleDragPointerMove(event: PointerEvent) {
        if (event.pointerId !== dragPointerId || !draggingEntry) return;
        if (!drag.active) {
            const distance = Math.hypot(
                event.clientX - dragStartX,
                event.clientY - dragStartY,
            );
            if (distance < 6) return;
            drag.active = true;
            startDragAutoScroll();
        }
        dragPointerX = event.clientX;
        dragPointerY = event.clientY;
        updateDropTarget();
    }

    function handleDragPointerUp(event: PointerEvent) {
        if (event.pointerId !== dragPointerId) return;
        const entry = draggingEntry;
        const targetSlotId = drag.dropSlotId;
        const wasDragging = drag.active;
        endDrag();
        if (wasDragging && entry && targetSlotId) {
            void moveEntryToMeal(entry, targetSlotId);
        }
    }

    function updateDropTarget() {
        const element = document.elementFromPoint(dragPointerX, dragPointerY);
        const dropzone = element?.closest<HTMLElement>("[data-meal-drop]");
        const slotId = dropzone?.dataset.mealDrop ?? null;
        // Another day's meals are not a target: a drop changes the meal, never the day.
        const sameDay = dropzone?.dataset.mealDay === draggingEntry?.logged_at.slice(0, 10);
        const landing = slotId && sameDay && slotId !== draggingEntry?.meal_type;
        drag.dropDate = landing ? dropzone?.dataset.mealDay ?? null : null;
        drag.dropSlotId = landing ? slotId : null;
    }

    function startDragAutoScroll() {
        stopDragAutoScroll();
        const tick = () => {
            if (!drag.active) return;
            const margin = 72;
            if (dragPointerY < margin) {
                window.scrollBy(0, -Math.ceil((margin - dragPointerY) / 4));
                updateDropTarget();
            } else if (window.innerHeight - dragPointerY < margin) {
                window.scrollBy(
                    0,
                    Math.ceil((margin - (window.innerHeight - dragPointerY)) / 4),
                );
                updateDropTarget();
            }
            dragAutoScrollFrame = window.requestAnimationFrame(tick);
        };
        dragAutoScrollFrame = window.requestAnimationFrame(tick);
    }

    function stopDragAutoScroll() {
        if (dragAutoScrollFrame) window.cancelAnimationFrame(dragAutoScrollFrame);
        dragAutoScrollFrame = 0;
    }

    function endDrag() {
        window.removeEventListener("pointermove", handleDragPointerMove);
        window.removeEventListener("pointerup", handleDragPointerUp);
        window.removeEventListener("pointercancel", handleDragPointerUp);
        stopDragAutoScroll();
        draggingEntry = null;
        drag.entryId = null;
        drag.dropDate = null;
        drag.dropSlotId = null;
        drag.active = false;
        dragPointerId = null;
    }

    function formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
        const [year, month, day] = value.split("-").map(Number);
        return new Intl.DateTimeFormat("en-US", options).format(
            new Date(year, month - 1, day, 12, 0, 0),
        );
    }

    function formatNumber(value: number): string {
        return formatCount(value, 1);
    }

</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
    <title>Nutrition | Health | {tenant.title}</title>
</svelte:head>

<PageDataStatus {resource} />

<HealthDaysShell
    active="nutrition"
    date={visible}
    today={boundaryToday}
    week={sideData?.week ?? emptyHealthWeek(visible)}
    targets={sideData?.targets ?? { calories: 0, steps: 0 }}
    sources={data.sources}
    onNavigate={(date) => days?.goTo(date, "smooth")}
    {shift}
    bind:weekOpen
>
    {#snippet action()}
        <CommandOnly>
            <Button onclick={() => startCreateEntry()} disabled={savingEntry}>
                <IconPlus class="h-4 w-4" />
                Log food
            </Button>
        </CommandOnly>
    {/snippet}
    {#snippet list()}
        {#if axis}
            <HealthDaysList
                bind:this={days}
                bind:visible
                bind:shift
                {axis}
                store={blocks}
                today={boundaryToday}
                opening={data.selectedDate}
                revision={kept.revision}
                blocked={entryDrawerOpen || goalDrawerOpen || slotManagerOpen || deleteEntry !== null || weekOpen}
                label="Nutrition days"
            >
                {#snippet block(date, day)}
                    <NutritionDayBlock
                        {date}
                        inView={date === visible}
                        today={boundaryToday}
                        {day}
                        {mealSlots}
                        {drag}
                        onLog={(logDate, mealSlotId) => logFood(mealSlotId, logDate)}
                        onEdit={startEditEntry}
                        onDelete={(entry) => (deleteEntry = entry)}
                        onMove={(entry, slotId) => void moveEntryToMeal(entry, slotId)}
                        onMoveDay={(entry, days) => void moveEntryByDays(entry, days)}
                        onDuplicate={(entry) => void duplicateEntry(entry)}
                        onCopyYesterday={(slot, copyDate) => void copyMealFromYesterday(slot, copyDate)}
                        onDragStart={handleDragPointerDown}
                        onEditGoals={(goalDate) => void openGoalDrawer(goalDate)}
                        onEditMeals={openSlotManager}
                        onWeek={() => (weekOpen = true)}
                    />
                {/snippet}
            </HealthDaysList>
        {:else}
            <DataPlaceholder rows={6} label="Loading days" />
        {/if}
    {/snippet}
    {#snippet aside()}
        <NutritionWeekPanel
            week={sideData?.week ?? emptyHealthWeek(visible)}
            selected={visible}
            today={boundaryToday}
            target={sideData?.goal?.calories_target ?? 0}
            proteinTarget={sideData?.goal?.protein_target_g ?? 0}
            averageCalories={sideData?.trend.averageCalories ?? 0}
            averageProteinG={sideData?.trend.averageProteinG ?? 0}
            trackedDays={sideData?.trend.trackedDays ?? 0}
            loading={sideData === undefined}
        />
    {/snippet}
</HealthDaysShell>

<QuickFoodLog show={quickFood !== null} date={quickFood?.date ?? visible} today={boundaryToday} mealSlots={storedMealSlots} meal={quickFood?.meal} onClose={() => (quickFood = null)} />

<MobilePageAction hideWhenModalOpen isModalOpen={entryDrawerOpen || goalDrawerOpen || quickFood !== null}>
    <Button class="h-12 w-full text-[15px]" onclick={() => logFood()} disabled={savingEntry}>
        <IconPlus class="h-5 w-5" /> <span class="stor-action-label">{savingEntry ? "Saving…" : "Log food"}</span>
    </Button>
</MobilePageAction>

<CommandDrawer
    show={entryDrawerOpen}
    title={entryMode === "scan" ? "Scan food barcode" : editingEntryId ? "Edit food entry" : "Log food"}
    description={entryMode === "scan"
        ? "Find a packaged food without uploading camera images."
        : compactForm ? undefined : "Calories are entered directly; macros are optional estimates."}
    onClose={closeEntryDrawer}
>
    {#if entryMode === "scan"}
        <FoodBarcodeScanner
            purpose="log"
            localFoods={foodItems}
            onSelectLocal={selectScannedLocalFood}
            onSelectExternal={selectScannedExternalFood}
            onSearchByName={searchAfterBarcodeScan}
            onManualFood={enterManualAfterBarcodeScan}
            onCancel={() => returnFromBarcodeScan("scan-food-barcode")}
        />
    {:else}
    <form class="space-y-4" onsubmit={saveEntry}>
        {#if pendingManualEan && !editingEntryId}
            <div class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p class="text-xs font-semibold uppercase tracking-wide text-amber-800">Unmatched barcode</p>
                <p class="mt-1 text-sm tabular-nums text-[var(--stor-muted-text)]">{pendingManualEan}</p>
                <p class="mt-1 text-xs text-[var(--stor-muted-text)]">Enter nutrition manually. Save it as reusable to recognize this barcode offline next time.</p>
            </div>
        {/if}
        <div class="rounded-xl bg-[var(--stor-surface-muted)] p-3">
            {#if selectedFood}
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">
                            {selectedFood.source_provider === KAL_SOURCE_PROVIDER ? "From Kalorické tabulky" : "From food library"}
                        </div>
                        <div class="mt-1 font-semibold text-[var(--stor-ink)]">{selectedFood.name}</div>
                        {#if selectedFood.brand}<div class="text-xs text-[var(--stor-muted-text)]">{selectedFood.brand}</div>{/if}
                        {#if selectedFood.source_missing_nutrients && selectedFood.source_missing_nutrients !== "[]"}
                            <div class="mt-1 text-xs text-amber-700">Some source nutrition values are unavailable.</div>
                        {/if}
                    </div>
                    <Button variant="ghost" size="sm" onclick={useManualEntry}>Change</Button>
                </div>
            {:else}
                <Field label="Find a food" htmlFor="food-library-search" hint="Local foods appear first; online catalog search needs a connection.">
                    <div class="flex gap-2">
                        <Input id="food-library-search" bind:value={foodSearch} placeholder="Search reusable foods or online catalog" />
                        <Button id="scan-food-barcode" variant="secondary" class="shrink-0" onclick={startBarcodeScan} aria-label="Scan food barcode">
                            <IconBarcodeScan class="h-4 w-4" />
                            <span class="hidden sm:inline">Scan</span>
                        </Button>
                    </div>
                </Field>
                {#if foodSuggestions.length > 0}
                    <div class="mt-3 max-h-48 space-y-1 overflow-y-auto">
                        {#each foodSuggestions as food (food.id)}
                            <button
                                type="button"
                                class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[var(--stor-surface-muted)]"
                                onclick={() => selectFood(food)}
                            >
                                <span class="min-w-0">
                                    <span class="block truncate text-sm font-semibold text-[var(--stor-ink)]">{food.name}</span>
                                    {#if food.brand}<span class="block truncate text-xs text-[var(--stor-muted-text)]">{food.brand}</span>{/if}
                                </span>
                                <span class="shrink-0 text-xs tabular-nums text-[var(--stor-muted-text)]"><DataValue>{formatNumber(food.calories_per_100g)}</DataValue> kcal / 100g</span>
                            </button>
                        {/each}
                    </div>
                {/if}
                {#if foodSearch.trim().length >= 2}
                    <div class="mt-4 border-t border-stone-200 pt-3">
                        <div class="flex items-baseline justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Online catalog</div>
                            {#if externalLoading}<span class="text-xs text-sky-700">Searching…</span>{/if}
                        </div>
                        {#if externalError}
                            <p class="mt-2 text-xs text-amber-800">{externalError}</p>
                        {:else if !externalLoading && importedExternalFoods.length === 0}
                            <p class="mt-2 text-xs text-[var(--stor-muted-text)]">No online food matched this search.</p>
                        {:else}
                            <div class="mt-2 max-h-48 space-y-1 overflow-y-auto">
                                {#each importedExternalFoods as food (food.guid)}
                                    {@const localFood = foodItems.find((item) => item.source_provider === KAL_SOURCE_PROVIDER && item.source_id === food.guid)}
                                    <button
                                        type="button"
                                        class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[var(--stor-surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                                        disabled={importingExternalId === food.guid || !hasKnownCalories(food)}
                                        onclick={() => void selectExternalFood(food)}
                                    >
                                        <span class="min-w-0">
                                            <span class="block truncate text-sm font-semibold text-[var(--stor-ink)]">{food.name}</span>
                                            {#if food.brand}<span class="block truncate text-xs text-[var(--stor-muted-text)]">{food.brand}</span>{/if}
                                            <span class="block text-xs tabular-nums text-[var(--stor-muted-text)]">
                                                <DataValue>{food.energyKcal === null ? "Calories unavailable" : `${formatNumber(food.energyKcal)} kcal / 100g`}</DataValue>
                                                · P <DataValue>{food.proteinG === null ? "—" : formatNumber(food.proteinG)}</DataValue>g
                                                · C <DataValue>{food.carbsG === null ? "—" : formatNumber(food.carbsG)}</DataValue>g
                                                · F <DataValue>{food.fatG === null ? "—" : formatNumber(food.fatG)}</DataValue>g
                                            </span>
                                        </span>
                                        <span class="shrink-0 text-xs font-semibold text-sky-700">
                                            {#if importingExternalId === food.guid}Loading…{:else if !hasKnownCalories(food)}Unavailable{:else if localFood}Use saved{:else}Use{/if}
                                        </span>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}
                {#if foodSearch.trim()}
                    <button type="button" class="mt-3 text-sm font-semibold text-[var(--stor-muted-text)] underline decoration-stone-300 underline-offset-4" onclick={useManualEntry}>
                        Use “{foodSearch.trim()}” as a manual entry
                    </button>
                {:else if foodItems.length === 0}
                    <p class="mt-3 text-xs text-[var(--stor-muted-text)]">
                        Your library is empty. Continue manually or
                        <a href={contextualHref('/calories/foods')} class="font-semibold text-[var(--stor-ink)] underline underline-offset-2">add reusable foods</a>.
                    </p>
                {/if}
            {/if}
        </div>

        <Field label="Food" htmlFor="calorie-entry-name" required error={entryErrors.name}>
            <Input id="calorie-entry-name" bind:value={entryDraft.name} placeholder="e.g. Greek yogurt with fruit" disabled={Boolean(selectedFood)} />
        </Field>
        {#if selectedFood}
            {@const selectedServingName = servingName(selectedFood)}
            {@const selectedServingIsVolume = portionMode === "servings" && selectedServings[activeServingIndex]?.unit === "ml"}
            <div class={selectedServingName ? "grid grid-cols-[auto_minmax(0,1fr)] gap-3" : ""}>
                {#if selectedServingName}
                    <div class="flex rounded-xl bg-[var(--stor-surface-muted)] p-1">
                        <button type="button" class="rounded-lg px-3 py-2 text-xs font-semibold {portionMode === 'grams' ? 'bg-[var(--stor-surface-raised)] text-[var(--stor-ink)] shadow-[var(--stor-shadow-sm)]' : 'text-[var(--stor-muted-text)]'}" onclick={() => setPortionMode("grams")}>Grams</button>
                        <button type="button" class="max-w-32 rounded-lg px-3 py-2 text-xs font-semibold {portionMode === 'servings' ? 'bg-[var(--stor-surface-raised)] text-[var(--stor-ink)] shadow-[var(--stor-shadow-sm)]' : 'text-[var(--stor-muted-text)]'}" onclick={() => setPortionMode("servings")}>{selectedServingName}</button>
                    </div>
                {/if}
                <Field label={portionMode === "grams" ? "Quantity (grams)" : `${selectedServingName ?? "Serving"} count`} htmlFor="calorie-entry-quantity" error={entryErrors.quantityG}>
                    <Input id="calorie-entry-quantity" type="number" min="0" step="0.1" value={portionValue ?? ""} oninput={handlePortionInput} />
                </Field>
            </div>
            {#if portionMode === "servings" && selectedServings.length > 1}
                <Field label="Serving size" htmlFor="calorie-entry-serving">
                    <Select
                        id="calorie-entry-serving"
                        value={String(activeServingIndex)}
                        options={selectedServings.map((serving, index) => ({
                            value: String(index),
                            label: servingOptionLabel(serving),
                        }))}
                        onValueChange={selectActiveServing}
                    />
                </Field>
            {/if}
            <p class="-mt-2 text-xs text-[var(--stor-muted-text)]">
                {entryDraft.portionLabel || "Enter a portion"}<DataValue>{entryDraft.quantityG ? ` · ${selectedServingIsVolume ? "≈ " : ""}${formatNumber(entryDraft.quantityG)} g total` : ""}</DataValue>
            </p>
        {:else if !foldOptional}
            <Field label="Quantity" htmlFor="calorie-entry-quantity" hint="Optional, but required to save this as a reusable food." error={entryErrors.quantityG}>
                <Input
                    id="calorie-entry-quantity"
                    type="number"
                    min="0"
                    step="0.1"
                    value={entryDraft.quantityG ?? ""}
                    placeholder="grams"
                    oninput={handleManualQuantityInput}
                />
            </Field>
        {/if}
        <Field label="Part of day" required error={entryErrors.mealType}>
            <div class="flex flex-wrap items-center gap-1.5">
                {#each mealChips as slot (slot.id)}
                    <button
                        type="button"
                        aria-pressed={entryDraft.mealType === slot.id}
                        class="h-11 rounded-full px-3 text-sm font-semibold transition sm:h-9 {entryDraft.mealType === slot.id
                            ? 'bg-[var(--stor-action)] text-[var(--stor-action-text)]'
                            : 'bg-[var(--stor-surface-muted)] text-[var(--stor-muted-text)] hover:bg-[var(--stor-border)]'}"
                        onclick={() => selectMealSlot(slot.id)}
                    >
                        {slot.label}
                    </button>
                {/each}
                <button
                    type="button"
                    class="h-11 rounded-full border border-dashed border-[var(--stor-field-border)] px-3 text-sm font-semibold text-[var(--stor-muted-text)] transition hover:border-[var(--stor-focus)] hover:text-[var(--stor-ink)] sm:h-9"
                    aria-label="New meal slot"
                    aria-expanded={creatingMealSlot}
                    onclick={() => creatingMealSlot = !creatingMealSlot}
                >
                    + Meal
                </button>
            </div>
        </Field>
        {#if creatingMealSlot}
            <div class="flex items-center gap-2">
                <Input
                    id="calorie-entry-new-meal"
                    class="min-w-0 flex-1"
                    placeholder="e.g. Pre-workout"
                    aria-label="New meal name"
                    bind:value={newMealSlotLabel}
                    onkeydown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            void createMealSlot();
                        }
                    }}
                />
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!newMealSlotLabel.trim() || savingMealSlot}
                    onclick={() => void createMealSlot()}
                >
                    {savingMealSlot ? "Saving…" : "Add"}
                </Button>
            </div>
        {/if}
        <Field label="Calories" htmlFor="calorie-entry-calories" required error={entryErrors.calories}>
            <Input id="calorie-entry-calories" type="number" min="0" step="0.1" bind:value={entryDraft.calories} placeholder="kcal" disabled={nutritionLinked} />
        </Field>
        {#if foldOptional}
            <!-- Phones fold what is optional; an error in it opens the fold. -->
            <button type="button" class="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-[var(--stor-accent-text)]" aria-expanded="false" onclick={() => (entryDetailsOpen = true)}>
                {selectedFood ? "Macros, notes" : "Quantity, macros, save to library, notes"}<IconChevronRight class="h-4 w-4" />
            </button>
        {:else}
        <div class="grid grid-cols-3 gap-3">
            <Field label="Protein" htmlFor="calorie-entry-protein" error={entryErrors.proteinG}>
                <Input id="calorie-entry-protein" type="number" min="0" step="0.1" bind:value={entryDraft.proteinG} placeholder="g" disabled={nutritionLinked} />
            </Field>
            <Field label="Carbs" htmlFor="calorie-entry-carbs" error={entryErrors.carbsG}>
                <Input id="calorie-entry-carbs" type="number" min="0" step="0.1" bind:value={entryDraft.carbsG} placeholder="g" disabled={nutritionLinked} />
            </Field>
            <Field label="Fat" htmlFor="calorie-entry-fat" error={entryErrors.fatG}>
                <Input id="calorie-entry-fat" type="number" min="0" step="0.1" bind:value={entryDraft.fatG} placeholder="g" disabled={nutritionLinked} />
            </Field>
        </div>
        {#if selectedFood}
            <div class="flex justify-end">
                {#if nutritionLinked}
                    <Button variant="ghost" size="sm" onclick={() => nutritionLinked = false}>Edit nutrition snapshot</Button>
                {:else}
                    <Button variant="ghost" size="sm" onclick={relinkNutrition}>Recalculate from food</Button>
                {/if}
            </div>
        {:else if !editingEntryId}
            <label class="flex items-start gap-3 rounded-xl bg-[var(--stor-surface-muted)] p-3" data-optional>
                <Checkbox
                    checked={saveAsReusableFood}
                    onCheckedChange={(checked) => saveAsReusableFood = Boolean(checked)}
                    aria-label="Save as reusable food"
                />
                <span>
                    <span class="block text-sm font-semibold text-[var(--stor-ink)]">Save as reusable food</span>
                    <span class="mt-0.5 block text-xs text-[var(--stor-muted-text)]">Use the entered quantity to calculate nutrition per 100 grams.</span>
                </span>
            </label>
        {/if}
        {/if}
        <Field label="Date and time" htmlFor="calorie-entry-logged-at" required error={entryErrors.loggedAt}>
            <DateTimePicker id="calorie-entry-logged-at" bind:value={entryDraft.loggedAt} />
        </Field>
        {#if !foldOptional}
            <Field label="Notes" htmlFor="calorie-entry-notes">
                <Textarea id="calorie-entry-notes" bind:value={entryDraft.notes} placeholder="Optional context" />
            </Field>
        {/if}
        <div class="flex justify-end gap-2 border-t border-stone-200 pt-4 max-md:border-0 max-md:pt-0 max-md:[&>button:last-child]:flex-1">
            <Button variant="secondary" class="max-md:hidden" onclick={closeEntryDrawer}>Cancel</Button>
            <Button type="submit" disabled={savingEntry}>{savingEntry ? "Saving…" : editingEntryId ? "Save changes" : "Save entry"}</Button>
        </div>
    </form>
    {/if}
</CommandDrawer>

<CommandDrawer
    show={goalDrawerOpen}
    title={compactForm ? "Daily target" : "Nutrition goals"}
    size="lg"
    onClose={() => goalDrawerOpen = false}
>
    <form class="flex flex-col gap-4" onsubmit={saveGoal}>
        {#if compactForm}
            <!-- Phones: the number first with common values as chips, protein as chips; the calculator and the rest fold. -->
            <div class="flex flex-col gap-2">
                <label class="relative block"><span class="sr-only">Daily calories</span>
                    <Input type="number" inputmode="numeric" min="1" step="1" bind:value={goalDraft.caloriesTarget} oninput={markDailyCaloriesManual} placeholder="0" class="!h-16 !rounded-none !border-0 !border-b-2 !border-[var(--stor-action)] !bg-transparent !px-0 !text-[36px] !font-semibold !shadow-none !ring-0" />
                    <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center text-base text-[var(--stor-muted-text)]">kcal a day</span>
                </label>
                <ChoiceChips label="Common daily targets" options={[1800, 2000, 2200, 2500].map((value) => ({ value, label: formatNumber(value) }))} value={Number(goalDraft.caloriesTarget) || null} onChange={(value) => { goalDraft.caloriesTarget = value; markDailyCaloriesManual(); }} />
                {#if goalErrors.caloriesTarget}<p class="text-sm text-[var(--stor-negative)]" role="alert">{goalErrors.caloriesTarget}</p>{/if}
            </div>
            <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium text-[var(--stor-ink)]">Protein</span>
                <ChoiceChips label="Protein target" options={[{ value: 100, label: "100 g" }, { value: 130, label: "130 g" }, { value: 160, label: "160 g" }, { value: 0, label: "Off" }]} value={Number(goalDraft.proteinTargetG) || 0} onChange={(value) => (goalDraft.proteinTargetG = value)} />
            </div>
            {#if !goalMoreOpen}
                <FoldLine bind:open={goalMoreOpen} tone="link" summary={`Calculate from your body, carbs, fat · from ${formatDate(goalDraft.effectiveFrom, { day: "numeric", month: "short" })}`} />
            {/if}
        {/if}
        <div class="rounded-xl bg-[var(--stor-surface-muted)] p-3 {compactForm && !goalMoreOpen ? 'hidden' : ''}">
            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Effective from</div>
            <div class="mt-1 font-semibold text-[var(--stor-ink)]">{formatDate(goalDraft.effectiveFrom, { dateStyle: "long" })}</div>
            <input type="hidden" bind:value={goalDraft.effectiveFrom} />
            {#if goalErrors.effectiveFrom}<p class="mt-1 text-xs font-medium text-red-600">{goalErrors.effectiveFrom}</p>{/if}
        </div>

        <section class="rounded-xl bg-[var(--stor-surface-muted)] p-3 sm:p-4 {compactForm && !goalMoreOpen ? 'hidden' : ''}">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--stor-ink)]">Calculate from body profile</h3>
                    <p class="mt-1 text-xs leading-5 text-[var(--stor-muted-text)]">
                        Estimate calories to reach a target by a date or maintain the target afterward.
                    </p>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={goalCalculatorOpen}
                    onclick={() => goalCalculatorOpen = !goalCalculatorOpen}
                >{goalCalculatorOpen ? "Hide" : "Set up"}</Button>
            </div>

            {#if goalCalculatorOpen}
                <div class="mt-4 space-y-4 border-t border-stone-200 pt-4">
                    <div class="grid gap-3 sm:grid-cols-2">
                        <Field label="Current weight" htmlFor="nutrition-goal-current-weight" hint={goalPrefilledFromBody ? "Prefilled from Body history when available" : "Kilograms"} error={goalErrors.currentWeightKg} required>
                            <Input
                                id="nutrition-goal-current-weight"
                                type="number"
                                min="0.1"
                                step="0.1"
                                bind:value={goalDraft.calculationCurrentWeightKg}
                                oninput={markCalculationProfileChanged}
                                placeholder="kg"
                            />
                        </Field>
                        <Field label="Target weight" htmlFor="nutrition-goal-target-weight" hint="Kilograms" error={goalErrors.targetWeightKg} required>
                            <Input
                                id="nutrition-goal-target-weight"
                                type="number"
                                min="0.1"
                                step="0.1"
                                bind:value={goalDraft.calculationTargetWeightKg}
                                oninput={markCalculationProfileChanged}
                                placeholder="kg"
                            />
                        </Field>
                        <Field label="Height" htmlFor="nutrition-goal-height" hint="Centimeters" error={goalErrors.heightCm} required>
                            <Input
                                id="nutrition-goal-height"
                                type="number"
                                min="0.1"
                                step="0.1"
                                bind:value={goalDraft.calculationHeightCm}
                                oninput={markCalculationProfileChanged}
                                placeholder="cm"
                            />
                        </Field>
                        <Field label="Age" htmlFor="nutrition-goal-age" hint="Adults 18–120" error={goalErrors.ageYears} required>
                            <Input
                                id="nutrition-goal-age"
                                type="number"
                                min="18"
                                max="120"
                                step="1"
                                bind:value={goalDraft.calculationAgeYears}
                                oninput={markCalculationProfileChanged}
                                placeholder="years"
                            />
                        </Field>
                        <Field label="Sex used by equation" htmlFor="nutrition-goal-sex" error={goalErrors.sex} required>
                            <Select
                                id="nutrition-goal-sex"
                                value={goalDraft.calculationSex}
                                options={calculationSexOptions}
                                placeholder="Choose sex"
                                onValueChange={setCalculationSex}
                            />
                        </Field>
                        <Field
                            label="Typical activity level"
                            htmlFor="nutrition-goal-activity"
                            hint="Baseline assumption for this calorie calculation"
                            error={goalErrors.activityLevel}
                            required
                        >
                            <Select
                                id="nutrition-goal-activity"
                                value={goalDraft.calculationActivityLevel}
                                options={calculationActivityOptions}
                                placeholder="Choose activity"
                                onValueChange={setCalculationActivity}
                            />
                            {#if goalDraft.calculationActivityLevel}
                                <p class="ml-0.5 text-xs leading-5 text-[var(--stor-muted-text)]">
                                    {CALORIE_ACTIVITY_LEVELS.find((level) => level.value === goalDraft.calculationActivityLevel)?.description}
                                </p>
                            {/if}
                            <p class="ml-0.5 text-xs leading-5 text-[var(--stor-muted-text)]">
                                Logged steps and workouts are tracked separately and do not change this daily calorie target.
                            </p>
                        </Field>
                        <Field class="sm:col-span-2" label="Target date" htmlFor="nutrition-goal-target-date" hint="Must be after the effective date" error={goalErrors.targetDate} required>
                            <Input
                                id="nutrition-goal-target-date"
                                type="date"
                                min={shiftLocalDate(goalDraft.effectiveFrom, 1)}
                                bind:value={goalDraft.calculationTargetDate}
                                oninput={markCalculationProfileChanged}
                            />
                        </Field>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="text-xs leading-5 text-[var(--stor-muted-text)]">
                            Uses the NIH adult body-weight model with guided defaults and no activity change during the goal.
                        </p>
                        <Button variant="secondary" size="sm" onclick={calculateGoalEstimates}>Calculate estimates</Button>
                    </div>

                    {#if goalCalculation}
                        <div class="rounded-xl bg-[var(--stor-surface-muted)] p-3">
                            <div class="flex flex-wrap items-baseline justify-between gap-2">
                                <div>
                                    <p class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Current maintenance</p>
                                    <p class="mt-1 text-xl font-semibold tabular-nums text-[var(--stor-ink)]">
                                        <DataValue>{formatNumber(goalCalculation.currentMaintenanceCalories)}</DataValue> <span class="text-xs font-medium text-[var(--stor-muted-text)]">kcal/day</span>
                                    </p>
                                </div>
                                <p class="text-xs text-[var(--stor-muted-text)]">Target BMI <DataValue>{formatNumber(goalCalculation.targetBmi)}</DataValue> · {goalCalculation.daysToTarget} days</p>
                            </div>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="rounded-xl bg-[var(--stor-surface-muted)] p-3">
                                <p class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Reach by target date</p>
                                {#if goalCalculation.reachGoalCalories !== null}
                                    <p class="mt-1 text-2xl font-semibold tabular-nums text-[var(--stor-ink)]">
                                        <DataValue>{formatNumber(goalCalculation.reachGoalCalories)}</DataValue> <span class="text-xs font-medium text-[var(--stor-muted-text)]">kcal/day</span>
                                    </p>
                                    <Button
                                        class="mt-3 w-full"
                                        size="sm"
                                        variant={goalDraft.calorieTargetSource === "calculator" && goalDraft.calculationResult === "reach_goal" ? "default" : "secondary"}
                                        aria-label="Use reach-goal estimate"
                                        onclick={() => applyGoalEstimate("reach_goal")}
                                    >Use this target</Button>
                                {:else}
                                    <p class="mt-2 text-xs leading-5 text-amber-700">{goalCalculation.reachGoalUnavailableReason}</p>
                                {/if}
                            </div>
                            <div class="rounded-xl bg-[var(--stor-surface-muted)] p-3">
                                <p class="text-xs font-semibold uppercase tracking-wide text-[var(--stor-muted-text)]">Maintain target weight</p>
                                {#if goalCalculation.targetMaintenanceCalories !== null}
                                    <p class="mt-1 text-2xl font-semibold tabular-nums text-[var(--stor-ink)]">
                                        <DataValue>{formatNumber(goalCalculation.targetMaintenanceCalories)}</DataValue> <span class="text-xs font-medium text-[var(--stor-muted-text)]">kcal/day</span>
                                    </p>
                                    <Button
                                        class="mt-3 w-full"
                                        size="sm"
                                        variant={goalDraft.calorieTargetSource === "calculator" && goalDraft.calculationResult === "target_maintenance" ? "default" : "secondary"}
                                        aria-label="Use target-maintenance estimate"
                                        onclick={() => applyGoalEstimate("target_maintenance")}
                                    >Use this target</Button>
                                {:else}
                                    <p class="mt-2 text-xs leading-5 text-amber-700">{goalCalculation.targetMaintenanceUnavailableReason}</p>
                                {/if}
                            </div>
                        </div>

                        {#if goalCalculation.warnings.length > 0}
                            <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                                {#each goalCalculation.warnings as warning}
                                    <p>{warning}</p>
                                {/each}
                            </div>
                        {/if}
                    {/if}

                    {#if goalCalculationStale && goalDraft.calorieTargetSource !== "manual"}
                        <p class="text-xs font-medium text-amber-700">The saved target is now a manual override. Recalculate and apply an estimate to relink it.</p>
                    {/if}
                    {#if goalErrors.calculatedCalories || goalErrors.calculationResult || goalErrors.calculationMethod}
                        <p class="text-xs font-medium text-red-600">
                            {goalErrors.calculatedCalories ?? goalErrors.calculationResult ?? goalErrors.calculationMethod}
                        </p>
                    {/if}

                    <div class="flex items-start justify-between gap-3 border-t border-stone-200 pt-3">
                        <p class="max-w-xl text-xs leading-5 text-[var(--stor-muted-text)]">
                            Adult estimate only; not medical advice and not intended for pregnancy or breastfeeding. Monitor weight and adjust over time.
                        </p>
                        <Button variant="ghost" size="sm" onclick={clearGoalCalculator}>Clear profile</Button>
                    </div>
                </div>
            {/if}
        </section>

        <Field label="Daily calories" htmlFor="nutrition-goal-calories" required error={goalErrors.caloriesTarget} class={compactForm ? "hidden" : ""}>
            <Input
                id="nutrition-goal-calories"
                type="number"
                min="1"
                step="1"
                bind:value={goalDraft.caloriesTarget}
                oninput={markDailyCaloriesManual}
                placeholder="e.g. 2200"
            />
            {#if goalDraft.calorieTargetSource === "calculator"}
                <p class="ml-0.5 text-xs font-medium text-emerald-700">
                    Linked to the {goalDraft.calculationResult === "reach_goal" ? "reach-by-date" : "target-maintenance"} estimate.
                </p>
            {:else if goalDraft.calorieTargetSource === "manual_override"}
                <p class="ml-0.5 text-xs font-medium text-amber-700">
                    Manual override; the calculation profile and its <DataValue>{formatNumber(goalDraft.calculatedCalories ?? 0)}</DataValue> kcal estimate will be retained.
                </p>
            {/if}
        </Field>
        <div class="grid grid-cols-3 gap-3 {compactForm && !goalMoreOpen ? 'hidden' : ''}">
            <Field label="Protein" htmlFor="nutrition-goal-protein" hint="0 = unset" error={goalErrors.proteinTargetG}>
                <Input id="nutrition-goal-protein" type="number" min="0" step="0.1" bind:value={goalDraft.proteinTargetG} placeholder="g" />
            </Field>
            <Field label="Carbs" htmlFor="nutrition-goal-carbs" hint="0 = unset" error={goalErrors.carbsTargetG}>
                <Input id="nutrition-goal-carbs" type="number" min="0" step="0.1" bind:value={goalDraft.carbsTargetG} placeholder="g" />
            </Field>
            <Field label="Fat" htmlFor="nutrition-goal-fat" hint="0 = unset" error={goalErrors.fatTargetG}>
                <Input id="nutrition-goal-fat" type="number" min="0" step="0.1" bind:value={goalDraft.fatTargetG} placeholder="g" />
            </Field>
        </div>
        <div class="flex justify-end gap-2 border-t border-stone-200 pt-4 max-md:border-0 max-md:pt-0">
            <Button variant="secondary" class="max-md:hidden" onclick={() => goalDrawerOpen = false}>Cancel</Button>
            <Button type="submit" class="max-md:h-12 max-md:flex-1" disabled={savingGoal}>{savingGoal ? "Saving…" : compactForm && Number(goalDraft.caloriesTarget) > 0 ? `Set ${formatNumber(Number(goalDraft.caloriesTarget))} kcal` : "Save goals"}</Button>
        </div>
    </form>
</CommandDrawer>

<MealSlotManager
    show={slotManagerOpen}
    slots={mealSlots}
    storedSlots={storedMealSlots}
    onClose={closeSlotManager}
/>

<CommandConfirmDialog
    show={deleteEntry !== null}
    title="Delete food entry?"
    message="This removes the entry from the diary. The action remains represented in the event history."
    onConfirm={removeEntry}
    onCancel={() => deleteEntry = null}
/>
