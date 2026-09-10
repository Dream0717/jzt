import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteMcp } from 'vite-mcp'

export default defineConfig({
  plugins: [
    vue(),
    viteMcp(),
  ],
  optimizeDeps: {
    include: [
      'element-plus',
      'react',
      'react-dom',
      'rxjs',
      '@univerjs/presets',
      '@univerjs/preset-sheets-core',
      '@univerjs/preset-sheets-drawing',
      'univer-file-import',
      'exceljs',
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
