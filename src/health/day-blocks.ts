import type { BucketLoader } from '@hearthlog/sdk/endless';
import { queryDatabase, type ReadRepositories } from '@hearthlog/sdk/data';

/**
 * Reads a batch of days in one session. Every day is one block of an endless
 * Health list; the days of a batch are read side by side.
 */
export function dayBlocks<T>(read: (repositories: ReadRepositories, date: string) => Promise<T>): BucketLoader<T> {
    return (keys) => queryDatabase(async (repositories) => new Map(
        await Promise.all(keys.map(async (date) => [date, await read(repositories, date)] as const)),
    ));
}
