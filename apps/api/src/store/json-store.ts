import { promises as fs } from 'fs';
import * as path from 'path';

/** Directory where the JSON "database" files live (override with DATA_DIR). */
export function dataDir(): string {
  return process.env.DATA_DIR ?? path.resolve(__dirname, '../../../data');
}

/**
 * Tiny persistent collection backed by one JSON file. Not concurrent-safe
 * across processes — fine for a single-node dev API. Swap for Postgres later
 * behind this same interface.
 */
export class JsonStore<T extends { id: string }> {
  private cache: T[] | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly seedFn?: () => T[] | Promise<T[]>,
  ) {}

  private get filePath(): string {
    return path.join(dataDir(), this.file);
  }

  async all(): Promise<T[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as T[];
    } catch {
      const seeded = this.seedFn ? await this.seedFn() : [];
      this.cache = seeded;
      await this.flush();
    }
    return this.cache;
  }

  async find(id: string): Promise<T | undefined> {
    return (await this.all()).find((x) => x.id === id);
  }

  async insert(item: T): Promise<T> {
    const list = await this.all();
    list.push(item);
    await this.flush();
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T | undefined> {
    const list = await this.all();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return undefined;
    list[idx] = { ...list[idx], ...patch, id };
    await this.flush();
    return list[idx];
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await this.flush();
    return true;
  }

  /** Replace the whole collection (used by settings singletons). */
  async replaceAll(items: T[]): Promise<void> {
    this.cache = items;
    await this.flush();
  }

  private async flush(): Promise<void> {
    const snapshot = JSON.stringify(this.cache ?? [], null, 2);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dataDir(), { recursive: true });
      await fs.writeFile(this.filePath, snapshot, 'utf8');
    });
    return this.writing;
  }
}
