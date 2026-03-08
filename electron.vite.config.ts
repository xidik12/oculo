import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['@modelcontextprotocol/sdk', '@anthropic-ai/sdk', 'zod', 'turndown', '@mozilla/readability'] })
    ],
    build: {
      sourcemap: true
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'webview-preload': resolve('src/preload/webview-preload.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    build: {
      sourcemap: true
    },
  }
})
