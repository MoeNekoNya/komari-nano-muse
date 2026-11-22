import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export default defineConfig(() => {
  const apiBase = process.env.API_BASE || ''
  const title = process.env.TITLE || 'CF Server Monitor'
  const backgroundImage = process.env.BACKGROUND_IMAGE || ''
  const cspApi = (process.env.CSP_API || '').split(',').map(value => value.trim()).filter(Boolean).join(' ')
  const cspStatic = (process.env.CSP_STATIC || '').split(',').map(value => value.trim()).filter(Boolean).join(' ')
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https:",
    "style-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https:",
    "img-src 'self' data: blob: https: " + cspStatic,
    "font-src 'self' data: https: " + cspStatic,
    "connect-src 'self' https: wss: " + cspApi,
    "frame-src https://challenges.cloudflare.com"
  ].join('; ')

  return {
    base: './',
    publicDir: false,
    plugins: [
      vue(),
      {
        name: 'cfsm-runtime-meta',
        transformIndexHtml(html) {
          return html
            .replaceAll('__API_BASE__', esc(apiBase))
            .replaceAll('__BUILD_TITLE__', esc(title))
            .replaceAll('__BACKGROUND_IMAGE__', esc(backgroundImage))
            .replaceAll('__CSP_API__', esc(cspApi))
            .replaceAll('__CSP_STATIC__', esc(cspStatic))
            .replaceAll('__CSP_POLICY__', esc(csp))
        }
      }
    ],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js'
        }
      }
    }
  }
})
