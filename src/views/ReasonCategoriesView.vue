<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { listReasonCategories, updateReasonCategorySetting } from '../api.js'
import { isAuthCancelled, username } from '../auth.js'
import { useRouter } from 'vue-router'
const router = useRouter(), loading = ref(false), rows = ref([]), owner = ref('客户')
const ownerRows = computed(() => rows.value.filter(r => r.owner === owner.value))
async function load() { loading.value = true; try { const d = await listReasonCategories(); rows.value = d.categories || [] } catch(e) { if (!isAuthCancelled(e)) ElMessage.error(e.message) } finally { loading.value = false } }
function open(row) { router.push({ name: 'reason-category-detail', params: { category: row.category }, query: { owner: owner.value } }) }
async function change(row, value) { const old = row.warn_no_remark; row.warn_no_remark = !!value; try { await updateReasonCategorySetting(row.category, value) } catch(e) { row.warn_no_remark = old; ElMessage.error(e.message) } }
onMounted(load)
</script>
<template>
  <div class="page reason-page"><div class="page-head"><div><h2>原因类型</h2><p class="muted">按客户与我方分类查看原因及明细。</p></div><div><el-button @click="router.back()">返回</el-button><el-button :loading="loading" @click="load">刷新</el-button></div></div>
    <el-tabs v-model="owner"><el-tab-pane label="客户原因" name="客户"/><el-tab-pane label="我方原因" name="我方"/></el-tabs>
    <el-table v-loading="loading" :data="ownerRows" border stripe @row-click="open"><el-table-column prop="category" label="原因" min-width="300"/><el-table-column prop="count" label="数量" width="100" align="center"/><el-table-column label="无备注图片显示感叹号" width="220" align="center"><template #default="s"><el-switch :disabled="username !== 'dream'" :model-value="!!s.row.warn_no_remark" @update:model-value="change(s.row,$event)"/></template></el-table-column></el-table>
  </div>
</template>
<style scoped>.reason-page{padding:24px}.page-head{display:flex;justify-content:space-between;margin-bottom:12px}h2{margin:0 0 8px;color:#1f3a5f}.muted{color:#909399;margin:0}.detail-card{margin-top:20px}.filters{display:flex;gap:12px;margin-bottom:14px}.filters .el-select{width:220px}</style>
