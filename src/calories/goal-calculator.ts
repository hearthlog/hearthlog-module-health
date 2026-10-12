export const CALORIE_CALCULATION_METHOD = 'niddk-body-weight-planner-v1' as const;
export const MIN_CALCULATED_CALORIES = 1000;

export const CALORIE_ACTIVITY_LEVELS = [
    {
        value: 'inactive',
        label: 'Inactive',
        description: 'Daily living with little activity beyond routine tasks.',
        pal: 1.4,
    },
    {
        value: 'low_active',
        label: 'Low active',
        description: 'Daily living plus roughly 60–80 minutes of walking.',
        pal: 1.6,
    },
    {
        value: 'active',
        label: 'Active',
        description: 'Daily living plus regular moderate activity most days.',
        pal: 1.75,
    },
    {
        value: 'very_active',
        label: 'Very active',
        description: 'Daily living plus substantial moderate and vigorous activity.',
        pal: 2.05,
    },
] as const;

export type CalorieActivityLevel = (typeof CALORIE_ACTIVITY_LEVELS)[number]['value'];
export type CalorieCalculationSex = 'male' | 'female';
export type CalorieCalculationSelection = 'reach_goal' | 'target_maintenance';
export type CalorieTargetSource = 'manual' | 'calculator' | 'manual_override';

export interface CalorieGoalCalculationInput {
    effectiveFrom: string;
    targetDate: string;
    currentWeightKg: number;
    targetWeightKg: number;
    heightCm: number;
    ageYears: number;
    sex: CalorieCalculationSex;
    activityLevel: CalorieActivityLevel;
}

export interface CalorieGoalCalculationResult {
    method: typeof CALORIE_CALCULATION_METHOD;
    activityPal: number;
    daysToTarget: number;
    targetBmi: number;
    currentMaintenanceCalories: number;
    reachGoalCalories: number | null;
    targetMaintenanceCalories: number | null;
    reachGoalUnavailableReason: string;
    targetMaintenanceUnavailableReason: string;
    warnings: string[];
}

interface BodyChange {
    fat: number;
    lean: number;
    glycogen: number;
    extracellularWater: number;
    adaptiveThermogenesis: number;
}

interface DailyParameters {
    calories: number;
    carbohydratePercent: number;
    sodiumMg: number;
    activityParameter: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_CARBOHYDRATE_PERCENT = 50;
const DEFAULT_SODIUM_MG = 4000;
const DEFAULT_GLYCOGEN_KG = 0.5;
const GOAL_WEIGHT_EPSILON_KG = 0.001;
const MAX_SOLVER_ITERATIONS = 64;
const MAX_SOLVER_CALORIES = 20_000;

function activityPal(level: CalorieActivityLevel): number {
    return CALORIE_ACTIVITY_LEVELS.find((candidate) => candidate.value === level)?.pal ?? Number.NaN;
}

function parseDate(value: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return Number.NaN;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day
        ? timestamp
        : Number.NaN;
}

export function daysBetweenDates(start: string, end: string): number {
    const startTime = parseDate(start);
    const endTime = parseDate(end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return Number.NaN;
    return Math.round((endTime - startTime) / DAY_MS);
}

export function validateCalorieGoalCalculationInput(
    input: Partial<CalorieGoalCalculationInput>,
): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!Number.isFinite(input.currentWeightKg) || Number(input.currentWeightKg) <= 0) {
        errors.currentWeightKg = 'Enter a positive current weight.';
    }
    if (!Number.isFinite(input.targetWeightKg) || Number(input.targetWeightKg) <= 0) {
        errors.targetWeightKg = 'Enter a positive target weight.';
    }
    if (!Number.isFinite(input.heightCm) || Number(input.heightCm) <= 0) {
        errors.heightCm = 'Enter a positive height.';
    }
    if (!Number.isInteger(input.ageYears) || Number(input.ageYears) < 18 || Number(input.ageYears) > 120) {
        errors.ageYears = 'Enter an age from 18 to 120.';
    }
    if (input.sex !== 'male' && input.sex !== 'female') {
        errors.sex = 'Choose the sex used by the equation.';
    }
    if (!CALORIE_ACTIVITY_LEVELS.some((level) => level.value === input.activityLevel)) {
        errors.activityLevel = 'Choose an activity level.';
    }
    if (!Number.isFinite(parseDate(input.effectiveFrom ?? ''))) {
        errors.effectiveFrom = 'Choose a valid effective date.';
    }
    if (!Number.isFinite(parseDate(input.targetDate ?? ''))) {
        errors.targetDate = 'Choose a valid target date.';
    } else if (
        Number.isFinite(parseDate(input.effectiveFrom ?? ''))
        && daysBetweenDates(input.effectiveFrom!, input.targetDate!) <= 0
    ) {
        errors.targetDate = 'Target date must be after the effective date.';
    }
    return errors;
}

