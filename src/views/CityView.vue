<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listDays, createDay, deleteDay, listDayExcels, uploadDayExcel, deleteExcel } from '../api.js'
import { isAuthCancelled } from '../auth.js'

const props = defineProps({ cityId: String })
const router = useRouter()
const cityName = ref('')
const days = ref([])
const loading = ref(false)
const showAdd = ref(false)
const newDate = ref('')
const importingDayId = ref(null)

const showExcelPanel = ref(false)
const excelDay = ref(null)
const excelFiles = ref([])
const loadingExcels = ref(false)

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
  newDate.value = todayStr()
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
  const excelCount = day.excel_count || 0
  const tipParts = []
  if (recCount) tipParts.push(`${recCount} 条验收数据`)
  if (excelCount) tipParts.push(`${excelCount} 个 Excel 文件`)
  const tip = tipParts.length
    ? `该日期下有 ${tipParts.join('、')}，删除后不可恢复！`
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

async function onImportExcel(e, day) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    alert('请选择 .xls 或 .xlsx 文件')
    return
  }
  importingDayId.value = day.id
  try {
    const r = await uploadDayExcel(day.id, file)
    await refresh()
    if (confirm(`已导入「${r.file_name}」，是否立即打开浏览？`)) {
      router.push(`/excel/${r.id}`)
    }
  } catch (err) {
    if (isAuthCancelled(err)) return
    alert(err.message)
  } finally {
    importingDayId.value = null
  }
}

async function openExcelPanel(day) {
  excelDay.value = day
  showExcelPanel.value = true
  loadingExcels.value = true
  try {
    const data = await listDayExcels(day.id)
    excelFiles.value = data.files || []
  } catch (e) {
    alert(e.message)
    showExcelPanel.value = false
  } finally {
    loadingExcels.value = false
  }
}

function openExcel(file) {
  showExcelPanel.value = false
  router.push(`/excel/${file.id}`)
}

async function removeExcelFile(file) {
  if (!confirm(`确定删除「${file.file_name}」吗？`)) return
  try {
    await deleteExcel(file.id)
    excelFiles.value = excelFiles.value.filter((f) => f.id !== file.id)
    await refresh()
    if (excelFiles.value.length === 0) showExcelPanel.value = false
  } catch (e) {
    if (isAuthCancelled(e)) return
    alert(e.message)
  }
}

function fmtSize(n) {
  const size = Number(n) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
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
      <div v-for="d in days" :key="d.id" class="card day-card">
        <div class="day-date" @click="router.push(`/day/${d.id}`)">{{ d.day_date }}</div>
        <div class="day-week">{{ fmtWeek(d.day_date) }}</div>
        <div class="day-meta" @click="router.push(`/day/${d.id}`)">
          <span v-if="d.record_count > 0">
            {{ d.record_count }} 条 · {{ d.category_count || 0 }} 类
            <span class="scan-rate" title="读码率 = (总数 − 我方问题) ÷ 总数 × 100%">
              读码率 <em>{{ scanRateOf(d) }}</em>
            </span>
          </span>
          <span v-else class="day-empty">验收数据未导入</span>
          <span v-if="d.excel_count > 0" class="excel-count">Excel {{ d.excel_count }} 个</span>
        </div>

        <div class="day-actions">
          <button class="btn-ghost btn-sm" type="button" @click="router.push(`/day/${d.id}`)">验收明细</button>
          <label class="btn-primary btn-sm import-excel" :class="{ disabled: importingDayId === d.id }">
            {{ importingDayId === d.id ? '导入中…' : '导入Excel' }}
            <input
              type="file"
              accept=".xls,.xlsx"
              :disabled="importingDayId === d.id"
              @change="onImportExcel($event, d)"
            />
          </label>
          <button
            v-if="d.excel_count > 0"
            class="btn-ghost btn-sm"
            type="button"
            @click="openExcelPanel(d)"
          >
            打开Excel
          </button>
          <button class="btn-danger btn-sm" type="button" @click="removeDay(d)">删除</button>
        </div>
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

    <div v-if="showExcelPanel" class="modal-mask" @click.self="showExcelPanel = false">
      <div class="card modal excel-modal">
        <h3>{{ excelDay?.day_date }} · Excel 文件</h3>
        <div v-if="loadingExcels" class="empty-tip">加载中…</div>
        <ul v-else-if="excelFiles.length" class="excel-list">
          <li v-for="f in excelFiles" :key="f.id">
            <div class="excel-info">
              <div class="excel-name" :title="f.file_name">{{ f.file_name }}</div>
              <div class="excel-meta">{{ fmtSize(f.file_size) }} · {{ f.created_at }}</div>
            </div>
            <div class="excel-btns">
              <button class="btn-primary btn-sm" type="button" @click="openExcel(f)">打开</button>
              <button class="btn-danger btn-sm" type="button" @click="removeExcelFile(f)">删除</button>
            </div>
          </li>
        </ul>
        <div v-else class="empty-tip">暂无 Excel 文件</div>
        <div class="modal-actions">
          <button class="btn-ghost" @click="showExcelPanel = false">关闭</button>
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
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.day-card {
  position: relative;
  text-align: center;
  padding: 22px 14px 16px;
  transition: all 0.15s;
}
.day-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(31, 58, 95, 0.15);
}
.day-date {
  font-size: 20px;
  font-weight: 700;
  color: #1f3a5f;
  cursor: pointer;
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
  cursor: pointer;
}
.day-meta .scan-rate {
  margin-left: 0;
}
.day-empty {
  color: #b0b8c7;
}
.excel-count {
  color: #1d8a4b;
}
.day-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
}
.btn-sm {
  font-size: 12px;
  padding: 5px 10px;
}
.import-excel {
  position: relative;
  overflow: hidden;
  display: inline-block;
}
.import-excel.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.import-excel input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
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
.excel-modal {
  width: 480px;
  max-width: calc(100vw - 32px);
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
.excel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow: auto;
}
.excel-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #edf0f5;
}
.excel-info {
  min-width: 0;
  flex: 1;
  text-align: left;
}
.excel-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.excel-meta {
  font-size: 12px;
  color: #8a94a6;
  margin-top: 2px;
}
.excel-btns {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
