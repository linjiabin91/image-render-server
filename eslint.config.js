// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', '**/pages/**'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            // 禁止 as any — 库边界必须加 eslint-disable 注释说明理由
            '@typescript-eslint/no-explicit-any': 'warn',
            // 禁止不必要的类型断言（如 const x = foo as Bar 但 foo 已经是 Bar）
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        },
    },
    {
        files: ['packages/leafer-engine/**/*.ts'],
        rules: {
            // leafer 引擎大量使用 leafer 内部 API，any 是已知的库边界
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
