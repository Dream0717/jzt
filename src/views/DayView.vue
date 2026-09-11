<script setup>
import { ref, onMounted, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getDay,
  importXls,
  getStats,
  listRecords,
  getReasonOptions,
  updateRecordReason,
  updateProblemOwner,
  uploadRemarkImage,
  deleteRemarkImage,
  remarkImageUrl,
  matchDingSaoLog,
} from '../api.js'
import { isAuthCancelled } from '../auth.js'
import { isDingSaoRateEnabled, setDingSaoRateEnabled, calcScanRatePercent } from '../scanRateMode.js'

const props = defineProps({ dayId: String })
const router = useRouter()

const day = ref(null)
const scanRate = ref({
  total: 0,
  our_miss_count: 0,
  ding_sao_found_count: 0,
  percent: 0,
  percent_with_ding_sao: 0,
})
const stats = ref([])
const activeCategory = ref('')
const keyword = ref('')
let searchTimer = null
const records = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const pageSizeOptions = [20, 50, 100, 200]
const jumpPage = ref(1)
const importing = ref(false)
const loadingRecords = ref(false)
const importInputRef = ref(null)
const dingSaoInputRef = ref(null)
const matchingDingSao = ref(false)

const previewImage = ref('')
const previewVisible = ref(false)
const previewScale = ref(1)
const previewX = ref(0)
const previewY = ref(0)
const previewDragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragOriginX = 0
let dragOriginY = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const includeDingSaoInRate = computed({
  get: () => isDingSaoRateEnabled(props.dayId),
  set: (on) => setDingSaoRateEnabled(props.dayId, on),
})

const scanRateText = computed(() => {
  if (!(scanRate.value.total > 0)) return ''
  const pct = calcScanRatePercent(
    scanRate.value.total,
    scanRate.value.our_miss_count,
    scanRate.value.ding_sao_found_count,
    includeDingSaoInRate.value
  )
  return pct == null ? '' : `${pct.toFixed(2)}%`
})

const scanRateTitle = computed(() => {
  if (includeDingSaoInRate.value) {
    return '读码率 = (全部 − 未提取到监管码·我方 − 海康无记录·顶扫有记录) ÷ 全部 × 100%'
  }
  return '读码率 = (全部 − 未提取到监管码·我方) ÷ 全部 × 100%'
})

async function refreshBase() {
  try {
    const [d, s] = await Promise.all([getDay(props.dayId), getStats(props.dayId)])
    day.value = d.day
    if (d.day?.source_type === 'excel') {
      ElMessage.info('该日期为 Excel 模式')
      router.replace(`/city/${d.day.city_id}`)
      return
    }
    scanRate.value = d.scan_rate || { total: 0, our_miss_count: 0, percent: 0 }
    stats.value = s.stats
    await loadReasonOptions()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function refreshRecords({ scrollTop = false } = {}) {
  loadingRecords.value = true
  try {
    const data = await listRecords(
      props.dayId,
      activeCategory.value,
      keyword.value,
      page.value,
      pageSize.value
    )
    records.value = data.records.map((r) => ({
      ...r,
      reason_note: r.reason_note || '',
      problem_owner: r.problem_owner || (r.category === '未提取到监管码' ? '我方' : ''),
      has_remark_image: !!r.has_remark_image,
    }))
    total.value = data.total
    jumpPage.value = page.value
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingRecords.value = false
    if (scrollTop) {
      await nextTick()
      scrollListToTop()
    }
  }
}

function scrollListToTop() {
  if (tableWrap.value) {
    tableWrap.value.scrollTop = 0
    // 横向位置保持不变，仅纵向回顶
  }
}

function switchCategory(cat) {
  activeCategory.value = cat
  page.value = 1
  refreshRecords({ scrollTop: true })
}

function doSearch() {
  page.value = 1
  refreshRecords({ scrollTop: true })
}

function scheduleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    doSearch()
  }, 280)
}

watch(keyword, () => {
  scheduleSearch()
})

function changePageSize() {
  page.value = 1
  refreshRecords({ scrollTop: true })
}

function goJumpPage() {
  let p = Number(jumpPage.value)
  if (!Number.isFinite(p)) p = 1
  p = Math.min(Math.max(1, Math.floor(p)), totalPages.value)
  jumpPage.value = p
  if (p === page.value) return
  page.value = p
  refreshRecords({ scrollTop: true })
}

function onPageChange(p) {
  page.value = p
  refreshRecords({ scrollTop: true })
}

