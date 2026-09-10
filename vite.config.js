import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteMcp } from 'vite-mcp'

export default defineConfig({
  plugins: [
    vue(),
    viteMcp(),
  ],
  optimizeDeps: {
    include: ['element-plus', '@vue-office/excel', 'vue-demi'],
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
