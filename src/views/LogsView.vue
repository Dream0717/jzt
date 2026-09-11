<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { listAuditLogs } from '../api.js'
import { isLoggedIn, showLoginModal } from '../auth.js'

const router = useRouter()
const logs = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const keyword = ref('')
const loading = ref(false)

async function load() {
  if (!isLoggedIn.value) {
    showLoginModal.value = true
    return
  }
  loading.value = true
  try {
    const data = await listAuditLogs({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim(),
    })
    logs.value = data.logs || []
    total.value = data.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载日志失败')
  } finally {
    loading.value = false
  }
}

function formatTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDetail(detail) {
  if (detail == null || detail === '') return '-'
  if (typeof detail === 'object') return JSON.stringify(detail)
  try {
    const parsed = JSON.parse(detail)
    return typeof parsed === 'object' ? JSON.stringify(parsed) : String(detail)
  } catch {
    return String(detail)
  }
}

let searchTimer = null
watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    load()
  }, 300)
})

watch(isLoggedIn, (ok) => {
  if (ok) load()
})

function onPageChange() {
  load()
}

function onSizeChange() {
  page.value = 1
  load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="nav-back">
      <el-button @click="router.push('/')">← 返回城市</el-button>
      <span class="page-title">操作日志</span>
    </div>

    <el-card shadow="never" class="page-card toolbar-card">
      <div class="toolbar">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索账号 / 操作 / 详情"
          style="max-width: 320px"
        />
        <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
      </div>
    </el-card>

    <div class="table-wrap">
      <el-table v-loading="loading" :data="logs" stripe height="100%" empty-text="暂无日志">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="action" label="操作" width="180" />
        <el-table-column label="详情" min-width="280">
          <template #default="{ row }">
            <span class="detail">{{ formatDetail(row.detail) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 10px;
}
.nav-back {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.page-title {
  font-size: 16px;
  font-weight: 600;
}
.toolbar-card {
  flex-shrink: 0;
  margin-bottom: 0 !important;
}
.toolbar-card :deep(.el-card__body) {
  padding: 12px 16px;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
}
.detail {
  font-family: Consolas, 'Microsoft YaHei', monospace;
  font-size: 12px;
  color: #606266;
  word-break: break-all;
  white-space: pre-wrap;
}
.pager {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
}
</style>