class Baseline {
    readonly carbohydratePercent = DEFAULT_CARBOHYDRATE_PERCENT;
    readonly sodiumMg = DEFAULT_SODIUM_MG;
    readonly glycogenKg = DEFAULT_GLYCOGEN_KG;
    readonly extracellularWaterKg = 0;

    constructor(
        readonly sex: CalorieCalculationSex,
        readonly ageYears: number,
        readonly heightCm: number,
        readonly weightKg: number,
        readonly pal: number,
    ) {}

    get bmi(): number {
        return this.weightKg / ((this.heightCm / 100) ** 2);
    }

    get bodyFatPercent(): number {
        const estimate = this.sex === 'male'
            ? 0.14 * this.ageYears + 37.31 * Math.log(this.bmi) - 103.94
            : 0.14 * this.ageYears + 39.96 * Math.log(this.bmi) - 102.01;
        return Math.min(60, Math.max(0, estimate));
    }

    get restingMetabolicRate(): number {
        const sexAdjustment = this.sex === 'male' ? 5 : -161;
        return 9.99 * this.weightKg
            + 625 * this.heightCm / 100
            - 4.92 * this.ageYears
            + sexAdjustment;
    }

    get maintenanceCalories(): number {
        return this.pal * this.restingMetabolicRate;
    }

    get activityParameter(): number {
        return (0.9 * this.restingMetabolicRate * this.pal - this.restingMetabolicRate)
            / this.weightKg;
    }

    get fatKg(): number {
        return this.weightKg * this.bodyFatPercent / 100;
    }

    get leanKg(): number {
        return this.weightKg - this.fatKg;
    }

    get energyExpenditureConstant(): number {
        return 0.76 * this.maintenanceCalories
            - 22 * this.leanKg
            - 3.2 * this.fatKg
            - this.activityParameter * this.weightKg;
    }

    get carbohydrateCalories(): number {
        return this.carbohydratePercent / 100 * this.maintenanceCalories;
    }

    glycogenWaterKg(glycogenKg: number): number {
        return 3.7 * (glycogenKg - this.glycogenKg);
    }

    weightFor(state: BodyState): number {
        return state.fatKg
            + state.leanKg
            + this.glycogenWaterKg(state.glycogenKg)
            + state.extracellularWaterKg;
    }
}

class BodyState {
    constructor(
        readonly fatKg: number,
        readonly leanKg: number,
        readonly glycogenKg: number,
        readonly extracellularWaterKg: number,
        readonly adaptiveThermogenesis: number,
    ) {}

    static fromBaseline(baseline: Baseline): BodyState {
        return new BodyState(
            baseline.fatKg,
            baseline.leanKg,
            baseline.glycogenKg,
            baseline.extracellularWaterKg,
            0.14 * baseline.maintenanceCalories,
        );
    }

    private partition(): number {
        return 1.990762711864407 / (1.990762711864407 + this.fatKg);
    }

    private carbohydrateFlux(baseline: Baseline, daily: DailyParameters): number {
        const carbohydrateIntake = daily.carbohydratePercent / 100 * daily.calories;
        const coefficient = baseline.carbohydrateCalories / (baseline.glycogenKg ** 2);
        return carbohydrateIntake - coefficient * (this.glycogenKg ** 2);
    }

    private totalEnergyExpenditure(baseline: Baseline, daily: DailyParameters): number {
        const partition = this.partition();
        const carbohydrateFlux = this.carbohydrateFlux(baseline, daily);
        const weightKg = baseline.weightFor(this);
        const foodThermicEffect = 0.1 * daily.calories;
        const expenditure = baseline.energyExpenditureConstant
            + 22 * this.leanKg
            + 3.2 * this.fatKg
            + daily.activityParameter * weightKg
            + this.adaptiveThermogenesis
            + foodThermicEffect;
        const numerator = expenditure
            + (daily.calories - carbohydrateFlux)
                * ((1 - partition) * 180 / 9440 + partition * 230 / 1807);
        const denominator = 1
            + partition * 230 / 1807
            + (1 - partition) * 180 / 9440;
        return numerator / denominator;
    }

    private derivative(baseline: Baseline, daily: DailyParameters): BodyChange {
        const partition = this.partition();
        const carbohydrateFlux = this.carbohydrateFlux(baseline, daily);
        const energyGap = daily.calories
            - this.totalEnergyExpenditure(baseline, daily)
            - carbohydrateFlux;
        const carbohydrateIntake = daily.carbohydratePercent / 100 * daily.calories;
        const sodiumImbalance = daily.sodiumMg
            - baseline.sodiumMg
            - 3000 * this.extracellularWaterKg
            - 4000 * (1 - carbohydrateIntake / baseline.carbohydrateCalories);
        return {
            fat: (1 - partition) * energyGap / 9440,
            lean: partition * energyGap / 1807,
            glycogen: carbohydrateFlux / 4180,
            extracellularWater: sodiumImbalance / 3220,
            adaptiveThermogenesis: (0.14 * daily.calories - this.adaptiveThermogenesis) / 14,
        };
    }

