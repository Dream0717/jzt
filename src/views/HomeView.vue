<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listCities, createCity, deleteCity } from '../api.js'

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
    alert(e.message)
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
    await refresh()
  } catch (e) {
    alert(e.message)
  }
}

async function removeCity(city) {
  const dayCount = city.day_count || 0
  const tip = dayCount
    ? `该城市下有 ${dayCount} 个日期文件夹及全部验收数据，删除后不可恢复！`
    : '删除后不可恢复！'
  if (!confirm(`确定删除城市「${city.name}」吗？${tip}`)) return
  try {
    await deleteCity(city.id)
    await refresh()
  } catch (e) {
    alert(e.message)
  }
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <div class="card toolbar">
      <input
        v-model="newName"
        class="city-input"
        placeholder="输入城市名称，如：南京"
        maxlength="20"
        @keyup.enter="addCity"
      />
      <button class="btn-primary" @click="addCity">+ 添加城市</button>
    </div>

    <div v-if="loading" class="empty-tip">加载中…</div>
    <div v-else-if="cities.length === 0" class="card empty-tip">
      还没有城市，先在上方添加一个吧
    </div>
    <div v-else class="city-grid">
      <div v-for="c in cities" :key="c.id" class="card city-card" @click="router.push(`/city/${c.id}`)">
        <div class="city-icon">🏙️</div>
        <div class="city-name">{{ c.name }}</div>
        <div class="city-meta">{{ c.day_count || 0 }} 个日期文件夹</div>
        <button class="btn-danger city-del" @click.stop="removeCity(c)">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  align-items: center;
}
.city-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}
.city-input:focus {
  border-color: #2f6fed;
}
.city-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
.city-card {
  position: relative;
  cursor: pointer;
  text-align: center;
  padding: 28px 16px;
  transition: all 0.15s;
}
.city-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 16px rgba(31, 58, 95, 0.15);
}
.city-icon {
  font-size: 34px;
}
.city-name {
  font-size: 18px;
  font-weight: 600;
  margin: 8px 0 4px;
}
.city-meta {
  font-size: 12px;
  color: #8a94a6;
}
.city-del {
  margin-top: 12px;
  font-size: 12px;
  padding: 5px 14px;
}
</style>
