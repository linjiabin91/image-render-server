/**
 * Konva 运行时类型 — 为 @napi-rs/canvas Node.js 环境提供精简类型。
 *
 * konva 自带类型声明在 TS 6.0 下因 namespace + export default 互操作问题
 * 无法正确解析。此文件仅提供引擎代码所需的运行时类型，不作模块声明。
 */

export interface Vector2d {
    x: number;
    y: number;
}

export interface NodeConfig {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    id?: string;
    name?: string;
    visible?: boolean;
    listening?: boolean;
    opacity?: number;
    draggable?: boolean;
    [key: string]: unknown;
}

export interface ShapeConfig extends NodeConfig {
    fill?: string;
    fillPatternImage?: unknown;
    fillPatternX?: number;
    fillPatternY?: number;
    fillPatternScaleX?: number;
    fillPatternScaleY?: number;
    stroke?: string;
    strokeWidth?: number;
    shadowColor?: string;
    shadowBlur?: number;
    shadowOffset?: Vector2d;
    shadowOpacity?: number;
    [key: string]: unknown;
}

export interface TextConfig extends ShapeConfig {
    text?: string;
    fontSize?: number;
    fontFamily?: string;
    fontStyle?: string;
    fontVariant?: string;
    textDecoration?: string;
    align?: string;
    verticalAlign?: string;
    padding?: number;
    lineHeight?: number;
    letterSpacing?: number;
    wrap?: string;
    ellipsis?: boolean;
    [key: string]: unknown;
}

export interface ImageConfig extends ShapeConfig {
    image?: unknown;
    crop?: Vector2d;
    [key: string]: unknown;
}

export interface StageConfig {
    container: unknown;
    width: number;
    height: number;
}

export interface KonvaNode {
    children?: KonvaNode[];
    getLayer(): KonvaLayer;
    getStage(): KonvaStage;
    getClassName(): string;
    destroy(): void;
    [key: string]: unknown;
}

export interface KonvaLayer extends KonvaNode {
    canvas: KonvaCanvasWrap;
    getContext(): KonvaContext;
    draw(): void;
    clear(): void;
    destroy(): void;
    children?: KonvaNode[];
    add(...children: KonvaNode[]): void;
    destroyChildren(): void;
}

export interface KonvaStage extends KonvaNode {
    width: number;
    height: number;
    add(...layers: KonvaLayer[]): void;
    destroy(): void;
}

export interface KonvaGroup extends KonvaNode {
    add(...children: KonvaNode[]): void;
    children?: KonvaNode[];
}

export interface KonvaText extends KonvaNode {
    text(val?: string): string;
    fontSize(val?: number): number;
    fontFamily(val?: string): string;
    fill(val?: string): string;
}

export interface KonvaKonvaImage extends KonvaNode {
    image(val?: unknown): unknown;
}

export interface KonvaContext {
    _context: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
}

export interface KonvaCanvasWrap {
    getCanvas(): HTMLCanvasElement;
    getContext(): KonvaContext;
    width: number;
    height: number;
}

export interface KonvaUtil {
    createCanvasElement(): HTMLCanvasElement;
    createImageElement(): HTMLImageElement;
    releaseCanvas(...canvases: HTMLCanvasElement[]): void;
    [key: string]: unknown;
}

export interface KonvaNamespace {
    autoDrawEnabled: boolean;
    pixelRatio: number;
    showWarnings: boolean;
    releaseCanvasOnDestroy: boolean;
    Util: KonvaUtil;
    Stage: new (config: StageConfig) => KonvaStage;
    Layer: new () => KonvaLayer;
    Group: new (config?: NodeConfig) => KonvaGroup;
    Text: new (config?: TextConfig) => KonvaText;
    Image: new (config?: ImageConfig) => KonvaKonvaImage;
    [key: string]: unknown;
}