async function startImport() {
  if (importing.value) return
  if (stats.value.length || (scanRate.value.total || 0) > 0) {
    try {
      await ElMessageBox.confirm(
        '该日期已有数据，继续导入将覆盖原有全部记录及已填写的原因/备注/问题归属，是否继续？',
        '覆盖确认',
        { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }
  importInputRef.value?.click()
}

async function onImportFileChange(ev) {
  const file = ev.target?.files?.[0]
  ev.target.value = ''
  if (!file) return
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('请选择 .xls 或 .xlsx 文件')
    return
  }
  importing.value = true
  try {
    const r = await importXls(props.dayId, file)
    ElMessage.success(`导入成功：共 ${r.total} 条，有效 ${r.imported} 条`)
    await refreshBase()
    page.value = 1
    activeCategory.value = ''
    await refreshRecords()
  } catch (err) {
    if (isAuthCancelled(err)) return
    ElMessage.error('导入失败：' + err.message)
  } finally {
    importing.value = false
  }
}

function fmtTime(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 19)
}

const copiedId = ref(null)
async function copySerial(r) {
  const text = r.serial_no == null ? '' : String(r.serial_no)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copiedId.value = r.id
  ElMessage.success({ message: '已复制条码流水号', duration: 1000 })
}

const reasonOptions = ref([])
async function loadReasonOptions() {
  try {
    const data = await getReasonOptions(props.dayId)
    reasonOptions.value = data.options || []
  } catch {
    reasonOptions.value = []
  }
}

function queryReasonSuggestions(queryString, cb) {
  const q = String(queryString || '').trim()
  const list = (reasonOptions.value || [])
    .filter((o) => !q || String(o.value || '').includes(q))
    .map((o) => ({ value: o.value, problem_owner: o.problem_owner }))
  cb(list)
}

function applyOwnerForReason(r, reason, owner) {
  if (r.category !== '未提取到监管码') return
  if (!owner || (owner !== '客户' && owner !== '我方')) return
  const note = String(reason || '').trim()
  r.problem_owner = owner
  if (!note) return
  for (const row of records.value) {
    if (
      row.category === '未提取到监管码' &&
      String(row.reason_note || '').trim() === note
    ) {
      row.problem_owner = owner
    }
  }
}

const totalCount = computed(() => stats.value.reduce((a, s) => a + s.count, 0))

const showIssueColumns = computed(() => {
  if (activeCategory.value === '空') return false
  if (activeCategory.value && activeCategory.value !== '空') return true
  return records.value.some((r) => r.category !== '空')
})

const showOwnerColumn = computed(() => activeCategory.value === '未提取到监管码')
const showDingSaoLogBtn = computed(() => activeCategory.value === '海康无记录')

function isIssueRecord(r) {
  return r.category !== '空'
}

function startDingSaoLog() {
  dingSaoInputRef.value?.click()
}

async function onDingSaoLogChange(ev) {
  const file = ev.target?.files?.[0]
  ev.target.value = ''
  if (!file) return
  matchingDingSao.value = true
  try {
    const r = await matchDingSaoLog(props.dayId, file)
    ElMessage.success(
      r.message ||
        `顶扫有记录 ${r.found || 0}，顶扫无记录 ${r.missing || 0}`
    )
    if (r.scan_rate) scanRate.value = r.scan_rate
    await loadReasonOptions()
    await refreshRecords()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  } finally {
    matchingDingSao.value = false
  }
}

const savingReasonId = ref(null)
async function saveReason(r) {
  if (!isIssueRecord(r)) return
  savingReasonId.value = r.id
  try {
    const data = await updateRecordReason(r.id, r.reason_note || '')
    r.reason_note = data.reason_note || ''
    if (data.problem_owner) {
      applyOwnerForReason(r, r.reason_note, data.problem_owner)
      // 同步读码率：归属可能已变
      const dayData = await getDay(props.dayId)
      if (dayData.scan_rate) scanRate.value = dayData.scan_rate
    }
    await loadReasonOptions()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  } finally {
    savingReasonId.value = null
  }
}

async function onReasonSelect(r, item) {
  r.reason_note = item.value
  if (item.problem_owner) {
    applyOwnerForReason(r, item.value, item.problem_owner)
  }
  await saveReason(r)
}

const savingOwnerId = ref(null)
async function saveOwner(r) {
  if (r.category !== '未提取到监管码') return
  savingOwnerId.value = r.id
  try {
    const data = await updateProblemOwner(r.id, r.problem_owner || '我方')
    r.problem_owner = data.problem_owner
    if (data.scan_rate) scanRate.value = data.scan_rate
    const note = String(data.reason_note || r.reason_note || '').trim()
    if (note) {
      applyOwnerForReason(r, note, data.problem_owner)
      if ((data.affected || 0) > 1) {
        ElMessage.success(`已同步 ${data.affected} 条相同原因的问题归属`)
      }
    }
    await loadReasonOptions()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
    await refreshRecords()
  } finally {
    savingOwnerId.value = null
  }
}

const uploadingRemarkId = ref(null)
const pasteFocusId = ref(null)

async function uploadRemarkFile(r, file) {
  if (!file || !isIssueRecord(r)) return
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请粘贴或选择图片文件')
    return
  }
  uploadingRemarkId.value = r.id
  try {
    await uploadRemarkImage(r.id, file)
    r.has_remark_image = true
    r._remarkVersion = Date.now()
    ElMessage.success('备注图片已上传')
  } catch (err) {
    if (isAuthCancelled(err)) return
    ElMessage.error(err.message)
  } finally {
    uploadingRemarkId.value = null
  }
}

