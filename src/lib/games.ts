import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game } from '../types/game';

export interface GameFilterOptions {
    categoryIds?: number[];
    publisherId?: number;
}

export interface GameFilterOption {
    id: number;
    name: string;
}

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

/** Categories available for game filtering, ordered alphabetically. */
export async function getGameCategories(db: Database): Promise<GameFilterOption[]> {
    return db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name));
}

/** Publishers available for game filtering, ordered alphabetically. */
export async function getGamePublishers(db: Database): Promise<GameFilterOption[]> {
    return db
        .select({ id: publishers.id, name: publishers.name })
        .from(publishers)
        .orderBy(asc(publishers.name));
}

/** All games ordered by title. */
export async function getAllGames(db: Database): Promise<Game[]> {
    const rows = await baseGamesQuery(db).orderBy(asc(games.title));
    return rows.map(mapGame);
}

/** Games matching the selected categories and publisher, ordered by title. */
export async function getFilteredGames(
    db: Database,
    { categoryIds, publisherId }: GameFilterOptions,
): Promise<Game[]> {
    const conditions = [];

    if (categoryIds && categoryIds.length > 0) {
        conditions.push(inArray(games.categoryId, categoryIds));
    }

    if (publisherId !== undefined) {
        conditions.push(eq(games.publisherId, publisherId));
    }

    const query = baseGamesQuery(db);
    const rows =
        conditions.length > 0
            ? await query.where(and(...conditions)).orderBy(asc(games.title))
            : await query.orderBy(asc(games.title));

    return rows.map(mapGame);
}

/** All game ids ordered by title. */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/** A single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
