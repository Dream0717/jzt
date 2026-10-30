<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { listReasonCategoryData } from '../api.js'
import { ElMessage } from 'element-plus'
const props = defineProps({ category: String, owner: { type: String, default: '客户' } })
const router = useRouter(), city = ref(''), date = ref(''), loading = ref(false), detail = ref({ rows: [], cities: [], dates: [] })
async function load() { loading.value = true; try { detail.value = await listReasonCategoryData(props.category, { owner: props.owner, city: city.value, date: date.value }) } catch(e) { ElMessage.error(e.message) } finally { loading.value = false } }
watch([city, date], load); onMounted(load)
</script>
<template><div class="page detail-page"><div class="head"><div><el-button @click="router.push('/reason-categories')">← 返回原因类型</el-button><h2>{{ owner }} · {{ category }}</h2></div><el-button :loading="loading" @click="load">刷新</el-button></div><div class="filters"><el-select v-model="city" clearable placeholder="选择地区"><el-option v-for="x in detail.cities" :key="x" :label="x" :value="x"/></el-select><el-select v-model="date" clearable placeholder="选择日期"><el-option v-for="x in detail.dates" :key="x" :label="x" :value="x"/></el-select></div><el-table v-loading="loading" :data="detail.rows" border stripe><el-table-column prop="city" label="地区"/><el-table-column prop="day_date" label="日期"/><el-table-column prop="doc_no" label="单据"/><el-table-column prop="serial_no" label="条码"/><el-table-column prop="goods_name" label="商品"/><el-table-column prop="reason_note" label="原因"/></el-table></div></template>
<style scoped>.detail-page{padding:24px}.head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px}h2{margin:16px 0 0;color:#1f3a5f}.filters{display:flex;gap:12px;margin-bottom:14px}.filters .el-select{width:220px}</style>
