<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { listReasonCategories, listReasonCategoryData, updateReasonCategorySetting } from '../api.js'
import { isAuthCancelled, username } from '../auth.js'
import { useRouter } from 'vue-router'
const router = useRouter(), loading = ref(false), rows = ref([]), owner = ref('客户'), selected = ref(null)
const city = ref(''), date = ref(''), detail = ref({ rows: [], cities: [], dates: [] })
const ownerRows = computed(() => rows.value.filter(r => r.owner === owner.value))
async function load() { loading.value = true; try { const d = await listReasonCategories(); rows.value = d.categories || [] } catch(e) { if (!isAuthCancelled(e)) ElMessage.error(e.message) } finally { loading.value = false } }
async function fetchDetail() { if (!selected.value) return; detail.value = await listReasonCategoryData(selected.value.category, { owner: owner.value, city: city.value, date: date.value }) }
async function open(row) { selected.value = row; city.value = ''; date.value = ''; await fetchDetail() }
async function change(row, value) { const old = row.warn_no_remark; row.warn_no_remark = !!value; try { await updateReasonCategorySetting(row.category, value) } catch(e) { row.warn_no_remark = old; ElMessage.error(e.message) } }
watch(owner, () => { selected.value = null; detail.value = { rows: [], cities: [], dates: [] } })
watch([city, date], fetchDetail)
onMounted(load)
</script>
<template>
  <div class="page reason-page"><div class="page-head"><div><h2>原因类型</h2><p class="muted">按客户与我方分类查看原因及明细。</p></div><div><el-button @click="router.back()">返回</el-button><el-button :loading="loading" @click="load">刷新</el-button></div></div>
    <el-tabs v-model="owner"><el-tab-pane label="客户原因" name="客户"/><el-tab-pane label="我方原因" name="我方"/></el-tabs>
    <el-table v-loading="loading" :data="ownerRows" border stripe @row-click="open"><el-table-column prop="category" label="原因" min-width="300"/><el-table-column prop="count" label="数量" width="100" align="center"/><el-table-column label="无备注图片显示感叹号" width="220" align="center"><template #default="s"><el-switch :disabled="username !== 'dream'" :model-value="!!s.row.warn_no_remark" @update:model-value="change(s.row,$event)"/></template></el-table-column></el-table>
    <el-card v-if="selected" class="detail-card" shadow="never"><template #header><b>{{ owner }} · {{ selected.category }}</b></template><div class="filters"><el-select v-model="city" clearable placeholder="选择地区"><el-option v-for="x in detail.cities" :key="x" :label="x" :value="x"/></el-select><el-select v-model="date" clearable placeholder="选择日期"><el-option v-for="x in detail.dates" :key="x" :label="x" :value="x"/></el-select></div><el-table :data="detail.rows" border stripe><el-table-column prop="city" label="地区"/><el-table-column prop="day_date" label="日期"/><el-table-column prop="doc_no" label="单据"/><el-table-column prop="serial_no" label="条码"/><el-table-column prop="goods_name" label="商品"/><el-table-column prop="reason_note" label="原因"/></el-table></el-card>
  </div>
</template>
<style scoped>.reason-page{padding:24px}.page-head{display:flex;justify-content:space-between;margin-bottom:12px}h2{margin:0 0 8px;color:#1f3a5f}.muted{color:#909399;margin:0}.detail-card{margin-top:20px}.filters{display:flex;gap:12px;margin-bottom:14px}.filters .el-select{width:220px}</style>