async function onRemarkPaste(e, r) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) await uploadRemarkFile(r, file)
      return
    }
  }
}

async function removeRemark(r) {
  try {
    await ElMessageBox.confirm('确定删除该备注图片吗？', '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteRemarkImage(r.id)
    r.has_remark_image = false
    r._remarkVersion = Date.now()
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  }
}

function openPreview(r) {
  previewImage.value = remarkImageUrl(r.id, r._remarkVersion || r.id)
  previewScale.value = 1
  previewX.value = 0
  previewY.value = 0
  previewVisible.value = true
}

function onPreviewWheel(e) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.12 : 0.12
  const next = Math.min(5, Math.max(0.3, previewScale.value + delta))
  previewScale.value = Number(next.toFixed(2))
}

function onPreviewMouseDown(e) {
  if (e.button !== 0) return
  previewDragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOriginX = previewX.value
  dragOriginY = previewY.value
}

function onPreviewMouseMove(e) {
  if (!previewDragging.value) return
  previewX.value = dragOriginX + (e.clientX - dragStartX)
  previewY.value = dragOriginY + (e.clientY - dragStartY)
}

function onPreviewMouseUp() {
  previewDragging.value = false
}

function resetPreviewTransform() {
  previewScale.value = 1
  previewX.value = 0
  previewY.value = 0
}

watch(page, (p) => {
  jumpPage.value = p
})

const tableWrap = ref(null)

onMounted(async () => {
  await refreshBase()
  await refreshRecords()
})

onBeforeUnmount(() => {
  clearTimeout(searchTimer)
})
</script>