    private add(change: BodyChange, factor: number): BodyState {
        return new BodyState(
            this.fatKg + factor * change.fat,
            this.leanKg + factor * change.lean,
            this.glycogenKg + factor * change.glycogen,
            this.extracellularWaterKg + factor * change.extracellularWater,
            this.adaptiveThermogenesis + factor * change.adaptiveThermogenesis,
        );
    }

    nextDay(baseline: Baseline, daily: DailyParameters): BodyState {
        const first = this.derivative(baseline, daily);
        const second = this.add(first, 0.5).derivative(baseline, daily);
        const third = this.add(second, 0.5).derivative(baseline, daily);
        const fourth = this.add(third, 1).derivative(baseline, daily);
        const average: BodyChange = {
            fat: (first.fat + 2 * second.fat + 2 * third.fat + fourth.fat) / 6,
            lean: (first.lean + 2 * second.lean + 2 * third.lean + fourth.lean) / 6,
            glycogen: (first.glycogen + 2 * second.glycogen + 2 * third.glycogen + fourth.glycogen) / 6,
            extracellularWater: (
                first.extracellularWater
                + 2 * second.extracellularWater
                + 2 * third.extracellularWater
                + fourth.extracellularWater
            ) / 6,
            adaptiveThermogenesis: (
                first.adaptiveThermogenesis
                + 2 * second.adaptiveThermogenesis
                + 2 * third.adaptiveThermogenesis
                + fourth.adaptiveThermogenesis
            ) / 6,
        };
        return this.add(average, 1);
    }

    caloriesForBalance(baseline: Baseline, activityParameter: number): number {
        const weightKg = baseline.weightFor(this);
        const expenditureWithoutFood = baseline.energyExpenditureConstant
            + 22 * this.leanKg
            + 3.2 * this.fatKg
            + activityParameter * weightKg;
        const partition = this.partition();
        const denominator = 1
            + partition * 230 / 1807
            + (1 - partition) * 180 / 9440;
        const numeratorAdjustment = (1 - partition) * 180 / 9440
            + partition * 230 / 1807;
        return expenditureWithoutFood / (denominator - numeratorAdjustment - 0.24);
    }
}

function dailyParameters(baseline: Baseline, calories: number): DailyParameters {
    return {
        calories,
        carbohydratePercent: baseline.carbohydratePercent,
        sodiumMg: baseline.sodiumMg * calories / baseline.maintenanceCalories,
        activityParameter: baseline.activityParameter,
    };
}

function projectBodyState(baseline: Baseline, calories: number, days: number): BodyState {
    const daily = dailyParameters(baseline, calories);
    let state = BodyState.fromBaseline(baseline);
    for (let day = 0; day < days; day += 1) {
        state = state.nextDay(baseline, daily);
    }
    return state;
}

function solveGoalCalories(
    baseline: Baseline,
    targetWeightKg: number,
    days: number,
): { calories: number; state: BodyState } | null {
    if (Math.abs(targetWeightKg - baseline.weightKg) < 0.02) {
        const calories = baseline.maintenanceCalories;
        return { calories, state: projectBodyState(baseline, calories, days + 1) };
    }

    const minimumState = projectBodyState(baseline, 0, days);
    const minimumWeight = Math.max(0, baseline.weightFor(minimumState));
    if (
        Math.abs(minimumWeight - targetWeightKg) < GOAL_WEIGHT_EPSILON_KG
        || targetWeightKg <= minimumWeight
    ) {
        return null;
    }

    let lowCalories = 0;
    let highCalories = Math.max(2000, baseline.maintenanceCalories);
    let highState = projectBodyState(baseline, highCalories, days);
    let highWeight = baseline.weightFor(highState);
    while (highWeight < targetWeightKg && highCalories < MAX_SOLVER_CALORIES) {
        highCalories *= 2;
        highState = projectBodyState(baseline, highCalories, days);
        highWeight = baseline.weightFor(highState);
    }
    if (!Number.isFinite(highWeight) || highWeight < targetWeightKg) return null;

    let calories = highCalories;
    let error = Math.abs(highWeight - targetWeightKg);
    for (let iteration = 0; iteration < MAX_SOLVER_ITERATIONS; iteration += 1) {
        calories = (lowCalories + highCalories) / 2;
        const state = projectBodyState(baseline, calories, days);
        const weight = baseline.weightFor(state);
        if (!Number.isFinite(weight) || weight < 0) return null;
        error = Math.abs(targetWeightKg - weight);
        if (error <= GOAL_WEIGHT_EPSILON_KG) break;
        if (weight > targetWeightKg) highCalories = calories;
        else lowCalories = calories;
    }
    if (error > GOAL_WEIGHT_EPSILON_KG || !Number.isFinite(calories)) return null;
    return {
        calories,
        state: projectBodyState(baseline, calories, days + 1),
    };
}

