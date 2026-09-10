<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
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
    ElMessage.error(e.message)
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
    ElMessage.success('已创建日期文件夹')
    await refresh()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
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
  try {
    await ElMessageBox.confirm(`确定删除日期「${day.day_date}」吗？${tip}`, '删除确认', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await deleteDay(day.id)
    ElMessage.success('已删除')
    await refresh()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
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

async function onImportExcel(opt, day) {
  const file = opt?.file
  if (!file) return
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('请选择 .xls 或 .xlsx 文件')
    return
  }

  let overwrite = false
  if ((day.excel_count || 0) > 0) {
    try {
      await ElMessageBox.confirm(
        `该日期已有 ${day.excel_count} 个 Excel 文件。重新导入将覆盖（删除旧文件后写入新文件），是否继续？`,
        '覆盖确认',
        { type: 'warning', confirmButtonText: '覆盖导入', cancelButtonText: '取消' }
      )
      overwrite = true
    } catch {
      return
    }
  }

  importingDayId.value = day.id
  try {
    const r = await uploadDayExcel(day.id, file, { overwrite })
    await refresh()
    try {
      await ElMessageBox.confirm(`已导入「${r.file_name}」，是否立即打开编辑？`, '导入成功', {
        confirmButtonText: '打开',
        cancelButtonText: '稍后',
        type: 'success',
      })
      router.push(`/excel/${r.id}`)
    } catch {
      // 稍后
    }
  } catch (err) {
    if (isAuthCancelled(err)) return
    ElMessage.error(err.message)
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
    ElMessage.error(e.message)
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
  try {
    await ElMessageBox.confirm(`确定删除「${file.file_name}」吗？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteExcel(file.id)
    excelFiles.value = excelFiles.value.filter((f) => f.id !== file.id)
    await refresh()
    ElMessage.success('已删除')
    if (excelFiles.value.length === 0) showExcelPanel.value = false
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
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
  <div class="page" v-loading="loading">
    <div class="nav-back">
      <el-button @click="router.push('/')">← 返回城市列表</el-button>
      <span class="city-title">{{ cityName }}</span>
    </div>

    <el-card shadow="never" class="page-card">
      <div class="toolbar">
        <span class="toolbar-label">日期文件夹（{{ days.length }}）</span>
        <el-button type="primary" @click="openAdd">+ 添加日期</el-button>
      </div>
    </el-card>

    <el-empty v-if="!loading && days.length === 0" description="还没有日期文件夹，点击右上角「添加日期」创建" />
    <el-row v-else :gutter="16">
      <el-col v-for="d in days" :key="d.id" :xs="24" :sm="12" :md="8" :lg="6">
        <el-card shadow="hover" class="day-card">
          <div class="day-date" @click="router.push(`/day/${d.id}`)">{{ d.day_date }}</div>
          <div class="day-week">{{ fmtWeek(d.day_date) }}</div>
          <div class="day-meta">
            <template v-if="d.record_count > 0">
              <div>{{ d.record_count }} 条 · {{ d.category_count || 0 }} 类</div>
              <span class="scan-rate">读码率 <em>{{ scanRateOf(d) }}</em></span>
            </template>
            <div v-else class="muted">验收数据未导入</div>
            <el-tag v-if="d.excel_count > 0" type="success" size="small">Excel {{ d.excel_count }} 个</el-tag>
          </div>
          <div class="day-actions">
            <el-button size="small" @click="router.push(`/day/${d.id}`)">验收明细</el-button>
            <el-upload
              :show-file-list="false"
              accept=".xls,.xlsx"
              :disabled="importingDayId === d.id"
              :http-request="(opt) => onImportExcel(opt, d)"
            >
              <el-button size="small" type="primary" :loading="importingDayId === d.id">
                导入Excel
              </el-button>
            </el-upload>
            <el-button v-if="d.excel_count > 0" size="small" @click="openExcelPanel(d)">打开Excel</el-button>
            <el-button size="small" type="danger" plain @click="removeDay(d)">删除</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="showAdd" title="添加日期文件夹" width="400px">
      <el-date-picker v-model="newDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="confirmAdd">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showExcelPanel" :title="`${excelDay?.day_date || ''} · Excel 文件`" width="520px">
      <div v-loading="loadingExcels">
        <el-empty v-if="!loadingExcels && !excelFiles.length" description="暂无 Excel 文件" />
        <el-table v-else :data="excelFiles" size="small">
          <el-table-column prop="file_name" label="文件名" min-width="180" show-overflow-tooltip />
          <el-table-column label="大小" width="90">
            <template #default="{ row }">{{ fmtSize(row.file_size) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openExcel(row)">打开</el-button>
              <el-button link type="danger" @click="removeExcelFile(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
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
}
.toolbar-label {
  font-size: 15px;
  font-weight: 600;
}
.day-card {
  margin-bottom: 16px;
  text-align: center;
}
.day-date {
  font-size: 20px;
  font-weight: 700;
  color: #1f3a5f;
  cursor: pointer;
}
.day-week {
  font-size: 13px;
  color: #909399;
  margin-top: 2px;
}
.day-meta {
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-color-primary);
}
.day-meta .scan-rate {
  margin-left: 0;
}
.muted {
  color: #c0c4cc;
}
.day-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
</style>
