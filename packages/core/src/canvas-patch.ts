/**
 * Canvas DOM 方法修补
 *
 * @napi-rs/canvas 的 Canvas 实例缺少浏览器 HTMLCanvasElement 的 DOM 方法，
 * 各前端渲染库（Fabric.js、Konva）在服务端运行时会访问这些方法。
 * 此处取 fabric-engine / fabric5-engine / konva-engine 所需 DOM 桩的并集，
 * 统一修补。
 */

/** 修补后 Canvas 的最小 DOM 接口 */
export interface PatchedCanvas {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    hasAttribute(name: string): boolean;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    classList: Pick<DOMTokenList, 'add' | 'remove' | 'contains' | 'toggle'>;
    parentNode: Node | null;
    style: Record<string, string>;
    width: number;
    height: number;
    focus(): void;
    getBoundingClientRect(): DOMRect;
}

/**
 * 给 @napi-rs/canvas Canvas 实例补齐浏览器 HTMLCanvasElement 的 DOM 桩方法
 *
 * @param canvas - @napi-rs/canvas Canvas 实例
 * @returns 修补后的 canvas
 */
export const patchCanvas = <T>(canvas: T): T & PatchedCanvas => {
    const c = canvas as unknown as PatchedCanvas;

    if (!c.getAttribute) c.getAttribute = (n: string) => n === 'dir' ? 'ltr' : null;
    if (!c.setAttribute) c.setAttribute = () => {};
    if (!c.removeAttribute) c.removeAttribute = () => {};
    if (!c.hasAttribute) c.hasAttribute = () => false;
    if (!c.addEventListener) c.addEventListener = () => {};
    if (!c.removeEventListener) c.removeEventListener = () => {};
    if (!c.classList) c.classList = { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false };
    if (!c.parentNode) c.parentNode = null;
    if (!c.focus) c.focus = () => {};
    if (!c.getBoundingClientRect) {
        const w = () => (canvas as unknown as { width?: number }).width || 0;
        const h = () => (canvas as unknown as { height?: number }).height || 0;
        c.getBoundingClientRect = () => ({
            width: w(),
            height: h(),
            top: 0,
            left: 0,
            right: w(),
            bottom: h(),
            x: 0,
            y: 0,
            toJSON() { return this; },
        });
    }
    if (!c.style) Object.defineProperty(c, 'style', {value: {}, writable: true});

    return canvas as T & PatchedCanvas;
};
