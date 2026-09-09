import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteMcp } from 'vite-mcp'

export default defineConfig({
  plugins: [
    vue(),
    // vite-mcp：在 /__mcp 端点暴露 MCP 服务，提供浏览器控制台/存储/组件树等调试能力
    viteMcp(),
  ],
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
