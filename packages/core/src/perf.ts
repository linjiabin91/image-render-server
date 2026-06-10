/** 树状快照节点 */
export interface PerfNode {
    /** 节点名称 */
    name: string;
    /** 耗时（毫秒） */
    elapsed: number;
    /** 子节点 */
    children?: PerfNode[];
}

/**
 * 性能计时器
 *
 * 替代各引擎中重复的 #perf() 私有方法。
 * 通过 children 数组呈现树状结构，打印时递归遍历。
 *
 * @example 扁平用法（大部分场景）
 * ```ts
 * const perf = new PerfTimer("render");
 * perf.mark("preload");
 * perf.mark("leafer");
 * perf.mark("encode");
 * logger.info({ steps: perf.steps(), tree: perf.print() }, "render");
 * ```
 *
 * @example 树状用法（分组场景）
 * ```ts
 * const perf = new PerfTimer("render");
 * perf.mark("preload");
 * perf.mark("leafer");
 *
 * const encode = new PerfTimer("encode");
 * perf.children.push(encode);
 * encode.mark("pixels");
 * encode.mark("compress");
 *
 * perf.mark("export");
 * logger.info({ tree: perf.print() }, "render");
 * ```
 */
export class PerfTimer {
    /** 监控点名称 */
    readonly name: string;
    /** 开始时间戳（构造时自动记录） */
    readonly start: number;
    /** 子监控点列表 */
    readonly children: PerfTimer[] = [];

    constructor(name: string) {
        this.name = name;
        this.start = performance.now();
    }

    /**
     * 记录一个子监控点
     *
     * @param name - 监控点名称
     */
    mark(name: string): void {
        this.children.push(new PerfTimer(name));
    }

    /**
     * 获取自身耗时（毫秒）
     *
     * 从 start 到最后一个子节点 start 的间隔。
     *
     * @param now - 外部传入当前时间（可选，仅用于批量获取时减少 performance.now 调用）
     */
    elapsed(now?: number): number {
        const end = this.#lastStart(now);
        return +(end - this.start).toFixed(1);
    }

    /**
     * 获取扁平步骤耗时
     *
     * DFS 遍历所有叶子节点，每个值为从上一次 mark 到本次 mark 的间隔（毫秒）。
     * 兼容旧版 `logger.info({ steps: perf.steps(), ... })` 调用。
     */
    steps(): Record<string, number> {
        const result: Record<string, number> = {};
        const leaves = this.#collectLeaves();
        let prev = this.start;
        for (const leaf of leaves) {
            result[leaf.name] = +(leaf.start - prev).toFixed(1);
            prev = leaf.start;
        }
        return result;
    }

    /**
     * 获取树状快照
     *
     * 返回结构化对象，配合 pino 日志自动格式化。
     *
     * @example pino-pretty 输出效果
     * ```
     * [12:00:00] INFO: render
     *     tree: {
     *       name: "render",
     *       elapsed: 210,
     *       children: [
     *         { name: "preload", elapsed: 10 },
     *         { name: "leafer", elapsed: 150 },
     *         { name: "encode", elapsed: 50,
     *           children: [
     *             { name: "pixels", elapsed: 20 },
     *             { name: "compress", elapsed: 30 }
     *           ]
     *         }
     *       ]
     *     }
     * ```
     */
    snapshot(): PerfNode {
        return this.#toNode();
    }

    /** @deprecated 请改用 snapshot() */
    print(): PerfNode {
        return this.snapshot();
    }

    #toNode(wallEnd?: number): PerfNode {
        const end = wallEnd ?? performance.now();
        const elapsed = +(end - this.start).toFixed(1);

        if (this.children.length === 0) {
            return { name: this.name, elapsed };
        }

        const children = this.children.map((c, i) => {
            const childEnd = i < this.children.length - 1
                ? this.children[i + 1].start
                : end;
            return c.#toNode(childEnd);
        });

        return { name: this.name, elapsed, children };
    }

    /** DFS 收集所有叶子节点 */
    #collectLeaves(): PerfTimer[] {
        if (this.children.length === 0) return [this];
        const result: PerfTimer[] = [];
        for (const child of this.children) {
            result.push(...child.#collectLeaves());
        }
        return result;
    }

    /** 获取最后一个子节点的 start 时间（递归） */
    #lastStart(fallback?: number): number {
        if (this.children.length === 0) return fallback ?? performance.now();
        return this.children[this.children.length - 1].#lastStart(fallback);
    }
}