<template>
  <div class="page" v-if="day">
    <div class="nav-back">
      <el-button @click="router.push(`/city/${day.city_id}`)">← 返回日期列表</el-button>
      <span class="day-title">
        {{ day.city_name }} · {{ day.day_date }}
        <span v-if="scanRate.total" class="scan-rate" :title="scanRateTitle">
          读码率 <em>{{ scanRateText }}</em>
        </span>
      </span>
      <label v-if="scanRate.total" class="rate-mode-switch" :title="scanRateTitle">
        <el-switch v-model="includeDingSaoInRate" />
        <span>算上海康无记录的读码率</span>
      </label>
    </div>

    <el-card shadow="never" class="page-card import-card">
      <div class="import-bar">
        <input
          ref="importInputRef"
          type="file"
          accept=".xls,.xlsx"
          class="hidden-file"
          @change="onImportFileChange"
        />
        <el-button type="primary" :loading="importing" @click="startImport">
          导入统计明细 (xls/xlsx)
        </el-button>
      </div>
    </el-card>

    <el-card
      v-if="stats.length"
      shadow="never"
      class="page-card records-card"
      v-loading="loadingRecords"
    >
      <div class="records-toolbar">
      <div class="cat-tabs">
        <el-check-tag :checked="activeCategory === ''" @click="switchCategory('')">
          全部 {{ totalCount }}
        </el-check-tag>
        <el-check-tag
          v-for="s in stats"
          :key="s.category"
          :checked="activeCategory === s.category"
          @click="switchCategory(s.category)"
        >
          {{ s.category }} {{ s.count }}
        </el-check-tag>
      </div>

      <div class="search-bar">
        <el-input
          v-model="keyword"
          clearable
          placeholder="实时搜索：流水号 / 监管码 / 商品 / 原因 / 操作员 / 归属…（全部列）"
        />
        <template v-if="showDingSaoLogBtn">
          <input
            ref="dingSaoInputRef"
            type="file"
            accept=".log,.txt,.csv,.json,text/plain,*"
            class="hidden-file"
            @change="onDingSaoLogChange"
          />
          <el-button type="warning" :loading="matchingDingSao" @click="startDingSaoLog">
            导入顶扫log
          </el-button>
        </template>
      </div>
      </div>

      <div ref="tableWrap" class="table-wrap">
        <table class="rec-table">
          <thead>
            <tr>
              <th>业务单据编号</th>
              <th>条码流水号</th>
              <th>商品名称</th>
              <th>药品规格</th>
              <th>生产厂家</th>
              <th>监管码</th>
              <th>操作员</th>
              <th>操作时间</th>
              <th>补扫原因</th>
              <th v-if="showOwnerColumn">问题归属</th>
              <th v-if="showIssueColumns">原因</th>
              <th v-if="showIssueColumns">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!loadingRecords && records.length === 0">
              <td :colspan="9 + (showOwnerColumn ? 1 : 0) + (showIssueColumns ? 2 : 0)" class="td-center">
                无匹配记录
              </td>
            </tr>
            <tr
              v-for="r in records"
              :key="r.id"
              :class="{
                'row-copied': copiedId === r.id,
                'row-our-problem': r.problem_owner === '我方',
                'row-ding-sao-found': String(r.reason_note || '').trim() === '顶扫有记录',
              }"
            >
              <td>{{ r.doc_no }}</td>
              <td>
                <el-button
                  v-if="r.serial_no"
                  class="serial-copy"
                  size="small"
                  :type="copiedId === r.id ? 'success' : 'default'"
                  @click="copySerial(r)"
                >
                  <span class="mono">{{ r.serial_no }}</span>
                  <el-icon class="copy-icon"><DocumentCopy /></el-icon>
                </el-button>
                <span v-else class="muted">—</span>
              </td>
              <td>{{ r.goods_name }}</td>
              <td>{{ r.spec }}</td>
              <td class="td-ellipsis" :title="r.manufacturer">{{ r.manufacturer }}</td>
              <td class="mono">{{ r.drug_code }}</td>
              <td>{{ r.operator }}</td>
              <td class="mono">{{ fmtTime(r.op_time) }}</td>
              <td>
                <el-tag :type="r.category === '空' ? 'success' : 'warning'" size="small">
                  {{ r.category }}
                </el-tag>
              </td>
              <td v-if="showOwnerColumn">
                <el-select
                  v-model="r.problem_owner"
                  size="small"
                  style="width: 90px"
                  :disabled="savingOwnerId === r.id"
                  @change="saveOwner(r)"
                >
                  <el-option label="我方" value="我方" />
                  <el-option label="客户" value="客户" />
                </el-select>
              </td>
              <td v-if="showIssueColumns" class="td-reason">
                <el-autocomplete
                  v-if="isIssueRecord(r)"
                  v-model="r.reason_note"
                  size="small"
                  placeholder="填写原因说明"
                  maxlength="512"
                  :fetch-suggestions="queryReasonSuggestions"
                  :disabled="savingReasonId === r.id"
                  style="width: 100%"
                  value-key="value"
                  @select="(item) => onReasonSelect(r, item)"
                  @blur="saveReason(r)"
                />
                <span v-else class="muted">—</span>
              </td>
              <td v-if="showIssueColumns" class="td-remark">
                <div
                  v-if="isIssueRecord(r)"
                  class="remark-paste"
                  :class="{ focused: pasteFocusId === r.id }"
                  tabindex="0"
                  title="点击后 Ctrl+V 粘贴图片"
                  @click="pasteFocusId = r.id"
                  @focus="pasteFocusId = r.id"
                  @blur="pasteFocusId = null"
                  @paste="onRemarkPaste($event, r)"
                >
                  <el-image
                    v-if="r.has_remark_image"
                    class="remark-thumb"
                    :src="remarkImageUrl(r.id, r._remarkVersion || r.id)"
                    fit="cover"
                    @click.stop="openPreview(r)"
                  />
                  <span v-else class="muted">{{ uploadingRemarkId === r.id ? '上传中…' : '点击后粘贴图片' }}</span>
                  <el-upload
                    :show-file-list="false"
                    accept="image/*"
                    :disabled="uploadingRemarkId === r.id"
                    :before-upload="(file) => { uploadRemarkFile(r, file); return false }"
                  >
                    <el-button size="small" link type="primary" @click.stop>
                      {{ r.has_remark_image ? '更换' : '选择' }}
                    </el-button>
                  </el-upload>
                  <el-button
                    v-if="r.has_remark_image"
                    size="small"
                    link
                    type="danger"
                    @click.stop="removeRemark(r)"
                  >
                    删除
                  </el-button>
                </div>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager">
        <span>
          每页
          <el-select v-model="pageSize" size="small" style="width: 90px" @change="changePageSize">
            <el-option v-for="n in pageSizeOptions" :key="n" :label="`${n}`" :value="n" />
          </el-select>
          条
        </span>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          background
          @current-change="onPageChange"
        />
        <span class="pager-jump">
          跳至
          <el-input-number v-model="jumpPage" :min="1" :max="totalPages" size="small" controls-position="right" />
          <el-button size="small" @click="goJumpPage">Go</el-button>
        </span>
      </div>
    </el-card>

    <el-empty v-else class="page-empty" description="该日期还没有数据，点击上方导入统计明细" />

    <el-dialog
      v-model="previewVisible"
      title="备注图片"
      width="90%"
      top="4vh"
      class="remark-preview-dialog"
      destroy-on-close
      @closed="resetPreviewTransform"
    >
      <div
        class="preview-viewport"
        :class="{ 'is-dragging': previewDragging }"
        @wheel.prevent="onPreviewWheel"
        @mousedown="onPreviewMouseDown"
        @mousemove="onPreviewMouseMove"
        @mouseup="onPreviewMouseUp"
        @mouseleave="onPreviewMouseUp"
        @dblclick="resetPreviewTransform"
      >
        <img
          v-if="previewImage"
          :src="previewImage"
          alt="备注大图"
          class="preview-img"
          :style="{
            transform: `translate(${previewX}px, ${previewY}px) scale(${previewScale})`,
          }"
          draggable="false"
          @dragstart.prevent
        />
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  max-height: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 10px;
}
.nav-back {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.day-title {
  font-size: 16px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.rate-mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  cursor: pointer;
  user-select: none;
}
.import-card {
  flex-shrink: 0;
  margin-bottom: 0 !important;
}
.import-card :deep(.el-card__body) {
  padding: 12px 16px;
}
.import-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.hidden-file {
  display: none;
}
.records-card {
  flex: 1;
  min-height: 0;
  margin-bottom: 0 !important;
  display: flex;
  flex-direction: column;
}
.records-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 16px;
}
.records-toolbar {
  flex-shrink: 0;
}
.cat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}
.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
}
.rec-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.rec-table th,
.rec-table td {
  border-bottom: 1px solid var(--el-border-color-extra-light);
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
}
.rec-table th {
  background: #f5f7fa;
  color: #606266;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 2;
}
.page-empty {
  flex: 1;
}
.td-center {
  text-align: center;
  color: #909399;
  padding: 24px !important;
}
.mono {
  font-family: Consolas, monospace;
}
.muted {
  color: #c0c4cc;
}
.td-ellipsis {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.serial-copy .copy-icon {
  margin-left: 4px;
}
.rec-table tbody tr.row-our-problem td {
  background: #fef0f0;
  color: #c45656;
}
.rec-table tbody tr.row-ding-sao-found td {
  background: #fff3bf;
  color: #92400e;
  box-shadow: inset 4px 0 0 #f59e0b;
}
.rec-table tbody tr.row-copied td {
  background: #ecf5ff;
  box-shadow: inset 0 0 0 2px var(--el-color-primary);
}
.rec-table tbody tr.row-our-problem.row-copied td {
  background: #fde2e2;
  box-shadow: inset 0 0 0 2px #f56c6c;
}
.rec-table tbody tr.row-ding-sao-found.row-copied td {
  background: #fde68a;
  box-shadow: inset 4px 0 0 #f59e0b, inset 0 0 0 2px #d97706;
}
.rec-table tbody tr.row-ding-sao-found.row-our-problem td {
  background: #fde68a;
  color: #92400e;
  box-shadow: inset 4px 0 0 #f59e0b;
}
.td-reason {
  min-width: 160px;
  white-space: normal;
}
.td-remark {
  min-width: 180px;
  white-space: normal;
}
.remark-paste {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 44px;
  padding: 6px 8px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  background: #fafafa;
  outline: none;
  cursor: pointer;
}
.remark-paste.focused {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.remark-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  cursor: zoom-in;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  flex-shrink: 0;
}
.pager-jump {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.preview-viewport {
  height: min(78vh, 820px);
  overflow: hidden;
  background: #1a1a1a;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  touch-action: none;
  cursor: grab;
}
.preview-viewport.is-dragging {
  cursor: grabbing;
}
.preview-img {
  max-width: min(96%, 1400px);
  max-height: 92%;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.05s linear;
  pointer-events: none;
}
</style>
