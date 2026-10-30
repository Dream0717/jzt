<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listTrash, restoreTrash, purgeTrash } from '../api.js'
import { isAuthCancelled } from '../auth.js'

const router = useRouter()
const items = ref([])
const loading = ref(false)
async function load() {
  loading.value = true
  try { items.value = (await listTrash()).items || [] } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
async function restore(item) {
  try { await restoreTrash(item.id); ElMessage.success('已恢复'); await load() } catch (e) { if (!isAuthCancelled(e)) ElMessage.error(e.message) }
}
async function purge(item) {
  try { await ElMessageBox.confirm(`彻底删除「${item.label || item.item_type}」？此操作不可恢复。`, '确认删除', { type: 'error' }) } catch { return }
  try { await purgeTrash(item.id); ElMessage.success('已彻底删除'); await load() } catch (e) { if (!isAuthCancelled(e)) ElMessage.error(e.message) }
}
onMounted(load)
</script>
<template>
  <div class="page trash-page" v-loading="loading">
    <div class="nav-back"><el-button @click="router.push('/')">← 返回城市</el-button><span class="city-title">回收站</span></div>
    <el-card shadow="never"><el-empty v-if="!loading && !items.length" description="回收站为空" /><el-table v-else :data="items" stripe>
      <el-table-column prop="label" label="项目" min-width="260" />
      <el-table-column prop="item_type" label="类型" width="110" />
      <el-table-column prop="deleted_by" label="删除人" width="120" />
      <el-table-column prop="deleted_at" label="删除时间" width="190" />
      <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="restore(row)">恢复</el-button><el-button link type="danger" @click="purge(row)">彻底删除</el-button></template></el-table-column>
    </el-table></el-card>
  </div>
</template>
