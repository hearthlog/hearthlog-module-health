/**
 * Health's persisted entities. Their names, tables, event prefixes, and
 * fields are deployed data contracts: never rename them.
 */

import type { EntityDefinition } from '@hearthlog/sdk/entities';

export const ENTITY_DEFINITIONS: EntityDefinition[] = [
    {
        name: "calorie_entry",
        feature: "calories",
        displayName: "Calorie Entry",
        table: "calorie_entries",
        fields: [
            {
                name: "name",
                type: "string",
                payloadKey: "name",
                required: true,
            },
            {
                name: "calories",
                type: "number",
                payloadKey: "calories",
                required: true,
            },
            {
                name: "protein_g",
                type: "number",
                payloadKey: "proteinG",
                default: 0,
            },
            {
                name: "carbs_g",
                type: "number",
                payloadKey: "carbsG",
                default: 0,
            },
            { name: "fat_g", type: "number", payloadKey: "fatG", default: 0 },
            {
                name: "meal_type",
                type: "string",
                payloadKey: "mealType",
                default: "snack",
            },
            {
                name: "logged_at",
                type: "datetime",
                payloadKey: "loggedAt",
                required: true,
            },
            {
                name: "food_item_id",
                type: "string",
                payloadKey: "foodItemId",
                default: "",
            },
            {
                name: "quantity_g",
                type: "number",
                payloadKey: "quantityG",
                default: 0,
            },
            {
                name: "portion_label",
                type: "string",
                payloadKey: "portionLabel",
                default: "",
            },
            { name: "notes", type: "string", payloadKey: "notes", default: "" },
        ],
        indexes: [
            {
                name: "idx_calorie_entries_scope_logged_at",
                columns: ["tenant_id", "log_id", "logged_at"],
            },
        ],
    },
    {
        name: "meal_slot",
        feature: "calories",
        displayName: "Meal Slot",
        table: "meal_slots",
        fields: [
            {
                name: "label",
                type: "string",
                payloadKey: "label",
                required: true,
            },
            {
                name: "sort_order",
                type: "number",
                payloadKey: "sortOrder",
                default: 0,
            },
            {
                name: "archived",
                type: "boolean",
                payloadKey: "archived",
                default: 0,
            },
        ],
        indexes: [
            {
                name: "idx_meal_slots_scope_order",
                columns: ["tenant_id", "log_id", "sort_order"],
            },
        ],
    },
    {
        name: "food_item",
        feature: "calories",
        displayName: "Food Item",
        table: "food_items",
        fields: [
            {
                name: "name",
                type: "string",
                payloadKey: "name",
                required: true,
            },
            { name: "brand", type: "string", payloadKey: "brand", default: "" },
            {
                name: "calories_per_100g",
                type: "number",
                payloadKey: "caloriesPer100g",
                required: true,
            },
            {
                name: "protein_per_100g",
                type: "number",
                payloadKey: "proteinPer100g",
                default: 0,
            },
            {
                name: "carbs_per_100g",
                type: "number",
                payloadKey: "carbsPer100g",
                default: 0,
            },
            {
                name: "fat_per_100g",
                type: "number",
                payloadKey: "fatPer100g",
                default: 0,
            },
            {
                name: "default_serving_g",
                type: "number",
                payloadKey: "defaultServingG",
                default: 100,
            },
            {
                name: "serving_label",
                type: "string",
                payloadKey: "servingLabel",
                default: "",
            },
            {
                name: "source_servings_json",
                type: "string",
                payloadKey: "sourceServingsJson",
                default: "[]",
            },
            {
                name: "favorite",
                type: "boolean",
                payloadKey: "favorite",
                default: 0,
            },
            {
                name: "source_provider",
                type: "string",
                payloadKey: "sourceProvider",
                default: "manual",
            },
            {
                name: "source_id",
                type: "string",
                payloadKey: "sourceId",
                default: "",
            },
            {
                name: "source_slug",
                type: "string",
                payloadKey: "sourceSlug",
                default: "",
            },
            {
                name: "source_data_version",
                type: "string",
                payloadKey: "sourceDataVersion",
                default: "",
            },
            {
                name: "source_missing_nutrients",
                type: "string",
                payloadKey: "sourceMissingNutrients",
                default: "",
            },
            {
                name: "source_ean",
                type: "string",
                payloadKey: "sourceEan",
                default: "",
            },
            {
                name: "source_ean_confidence",
                type: "string",
                payloadKey: "sourceEanConfidence",
                default: "",
            },
        ],
        indexes: [
            {
                name: "idx_food_items_scope_name",
                columns: ["tenant_id", "log_id", "name"],
            },
            {
                name: "idx_food_items_scope_favorite",
                columns: ["tenant_id", "log_id", "favorite", "name"],
            },
            {
                name: "idx_food_items_scope_source",
                columns: [
                    "tenant_id",
                    "log_id",
                    "source_provider",
                    "source_id",
                ],
            },
        ],
    },
    {
        name: "nutrition_goal",
        feature: "calories",
        displayName: "Nutrition Goal",
        table: "nutrition_goals",
        summary: { noun: 'Calorie goal', key: 'caloriesTarget', unit: ' kcal' },
        fields: [
            {
                name: "effective_from",
                type: "datetime",
                payloadKey: "effectiveFrom",
                required: true,
            },
            {
                name: "calories_target",
                type: "number",
                payloadKey: "caloriesTarget",
                required: true,
            },
            {
                name: "protein_target_g",
                type: "number",
                payloadKey: "proteinTargetG",
                default: 0,
            },
            {
                name: "carbs_target_g",
                type: "number",
                payloadKey: "carbsTargetG",
                default: 0,
            },
            {
                name: "fat_target_g",
                type: "number",
                payloadKey: "fatTargetG",
                default: 0,
            },
            {
                name: "calorie_target_source",
                type: "string",
                payloadKey: "calorieTargetSource",
                default: "manual",
            },
            {
                name: "calculation_method",
                type: "string",
                payloadKey: "calculationMethod",
                default: "",
            },
            {
                name: "calculation_result",
                type: "string",
                payloadKey: "calculationResult",
                default: "",
            },
            {
                name: "calculated_calories",
                type: "number",
                payloadKey: "calculatedCalories",
                default: 0,
            },
            {
                name: "calculation_current_weight_kg",
                type: "number",
                payloadKey: "calculationCurrentWeightKg",
                default: 0,
            },
            {
                name: "calculation_target_weight_kg",
                type: "number",
                payloadKey: "calculationTargetWeightKg",
                default: 0,
            },
            {
                name: "calculation_height_cm",
                type: "number",
                payloadKey: "calculationHeightCm",
                default: 0,
            },
            {
                name: "calculation_age_years",
                type: "number",
                payloadKey: "calculationAgeYears",
                default: 0,
            },
            {
                name: "calculation_sex",
                type: "string",
                payloadKey: "calculationSex",
                default: "",
            },
            {
                name: "calculation_activity_level",
                type: "string",
                payloadKey: "calculationActivityLevel",
                default: "",
            },
            {
                name: "calculation_target_date",
                type: "datetime",
                payloadKey: "calculationTargetDate",
                default: "",
            },
        ],
        indexes: [
            {
                name: "idx_nutrition_goals_scope_effective_from",
                columns: ["tenant_id", "log_id", "effective_from"],
            },
        ],
    },
    {
        name: "activity_entry",
        feature: "activities",
        displayName: "Activity Entry",
        table: "activity_entries",
        fields: [
            {
                name: "name",
                type: "string",
                payloadKey: "name",
                required: true,
            },
            {
                name: "kind",
                type: "string",
                payloadKey: "kind",
                required: true,
            },
            {
                name: "amount",
                type: "number",
                payloadKey: "amount",
                required: true,
            },
            {
                name: "unit",
                type: "string",
                payloadKey: "unit",
                required: true,
            },
            {
                name: "duration_minutes",
                type: "number",
                payloadKey: "durationMinutes",
                default: 0,
            },
            {
                name: "intensity",
                type: "string",
                payloadKey: "intensity",
                default: "moderate",
            },
            {
                name: "logged_at",
                type: "datetime",
                payloadKey: "loggedAt",
                required: true,
            },
            {
                name: "active_calories",
                type: "number",
                payloadKey: "activeCalories",
                default: 0,
            },
            {
                name: "calorie_source",
                type: "string",
                payloadKey: "calorieSource",
                default: "none",
            },
            {
                name: "calculation_method",
                type: "string",
                payloadKey: "calculationMethod",
                default: "",
            },
            {
                name: "calculation_weight_kg",
                type: "number",
                payloadKey: "calculationWeightKg",
                default: 0,
            },
            { name: "notes", type: "string", payloadKey: "notes", default: "" },
            // Empty for a manual entry; otherwise the id of the service integration that wrote it.
            { name: "source", type: "string", payloadKey: "source", default: "" },
        ],
        indexes: [
            {
                name: "idx_activity_entries_scope_logged_at",
                columns: ["tenant_id", "log_id", "logged_at"],
            },
            {
                name: "idx_activity_entries_scope_kind_logged_at",
                columns: ["tenant_id", "log_id", "kind", "logged_at"],
            },
        ],
    },
    {
        name: "activity_goal",
        feature: "activities",
        displayName: "Activity Goal",
        table: "activity_goals",
        summary: { noun: 'Step goal', key: 'stepsTarget', unit: ' steps' },
        fields: [
            {
                name: "effective_from",
                type: "datetime",
                payloadKey: "effectiveFrom",
                required: true,
            },
            {
                name: "steps_target",
                type: "number",
                payloadKey: "stepsTarget",
                default: 0,
            },
            {
                name: "exercise_minutes_target",
                type: "number",
                payloadKey: "exerciseMinutesTarget",
                default: 0,
            },
        ],
        indexes: [
            {
                name: "idx_activity_goals_scope_effective_from",
                columns: ["tenant_id", "log_id", "effective_from"],
            },
        ],
    },
    {
        name: "weightlog",
        feature: "bmi",
        table: "weight_logs",
        summary: { noun: 'Weight', key: 'weight', unit: ' kg' },
        fields: [
            {
                name: "weight",
                type: "number",
                payloadKey: "weight",
                required: true,
            },
            {
                name: "height",
                type: "number",
                payloadKey: "height",
                required: true,
            },
            {
                name: "date",
                type: "datetime",
                payloadKey: "date",
                default: "date('now')",
            },
            { name: "notes", type: "string", payloadKey: "notes" },
        ],
    },
];
