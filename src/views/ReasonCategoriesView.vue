<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { listReasonCategories, updateReasonCategorySetting } from '../api.js'
import { isAuthCancelled } from '../auth.js'
import { useRouter } from 'vue-router'

const loading = ref(false)
const rows = ref([])
const router = useRouter()

async function load() {
  loading.value = true
  try {
    const data = await listReasonCategories()
    rows.value = data.categories || []
  } catch (e) {
    if (!isAuthCancelled(e)) ElMessage.error(e.message || '加载失败')
  } finally { loading.value = false }
}

async function change(row, value) {
  const old = !!row.warn_no_remark
  row.warn_no_remark = !!value
  try {
    await updateReasonCategorySetting(row.category, row.warn_no_remark)
    ElMessage.success('设置已保存')
  } catch (e) {
    row.warn_no_remark = old
    if (!isAuthCancelled(e)) ElMessage.error(e.message || '保存失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="page reason-page">
    <div class="page-head">
      <div>
        <h2>原因类型</h2>
        <p class="muted">查看各原因类型数量，并设置没有备注图片时是否显示感叹号。</p>
      </div>
      <div class="actions"><el-button @click="router.back()">返回</el-button><el-button :loading="loading" @click="load">刷新</el-button></div>
    </div>
    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="category" label="原因类型" min-width="260" />
      <el-table-column prop="count" label="数量" width="120" align="center" />
      <el-table-column label="无备注图片显示感叹号" width="220" align="center">
        <template #default="scope">
          <el-switch :model-value="!!scope.row.warn_no_remark" @update:model-value="change(scope.row, $event)" />
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && rows.length === 0" description="暂无原因类型" />
  </div>
</template>

<style scoped>
.reason-page { padding: 24px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
h2 { margin:0 0 8px; color:#1f3a5f; }
.muted { color:#909399; margin:0; font-size:13px; }
</style>
