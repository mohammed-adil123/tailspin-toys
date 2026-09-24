import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getFilteredGames,
    getGameCategories,
    getGamePublishers,
    getGameById,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('returns filter options ordered by name', async () => {
        await db.insert(categories).values([
            { name: 'Strategy', description: 'cat' },
            { name: 'Adventure', description: 'cat' },
        ]);
        await db.insert(publishers).values([
            { name: 'Pub One', description: 'pub' },
            { name: 'Pub Two', description: 'pub' },
        ]);

        expect(await getGameCategories(db)).toEqual([
            { id: expect.any(Number), name: 'Adventure' },
            { id: expect.any(Number), name: 'Strategy' },
        ]);
        expect(await getGamePublishers(db)).toEqual([
            { id: expect.any(Number), name: 'Pub One' },
            { id: expect.any(Number), name: 'Pub Two' },
        ]);
    });

    it('filters by one or more categories and publisher together', async () => {
        const [strategy, adventure] = await db
            .insert(categories)
            .values([
                { name: 'Strategy', description: 'cat' },
                { name: 'Adventure', description: 'cat' },
            ])
            .returning({ id: categories.id });
        const [pubOne, pubTwo] = await db
            .insert(publishers)
            .values([
                { name: 'Pub One', description: 'pub' },
                { name: 'Pub Two', description: 'pub' },
            ])
            .returning({ id: publishers.id });
        await db.insert(games).values([
            {
                title: 'Beta Game',
                description: 'Beta',
                starRating: 4,
                categoryId: strategy.id,
                publisherId: pubOne.id,
            },
            {
                title: 'Alpha Game',
                description: 'Alpha',
                starRating: 4,
                categoryId: adventure.id,
                publisherId: pubOne.id,
            },
            {
                title: 'Gamma Game',
                description: 'Gamma',
                starRating: 4,
                categoryId: strategy.id,
                publisherId: pubTwo.id,
            },
        ]);

        const filtered = await getFilteredGames(db, {
            categoryIds: [strategy.id, adventure.id],
            publisherId: pubOne.id,
        });
        expect(filtered.map((game) => game.title)).toEqual(['Alpha Game', 'Beta Game']);
    });

    it('returns no games when a filter has no matches', async () => {
        await seedGames(db, 1);
        expect(await getFilteredGames(db, { publisherId: 99999 })).toEqual([]);
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
