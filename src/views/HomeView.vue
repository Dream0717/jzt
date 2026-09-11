<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listCities, createCity, deleteCity } from '../api.js'
import { isAuthCancelled } from '../auth.js'

const router = useRouter()
const cities = ref([])
const loading = ref(false)
const newName = ref('')

async function refresh() {
  loading.value = true
  try {
    const data = await listCities()
    cities.value = data.cities
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function addCity() {
  const name = newName.value.trim()
  if (!name) return
  try {
    await createCity(name)
    newName.value = ''
    ElMessage.success('已添加城市')
    await refresh()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  }
}

async function removeCity(city) {
  const dayCount = city.day_count || 0
  const tip = dayCount
    ? `该城市下有 ${dayCount} 个日期文件夹及全部验收数据，删除后不可恢复！`
    : '删除后不可恢复！'
  try {
    await ElMessageBox.confirm(`确定删除城市「${city.name}」吗？${tip}`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await deleteCity(city.id)
    ElMessage.success('已删除')
    await refresh()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  }
}

onMounted(refresh)
</script>

<template>
  <div class="page" v-loading="loading">
    <el-card shadow="never" class="page-card">
      <div class="toolbar">
        <el-input
          v-model="newName"
          placeholder="输入城市名称，如：南京"
          maxlength="20"
          clearable
          style="max-width: 360px"
          @keyup.enter="addCity"
        />
        <el-button type="primary" @click="addCity">+ 添加城市</el-button>
      </div>
    </el-card>

    <el-empty v-if="!loading && cities.length === 0" description="还没有城市，先在上方添加一个吧" />
    <el-row v-else :gutter="16">
      <el-col v-for="c in cities" :key="c.id" :xs="24" :sm="12" :md="8" :lg="6">
        <el-card shadow="hover" class="city-card" @click="router.push(`/city/${c.id}`)">
          <div class="city-name">{{ c.name }}</div>
          <div class="city-meta">{{ c.day_count || 0 }} 个日期文件夹</div>
          <el-button type="danger" plain size="small" @click.stop="removeCity(c)">删除</el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  max-width: 100%;
  overflow-x: hidden;
  overflow-y: auto;
}
.page :deep(.el-row) {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.city-card {
  margin-bottom: 16px;
  text-align: center;
  cursor: pointer;
}
.city-name {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
}
.city-meta {
  font-size: 12px;
  color: #909399;
  margin-bottom: 12px;
}
</style>