export function calculateCalorieGoal(
    input: CalorieGoalCalculationInput,
): CalorieGoalCalculationResult {
    const errors = validateCalorieGoalCalculationInput(input);
    if (Object.keys(errors).length > 0) {
        throw new Error(Object.values(errors)[0]);
    }

    const pal = activityPal(input.activityLevel);
    const daysToTarget = daysBetweenDates(input.effectiveFrom, input.targetDate);
    const baseline = new Baseline(
        input.sex,
        input.ageYears,
        input.heightCm,
        input.currentWeightKg,
        pal,
    );
    const solved = solveGoalCalories(baseline, input.targetWeightKg, daysToTarget);
    const targetBmi = input.targetWeightKg / ((input.heightCm / 100) ** 2);
    const warnings: string[] = [];
    if (targetBmi < 18.5) warnings.push('Target weight is below the general healthy BMI range.');
    if (targetBmi >= 25) warnings.push('Target weight is above the general healthy BMI range.');

    let reachGoalCalories: number | null = null;
    let targetMaintenanceCalories: number | null = null;
    let reachGoalUnavailableReason = '';
    let targetMaintenanceUnavailableReason = '';

    if (!solved) {
        reachGoalUnavailableReason = 'This target cannot be reached by that date in the model. Choose a later date or a different weight.';
        targetMaintenanceUnavailableReason = 'Target maintenance is unavailable because the model could not project the goal state.';
    } else {
        const roundedReach = Math.round(solved.calories);
        const roundedMaintenance = Math.round(
            solved.state.caloriesForBalance(baseline, baseline.activityParameter),
        );
        if (roundedReach < MIN_CALCULATED_CALORIES) {
            reachGoalUnavailableReason = `The estimate is below ${MIN_CALCULATED_CALORIES.toLocaleString()} kcal/day. Choose a later date or enter a manual target.`;
        } else {
            reachGoalCalories = roundedReach;
        }
        if (!Number.isFinite(roundedMaintenance) || roundedMaintenance < MIN_CALCULATED_CALORIES) {
            targetMaintenanceUnavailableReason = `The maintenance estimate is below ${MIN_CALCULATED_CALORIES.toLocaleString()} kcal/day and cannot be applied.`;
        } else {
            targetMaintenanceCalories = roundedMaintenance;
        }
    }

    return {
        method: CALORIE_CALCULATION_METHOD,
        activityPal: pal,
        daysToTarget,
        targetBmi,
        currentMaintenanceCalories: Math.round(baseline.maintenanceCalories),
        reachGoalCalories,
        targetMaintenanceCalories,
        reachGoalUnavailableReason,
        targetMaintenanceUnavailableReason,
        warnings,
    };
}

interface StoredCalorieCalculationProfile {
    calculation_method: string;
    calculation_current_weight_kg: number;
    calculation_height_cm: number;
    calculation_age_years: number;
    calculation_sex: string;
    calculation_activity_level: string;
}

/**
 * Lightweight secondary reference: estimated intake to stay at the saved
 * starting weight with unchanged activity. No solver, no model projection —
 * just PAL × Mifflin-St Jeor RMR from the stored calculator profile.
 * Returns null when there is no usable calculator profile (manual goals,
 * legacy or incomplete profiles), so callers can hide the reference.
 */
export function getCurrentMaintenanceCalories(
    goal: StoredCalorieCalculationProfile | null | undefined,
): number | null {
    if (!goal || goal.calculation_method !== CALORIE_CALCULATION_METHOD) return null;
    const weightKg = Number(goal.calculation_current_weight_kg);
    const heightCm = Number(goal.calculation_height_cm);
    const ageYears = Number(goal.calculation_age_years);
    if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
    if (!Number.isFinite(heightCm) || heightCm <= 0) return null;
    if (!Number.isInteger(ageYears) || ageYears < 18 || ageYears > 120) return null;
    if (goal.calculation_sex !== 'male' && goal.calculation_sex !== 'female') return null;
    const pal = activityPal(goal.calculation_activity_level as CalorieActivityLevel);
    if (!Number.isFinite(pal)) return null;
    const baseline = new Baseline(goal.calculation_sex, ageYears, heightCm, weightKg, pal);
    const maintenance = Math.round(baseline.maintenanceCalories);
    return Number.isFinite(maintenance) && maintenance > 0 ? maintenance : null;
}
