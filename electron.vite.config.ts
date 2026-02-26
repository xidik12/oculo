import { defineConfig, externalizeDepsPlugin, bytecodePlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const edition = process.env.OCULO_EDITION || 'private'
const enableOAuth = edition === 'private'

// Compile-time flag for renderer UI gating (OAuth buttons, badges)
function oculoDefinePlugin(): any {
  return {
    name: 'oculo-define',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.includes('node_modules') && code.includes('__ENABLE_OAUTH__')) {
        return { code: code.replace(/__ENABLE_OAUTH__/g, String(enableOAuth)), map: null }
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      bytecodePlugin(),
      oculoDefinePlugin()
    ],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        // Edition split: swap oauth-manager.ts for oauth-stub.ts in public builds
        './oauth-manager': enableOAuth
          ? resolve('src/main/ai/oauth-manager.ts')
          : resolve('src/main/ai/oauth-stub.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    plugins: [react(), oculoDefinePlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    build: {
      minify: 'terser',
      terserOptions: {
        mangle: { toplevel: true },
        compress: { dead_code: true, drop_console: edition === 'public' }
      }
    },
  }
})
