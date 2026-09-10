<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listDays,
  createDay,
  updateDay,
  deleteDay,
  listDayExcels,
  uploadDayExcel,
  deleteExcel,
  importXls,
  importSplitXls,
} from '../api.js'
import { isAuthCancelled } from '../auth.js'

const props = defineProps({ cityId: String })
const router = useRouter()
const cityName = ref('')
const days = ref([])
const loading = ref(false)
const showAdd = ref(false)
const newDate = ref('')
const newSourceType = ref('detail')
const creating = ref(false)
const importingDayId = ref(null)

const showExcelPanel = ref(false)
const excelDay = ref(null)
const excelFiles = ref([])
const loadingExcels = ref(false)

const pendingImportDay = ref(null)
const detailInputRef = ref(null)
const excelInputRef = ref(null)
const splitInputRef = ref(null)
const splitting = ref(false)
const rateDrafts = ref({})

function todayStr() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function dayMode(d) {
  if (d.source_type === 'detail' || d.source_type === 'excel') return d.source_type
  if ((d.record_count || 0) > 0) return 'detail'
  if ((d.excel_count || 0) > 0) return 'excel'
  return null
}

async function refresh() {
  loading.value = true
  try {
    const data = await listDays(props.cityId)
    cityName.value = data.city?.name || ''
    days.value = data.days
    const drafts = { ...rateDrafts.value }
    for (const d of data.days) {
      if (drafts[d.id] === undefined) drafts[d.id] = d.manual_scan_rate || ''
    }
    rateDrafts.value = drafts
    document.title = `${cityName.value} - 日期文件夹`
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function openAdd() {
  newDate.value = todayStr()
  newSourceType.value = 'detail'
  showAdd.value = true
}

async function confirmAdd() {
  if (!newDate.value) {
    ElMessage.warning('请选择日期')
    return
  }
  if (newSourceType.value !== 'detail' && newSourceType.value !== 'excel') {
    ElMessage.warning('请选择导入类型')
    return
  }
  creating.value = true
  try {
    const created = await createDay(props.cityId, newDate.value, newSourceType.value)
    showAdd.value = false
    ElMessage.success('已创建日期文件夹，请选择要导入的文件')
    await refresh()
    pendingImportDay.value = {
      id: created.id,
      day_date: created.day_date,
      source_type: created.source_type,
      excel_count: 0,
      record_count: 0,
    }
    if (created.source_type === 'detail') {
      detailInputRef.value?.click()
    } else {
      excelInputRef.value?.click()
    }
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  } finally {
    creating.value = false
  }
}

async function removeDay(day) {
  const tipParts = []
  if ((day.record_count || 0) > 0) tipParts.push(`${day.record_count} 条验收数据`)
  if ((day.excel_count || 0) > 0) tipParts.push(`${day.excel_count} 个 Excel 文件`)
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

async function saveManualRate(day) {
  const value = String(rateDrafts.value[day.id] ?? '').trim()
  try {
    await updateDay(day.id, { manual_scan_rate: value })
    day.manual_scan_rate = value || null
    ElMessage.success('读码率已保存')
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  }
}

async function startImportDetail(day) {
  if ((day.record_count || 0) > 0) {
    try {
      await ElMessageBox.confirm(
        '该日期已有验收数据，继续导入将覆盖原有全部记录及已填写内容，是否继续？',
        '覆盖确认',
        { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  pendingImportDay.value = day
  detailInputRef.value?.click()
}

async function startImportExcel(day) {
  if ((day.excel_count || 0) > 0) {
    try {
      await ElMessageBox.confirm(
        `该日期已有 Excel 文件，继续导入将覆盖旧文件，是否继续？`,
        '覆盖确认',
        { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  pendingImportDay.value = day
  excelInputRef.value?.click()
}

async function onDetailFileChange(ev) {
  const file = ev.target?.files?.[0]
  ev.target.value = ''
  const day = pendingImportDay.value
  pendingImportDay.value = null
  if (!file || !day) return
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('请选择 .xls 或 .xlsx 文件')
    return
  }
  importingDayId.value = day.id
  try {
    const r = await importXls(day.id, file)
    ElMessage.success(`导入成功：共 ${r.total} 条，有效 ${r.imported} 条`)
    await refresh()
    router.push(`/day/${day.id}`)
  } catch (err) {
    if (isAuthCancelled(err)) return
    ElMessage.error(err.message)
  } finally {
    importingDayId.value = null
  }
}

async function onExcelFileChange(ev) {
  const file = ev.target?.files?.[0]
  ev.target.value = ''
  const day = pendingImportDay.value
  pendingImportDay.value = null
  if (!file || !day) return
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('请选择 .xls 或 .xlsx 文件')
    return
  }
  importingDayId.value = day.id
  try {
    const r = await uploadDayExcel(day.id, file, { overwrite: true })
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

function startSplitImport() {
  splitInputRef.value?.click()
}

async function runSplitImport(file, overwrite) {
  const r = await importSplitXls(props.cityId, file, { overwrite })
  const lines = (r.days || [])
    .map((d) => `${d.date}：${d.imported} 条${d.created ? '（新建）' : '（覆盖）'}`)
    .join('\n')
  ElMessage.success(`已按日期拆分导入 ${r.days?.length || 0} 天，共 ${r.imported} 条`)
  if (lines) {
    try {
      await ElMessageBox.alert(lines, '拆分导入结果', { confirmButtonText: '知道了' })
    } catch {
      // ignore
    }
  }
  await refresh()
}

async function onSplitFileChange(ev) {
  const file = ev.target?.files?.[0]
  ev.target.value = ''
  if (!file) return
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('请选择 .xls 或 .xlsx 文件')
    return
  }
  splitting.value = true
  try {
    try {
      await runSplitImport(file, false)
    } catch (err) {
      if (isAuthCancelled(err)) return
      if (err.code === 'NEED_CONFIRM' && err.preview) {
        const preview = err.preview
        const lines = (preview.dates || [])
          .map(
            (d) =>
              `${d.date}：${d.count} 条${d.will_overwrite ? '（将覆盖已有）' : '（新建）'}`
          )
          .join('\n')
        try {
          await ElMessageBox.confirm(
            `${preview.error || '部分日期已存在'}\n\n${lines}\n\n是否继续并覆盖已有验收明细？`,
            '确认拆分导入',
            { type: 'warning', confirmButtonText: '覆盖并导入', cancelButtonText: '取消' }
          )
        } catch {
          return
        }
        await runSplitImport(file, true)
        return
      }
      throw err
    }
  } catch (err) {
    if (isAuthCancelled(err)) return
    ElMessage.error(err.message)
  } finally {
    splitting.value = false
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

function openDay(d) {
  if (dayMode(d) === 'excel') {
    if ((d.excel_count || 0) > 0) openExcelPanel(d)
    else startImportExcel(d)
    return
  }
  router.push(`/day/${d.id}`)
}

onMounted(refresh)
</script>

<template>
  <div class="page" v-loading="loading">
    <input
      ref="detailInputRef"
      type="file"
      accept=".xls,.xlsx"
      class="hidden-file"
      @change="onDetailFileChange"
    />
    <input
      ref="excelInputRef"
      type="file"
      accept=".xls,.xlsx"
      class="hidden-file"
      @change="onExcelFileChange"
    />
    <input
      ref="splitInputRef"
      type="file"
      accept=".xls,.xlsx"
      class="hidden-file"
      @change="onSplitFileChange"
    />

    <div class="nav-back">
      <el-button @click="router.push('/')">← 返回城市列表</el-button>
      <span class="city-title">{{ cityName }}</span>
    </div>

    <el-card shadow="never" class="page-card">
      <div class="toolbar">
        <span class="toolbar-label">日期文件夹（{{ days.length }}）</span>
        <div class="toolbar-actions">
          <el-button type="success" :loading="splitting" @click="startSplitImport">
            按日期拆分导入明细
          </el-button>
          <el-button type="primary" @click="openAdd">+ 添加日期</el-button>
        </div>
      </div>
    </el-card>

    <el-empty v-if="!loading && days.length === 0" description="还没有日期文件夹，点击右上角「添加日期」创建" />
    <el-row v-else :gutter="16" class="day-grid">
      <el-col v-for="d in days" :key="d.id" :xs="24" :sm="12" :md="8" :lg="6" class="day-col">
        <el-card shadow="hover" class="day-card">
          <div class="day-date" @click="openDay(d)">{{ d.day_date }}</div>
          <div class="day-week">{{ fmtWeek(d.day_date) }}</div>

          <div class="day-meta">
            <div class="meta-tag">
              <el-tag v-if="dayMode(d) === 'detail'" size="small" type="primary">验收明细</el-tag>
              <el-tag v-else-if="dayMode(d) === 'excel'" size="small" type="success">Excel</el-tag>
              <el-tag v-else size="small" type="info">未指定</el-tag>
            </div>

            <div class="meta-status">
              <template v-if="dayMode(d) === 'detail'">
                <template v-if="d.record_count > 0">{{ d.record_count }} 条 · {{ d.category_count || 0 }} 类</template>
                <span v-else class="muted">尚未导入验收明细</span>
              </template>
              <template v-else-if="dayMode(d) === 'excel'">
                <template v-if="d.excel_count > 0">已导入 Excel</template>
                <span v-else class="muted">尚未导入 Excel</span>
              </template>
              <span v-else class="muted">—</span>
            </div>

            <div class="meta-rate">
              <template v-if="dayMode(d) === 'detail'">
                <span class="scan-rate">读码率 <em>{{ d.record_count > 0 ? scanRateOf(d) : '—' }}</em></span>
              </template>
              <template v-else-if="dayMode(d) === 'excel'">
                <div class="manual-rate">
                  <span>读码率</span>
                  <el-input
                    v-model="rateDrafts[d.id]"
                    size="small"
                    placeholder="如 98.50%"
                    @change="saveManualRate(d)"
                  />
                </div>
              </template>
              <span v-else class="muted">读码率 —</span>
            </div>
          </div>

          <div class="day-actions">
            <template v-if="dayMode(d) === 'detail'">
              <el-button size="small" type="primary" @click="router.push(`/day/${d.id}`)">
                验收明细
              </el-button>
            </template>
            <template v-else-if="dayMode(d) === 'excel'">
              <el-button
                size="small"
                type="primary"
                :loading="importingDayId === d.id"
                @click="startImportExcel(d)"
              >
                导入Excel
              </el-button>
              <el-button v-if="d.excel_count > 0" size="small" @click="openExcelPanel(d)">
                打开Excel
              </el-button>
            </template>
            <el-button size="small" type="danger" plain @click="removeDay(d)">删除</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="showAdd" title="添加日期文件夹" width="440px">
      <div class="add-form">
        <div class="add-label">日期</div>
        <el-date-picker v-model="newDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        <div class="add-label">导入类型（二选一）</div>
        <el-radio-group v-model="newSourceType" class="source-radios">
          <el-radio value="detail" border>导入验收明细</el-radio>
          <el-radio value="excel" border>导入 Excel</el-radio>
        </el-radio-group>
        <p class="add-tip">创建后将立即选择文件导入；同一日期仅保留一种类型。</p>
      </div>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="confirmAdd">创建并导入</el-button>
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
.hidden-file {
  display: none;
}
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
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.toolbar-label {
  font-size: 15px;
  font-weight: 600;
}
.day-col {
  display: flex;
  margin-bottom: 16px;
}
.day-card {
  width: 100%;
  height: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
}
.day-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 260px;
}
.day-date {
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  color: var(--el-color-primary);
  line-height: 1.3;
}
.day-week {
  color: #909399;
  font-size: 13px;
  margin: 4px 0 10px;
  line-height: 1.2;
}
.day-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #606266;
  margin-bottom: 12px;
  min-height: 96px;
}
.meta-tag,
.meta-status,
.meta-rate {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.scan-rate em {
  font-style: normal;
  color: var(--el-color-success);
  font-weight: 700;
}
.manual-rate {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 220px;
}
.muted {
  color: #c0c4cc;
}
.day-actions {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: flex-start;
  gap: 8px;
  min-height: 68px;
}
.add-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.add-label {
  font-size: 13px;
  color: #606266;
  font-weight: 600;
}
.source-radios {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.add-tip {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
