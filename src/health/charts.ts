/** Points in chart space, x increasing. */
export interface ChartPoint {
    x: number;
    y: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * A smooth path through the points that never overshoots them (monotone cubic
 * interpolation), so a smoothed weight line cannot invent a dip or a peak.
 */
export function monotonePath(points: readonly ChartPoint[]): string {
    const count = points.length;
    if (count === 0) return '';
    if (count === 1) return `M${round(points[0].x)} ${round(points[0].y)}`;
    const dx: number[] = [];
    const slope: number[] = [];
    for (let i = 0; i < count - 1; i++) {
        dx[i] = points[i + 1].x - points[i].x;
        slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
    }
    const tangent: number[] = [slope[0]];
    for (let i = 1; i < count - 1; i++) {
        tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
    }
    tangent[count - 1] = slope[count - 2];
    for (let i = 0; i < count - 1; i++) {
        if (slope[i] === 0) {
            tangent[i] = 0;
            tangent[i + 1] = 0;
            continue;
        }
        const a = tangent[i] / slope[i];
        const b = tangent[i + 1] / slope[i];
        const sum = a * a + b * b;
        if (sum > 9) {
            const scale = 3 / Math.sqrt(sum);
            tangent[i] = scale * a * slope[i];
            tangent[i + 1] = scale * b * slope[i];
        }
    }
    let path = `M${round(points[0].x)} ${round(points[0].y)}`;
    for (let i = 0; i < count - 1; i++) {
        const h = dx[i];
        path += `C${round(points[i].x + h / 3)} ${round(points[i].y + (tangent[i] * h) / 3)} ${round(points[i + 1].x - h / 3)} ${round(points[i + 1].y - (tangent[i + 1] * h) / 3)} ${round(points[i + 1].x)} ${round(points[i + 1].y)}`;
    }
    return path;
}

/** Whole days since 1970-01-01 for a `yyyy-MM-dd` key, free of time zones. */
export function dayNumber(day: string): number {
    return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;
}

/** Round tick values inside `min`–`max`: a step of 1, 2 or 5 (times a power of ten) that gives about `count` ticks. */
export function niceTicks(min: number, max: number, count = 5): number[] {
    if (!(max > min)) return [min];
    const rough = (max - min) / Math.max(1, count - 1);
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
    const ticks: number[] = [];
    for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
        ticks.push(Number((Math.round(value / step) * step).toFixed(6)));
    }
    return ticks;
}

/** The first day of every month after `startDay`, up to and including `endDay`, as day numbers. */
export function monthStartDays(startDay: number, endDay: number): number[] {
    const start = new Date(startDay * 86_400_000);
    const days: number[] = [];
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    while (cursor.getTime() / 86_400_000 <= endDay) {
        days.push(cursor.getTime() / 86_400_000);
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return days;
}
