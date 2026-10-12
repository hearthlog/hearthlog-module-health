import { SvelteMap } from 'svelte/reactivity';
import { queryDatabase, type ReadRepositories } from '@hearthlog/sdk/data';
import { shiftDay, weekStartOf } from '@hearthlog/sdk/endless';

/**
 * The Monday-first week around the day in view, for the strip's pips and the
 * side panel. A week is read when the day first enters it, the weeks beside it
 * are read ahead, and weeks already seen stay at hand, so scrolling day by day
 * never blanks the strip. A refresh re-reads the week in view and forgets the
 * others, but keeps showing the old week until the new one arrives.
 */
export class WeekFollower<T> {
    readonly #weeks = new SvelteMap<string, T>();
    readonly #pending = new Set<string>();
    readonly #read: (repositories: ReadRepositories, date: string) => Promise<T>;
    readonly #failure: string;
    #generation = 0;

    /** `read` loads the week that holds `date`; `failure` is the warning logged when it cannot. */
    constructor(read: (repositories: ReadRepositories, date: string) => Promise<T>, failure: string) {
        this.#read = read;
        this.#failure = failure;
    }

    /** The week that holds a day, once it has been read. */
    get(date: string): T | undefined {
        return this.#weeks.get(weekStartOf(date));
    }

    /** Reads the week that holds the day and, after it, the weeks beside it. */
    follow(date: string): void {
        void this.#load(date, this.#generation).then(() => {
            void this.#load(shiftDay(date, -7), this.#generation);
            void this.#load(shiftDay(date, 7), this.#generation);
        });
    }

    /** After a save or a sync: reads the week in view again and forgets the rest. */
    refresh(date: string): void {
        this.#generation += 1;
        this.#pending.clear();
        const keep = weekStartOf(date);
        for (const key of [...this.#weeks.keys()]) {
            if (key !== keep) this.#weeks.delete(key);
        }
        void this.#load(date, this.#generation, true);
    }

    async #load(date: string, generation: number, force = false): Promise<void> {
        const key = weekStartOf(date);
        if (!force && (this.#weeks.has(key) || this.#pending.has(key))) return;
        this.#pending.add(key);
        try {
            const value = await queryDatabase((repositories) => this.#read(repositories, date));
            if (generation === this.#generation) this.#weeks.set(key, value);
        } catch (error) {
            console.warn(this.#failure, error);
        } finally {
            if (generation === this.#generation) this.#pending.delete(key);
        }
    }
}
