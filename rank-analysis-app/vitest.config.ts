import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src-tauri/',
        '**/*.d.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/assets/**',
        '**/dist/**'
      ],
      // vitest 4 v8 provider 实测:lines 73.32% / functions 62.79% / branches 59.95% / statements 71.17%
      // （vitest 1 旧 provider 基线:lines 16.47% / functions 46.7% / branches 74.83% / statements 16.47%
      //   ——provider 换代后分支计量口径变化,threshold 按新口径 floor 重设;代码覆盖未倒退）
      // threshold 锁定在 floor 附近做"无回归基线"——禁止 PR 让覆盖率倒退，
      // 而非达成 80%。CLAUDE.md 中 80% 仍为长期目标，靠后续 PR 增加测试逐步抬升。
      thresholds: {
        lines: 73,
        functions: 62,
        branches: 59,
        statements: 71
      }
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, './src')
    }
  }
})
