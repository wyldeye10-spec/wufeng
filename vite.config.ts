import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 无锋 / WUFENG
// 纯静态站点：默认使用相对 base，可直接部署在任意子目录（GitHub Pages、NAS、静态托管）。
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2020',
    cssTarget: 'safari15',
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 900,
  },
})
