<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listDays, createDay, deleteDay } from '../api.js'
import { isAuthCancelled } from '../auth.js'

const props = defineProps({ cityId: String })
const router = useRouter()
const cityName = ref('')
const days = ref([])
const loading = ref(false)
const showAdd = ref(false)
const newDate = ref('')

function todayStr() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

async function refresh() {
  loading.value = true
  try {
    const data = await listDays(props.cityId)
    cityName.value = data.city?.name || ''
    days.value = data.days
    document.title = `${cityName.value} - 日期文件夹`
  } catch (e) {
    alert(e.message)
  } finally {
    loading.value = false
  }
}

function openAdd() {
  newDate.value = todayStr() // 默认当天
  showAdd.value = true
}

async function confirmAdd() {
  if (!newDate.value) return
  try {
    await createDay(props.cityId, newDate.value)
    showAdd.value = false
    await refresh()
  } catch (e) {
    if (isAuthCancelled(e)) return
    alert(e.message)
  }
}

async function removeDay(day) {
  const recCount = day.record_count || 0
  const tip = recCount
    ? `该日期下已导入 ${recCount} 条验收数据，删除后不可恢复！`
    : '删除后不可恢复！'
  if (!confirm(`确定删除日期「${day.day_date}」吗？${tip}`)) return
  try {
    await deleteDay(day.id)
    await refresh()
  } catch (e) {
    if (isAuthCancelled(e)) return
    alert(e.message)
  }
}

function fmtWeek(dateStr) {
  const weeks = ['日', '一', '二', '三', '四', '五', '六']
  const d = new Date(dateStr + 'T00:00:00')
  return '周' + weeks[d.getDay()]
}

function scanRateOf(d) {
  const total = Number(d.record_count) || 0
  if (!total) return '—'
  const our = Number(d.our_miss_count) || 0
  return `${(((total - our) / total) * 100).toFixed(2)}%`
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <div class="nav-back">
      <button class="btn-ghost" @click="router.push('/')">← 返回城市列表</button>
      <span class="city-title">{{ cityName }}</span>
    </div>

    <div class="card toolbar">
      <span class="toolbar-label">日期文件夹（{{ days.length }}）</span>
      <button class="btn-primary" @click="openAdd">+ 添加日期</button>
    </div>

    <div v-if="loading" class="empty-tip">加载中…</div>
    <div v-else-if="days.length === 0" class="card empty-tip">
      还没有日期文件夹，点击右上角「添加日期」创建（默认为今天）
    </div>
    <div v-else class="day-grid">
      <div v-for="d in days" :key="d.id" class="card day-card" @click="router.push(`/day/${d.id}`)">
        <div class="day-date">{{ d.day_date }}</div>
        <div class="day-week">{{ fmtWeek(d.day_date) }}</div>
        <div class="day-meta">
          <span v-if="d.record_count > 0">
            {{ d.record_count }} 条 · {{ d.category_count || 0 }} 类
            <span class="scan-rate" title="读码率 = (总数 − 我方问题) ÷ 总数 × 100%">
              读码率 <em>{{ scanRateOf(d) }}</em>
            </span>
          </span>
          <span v-else class="day-empty">未导入</span>
        </div>
        <button class="btn-danger day-del" @click.stop="removeDay(d)">删除</button>
      </div>
    </div>

    <div v-if="showAdd" class="modal-mask" @click.self="showAdd = false">
      <div class="card modal">
        <h3>添加日期文件夹</h3>
        <input v-model="newDate" type="date" class="date-input" />
        <div class="modal-actions">
          <button class="btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn-primary" @click="confirmAdd">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nav-back {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.city-title {
  font-size: 16px;
  font-weight: 600;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.toolbar-label {
  font-size: 15px;
  font-weight: 600;
}
.day-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}
.day-card {
  position: relative;
  cursor: pointer;
  text-align: center;
  padding: 24px 14px;
  transition: all 0.15s;
}
.day-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 16px rgba(31, 58, 95, 0.15);
}
.day-date {
  font-size: 20px;
  font-weight: 700;
  color: #1f3a5f;
}
.day-week {
  font-size: 13px;
  color: #8a94a6;
  margin-top: 2px;
}
.day-meta {
  font-size: 12px;
  color: #2f6fed;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.day-meta .scan-rate {
  margin-left: 0;
}
.day-empty {
  color: #b0b8c7;
}
.day-del {
  margin-top: 10px;
  font-size: 12px;
  padding: 5px 14px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.modal {
  width: 340px;
}
.modal h3 {
  margin: 0 0 16px;
}
.date-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  font-size: 15px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
</style>
