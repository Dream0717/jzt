<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
const titles = {
  home: '九州通读码数据验收 · 城市管理',
  city: '日期文件夹',
  day: '验收数据明细',
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-inner">
        <span class="logo">📦 九州通读码数据验收</span>
        <span class="crumb">{{ titles[route.name] || '' }}</span>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-header {
  background: #1f3a5f;
  color: #fff;
  padding: 14px 24px;
}
.app-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.logo {
  font-size: 18px;
  font-weight: 600;
}
.crumb {
  font-size: 13px;
  opacity: 0.75;
}
</style>
