/**
 * 通用 LRU 对象池
 *
 * 各引擎的 canvas/leafer 池管理逻辑几乎完全相同（LRU 获取 → 超限淘汰 → 创建新对象），
 * 此处封装公共模式，各引擎只需提供创建工厂和销毁回调。
 */

/**
 * 对象池配置选项
 */
export interface ObjectPoolOptions<T> {
  /** 池子最大容量 */
  max: number;
  /** 淘汰或清空时的销毁回调 */
  onEvict?: (item: T) => void;
}

/**
 * 通用 LRU 对象池
 *
 * 按 key 管理对象生命周期，最近使用的 key 保留，超限时淘汰最久未使用的。
 *
 * @example
 * ```ts
 * const pool = new ObjectPool({
 *   max: 10,
 *   onEvict: (canvas) => { canvas.clear(); canvas.dispose(); },
 * });
 *
 * const canvas = pool.acquire(key, () => new StaticCanvas(...));
 * pool.clear();
 * ```
 */
export class ObjectPool<T> {
  readonly #pool = new Map<string, T>();
  readonly #max: number;
  readonly #onEvict: ((item: T) => void) | undefined;

  constructor(options: ObjectPoolOptions<T>) {
    this.#max = options.max;
    this.#onEvict = options.onEvict;
  }

  /**
   * 获取或创建对象
   *
   * 缓存命中时移到末尾（最近使用），未命中且池满时淘汰最久未使用的对象，
   * 然后调用 factory 创建新对象。
   *
   * @param key - 缓存键
   * @param factory - 创建新对象的工厂函数
   * @returns 池中对象
   */
  acquire(key: string, factory: () => T): T {
    if (this.#pool.has(key)) {
      const entry = this.#pool.get(key)!;
      // 移到末尾（最近使用）
      this.#pool.delete(key);
      this.#pool.set(key, entry);
      return entry;
    }

    // 超限：淘汰最久未使用的
    if (this.#pool.size >= this.#max) {
      const oldestKey = this.#pool.keys().next().value!;
      const oldest = this.#pool.get(oldestKey)!;
      this.#onEvict?.(oldest);
      this.#pool.delete(oldestKey);
    }

    const entry = factory();
    this.#pool.set(key, entry);
    return entry;
  }

  /**
   * 清空池中所有对象
   *
   * 每个对象都会触发 onEvict 回调。
   */
  clear(): void {
    for (const entry of this.#pool.values()) {
      this.#onEvict?.(entry);
    }
    this.#pool.clear();
  }

  /**
   * 检查 key 是否在池中
   */
  has(key: string): boolean {
    return this.#pool.has(key);
  }

  /**
   * 当前池大小
   */
  get size(): number {
    return this.#pool.size;
  }
}
