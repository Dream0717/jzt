<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  getDay,
  importXls,
  getStats,
  listRecords,
  updateRecordReason,
  updateProblemOwner,
  uploadRemarkImage,
  deleteRemarkImage,
  remarkImageUrl,
} from '../api.js'
import { isAuthCancelled } from '../auth.js'

const props = defineProps({ dayId: String })
const router = useRouter()

const day = ref(null)
const scanRate = ref({ total: 0, our_miss_count: 0, percent: 0 })
const stats = ref([])
const activeCategory = ref('') // '' = 全部
const keyword = ref('')
const records = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const pageSizeOptions = [20, 50, 100, 200]
const jumpPage = ref(1)
const importing = ref(false)
const loadingRecords = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const scanRateText = computed(() => {
  if (!(scanRate.value.total > 0)) return ''
  return `${Number(scanRate.value.percent).toFixed(2)}%`
})

async function refreshBase() {
  try {
    const [d, s] = await Promise.all([getDay(props.dayId), getStats(props.dayId)])
    day.value = d.day
    scanRate.value = d.scan_rate || { total: 0, our_miss_count: 0, percent: 0 }
    stats.value = s.stats
  } catch (e) {
    alert(e.message)
  }
}

async function refreshRecords() {
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
    alert(e.message)
  } finally {
    loadingRecords.value = false
  }
}

function switchCategory(cat) {
  activeCategory.value = cat
  page.value = 1
  refreshRecords()
}

function doSearch() {
  page.value = 1
  refreshRecords()
}

function flipPage(delta) {
  const next = page.value + delta
  if (next < 1 || next > totalPages.value) return
  page.value = next
  refreshRecords()
}

function changePageSize() {
  page.value = 1
  refreshRecords()
}

function goJumpPage() {
  let p = Number(jumpPage.value)
  if (!Number.isFinite(p)) p = 1
  p = Math.min(Math.max(1, Math.floor(p)), totalPages.value)
  jumpPage.value = p
  if (p === page.value) return
  page.value = p
  refreshRecords()
}

async function onImport(e) {
  const file = e.target.files?.[0]
  if (!file) return
  if (!/\.(xls|xlsx)$/i.test(file.name)) {
    alert('请选择 .xls 或 .xlsx 文件')
    e.target.value = ''
    return
  }
  if (stats.value.length || (scanRate.value.total || 0) > 0) {
    if (
      !confirm(
        '该日期已有数据。重新导入将覆盖（清空）原有全部记录及已填写的原因/备注/问题归属，是否继续？'
      )
    ) {
      e.target.value = ''
      return
    }
  }
  importing.value = true
  try {
    const r = await importXls(props.dayId, file)
    alert(`导入成功：共 ${r.total} 条，有效 ${r.imported} 条（已写入数据库）`)
    await refreshBase()
    page.value = 1
    activeCategory.value = ''
    await refreshRecords()
  } catch (err) {
    if (isAuthCancelled(err)) return
    alert('导入失败：' + err.message)
  } finally {
    importing.value = false
    e.target.value = ''
  }
}

function fmtTime(v) {
  if (!v) return ''
  return String(v).replace('T', ' ').slice(0, 19)
}

const copiedId = ref(null)
let copiedTimer = null
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
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedId.value = null
  }, 1200)
}

const totalCount = computed(() => stats.value.reduce((a, s) => a + s.count, 0))

const showIssueColumns = computed(() => {
  if (activeCategory.value === '空') return false
  if (activeCategory.value && activeCategory.value !== '空') return true
  return records.value.some((r) => r.category !== '空')
})

const showOwnerColumn = computed(() => activeCategory.value === '未提取到监管码')

const colSpan = computed(() => {
  let n = 9
  if (showIssueColumns.value) n += 2
  if (showOwnerColumn.value) n += 1
  return n
})

function isIssueRecord(r) {
  return r.category !== '空'
}

const savingReasonId = ref(null)
async function saveReason(r) {
  if (!isIssueRecord(r)) return
  savingReasonId.value = r.id
  try {
    const data = await updateRecordReason(r.id, r.reason_note || '')
    r.reason_note = data.reason_note || ''
  } catch (e) {
    if (isAuthCancelled(e)) return
    alert(e.message)
  } finally {
    savingReasonId.value = null
  }
}

const savingOwnerId = ref(null)
async function saveOwner(r) {
  if (r.category !== '未提取到监管码') return
  savingOwnerId.value = r.id
  try {
    const data = await updateProblemOwner(r.id, r.problem_owner || '我方')
    r.problem_owner = data.problem_owner
    if (data.scan_rate) scanRate.value = data.scan_rate
  } catch (e) {
    if (isAuthCancelled(e)) return
    alert(e.message)
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
    alert('请粘贴或选择图片文件')
    return
  }
  uploadingRemarkId.value = r.id
  try {
    await uploadRemarkImage(r.id, file)
    r.has_remark_image = true
    r._remarkVersion = Date.now()
  } catch (err) {
    if (isAuthCancelled(err)) return
    alert(err.message)
  } finally {
    uploadingRemarkId.value = null
  }
}

async function onRemarkImage(e, r) {
  const file = e.target.files?.[0]
  e.target.value = ''
  await uploadRemarkFile(r, file)
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
  if (!confirm('确定删除该备注图片吗？')) return
  try {
    await deleteRemarkImage(r.id)
    r.has_remark_image = false
    r._remarkVersion = Date.now()
  } catch (e) {
    if (isAuthCancelled(e)) return
    alert(e.message)
  }
}

const previewImage = ref(null)
function openPreview(r) {
  previewImage.value = remarkImageUrl(r.id, r._remarkVersion || r.id)
}
function closePreview() {
  previewImage.value = null
}

watch(page, (p) => {
  jumpPage.value = p
})

onMounted(async () => {
  await refreshBase()
  await refreshRecords()
})
</script>

<template>
  <div class="page" v-if="day">
    <div class="nav-back">
      <button class="btn-ghost" @click="router.push(`/city/${day.city_id}`)">← 返回日期列表</button>
      <span class="day-title">
        {{ day.city_name }} · {{ day.day_date }}
        <span v-if="scanRate.total" class="scan-rate" title="读码率 = (总数 − 我方问题) ÷ 总数 × 100%">
          读码率 <em>{{ scanRateText }}</em>
        </span>
      </span>
    </div>

    <div class="card import-bar">
      <label class="btn-primary import-btn" :class="{ disabled: importing }">
        {{ importing ? '导入中…' : '📥 导入统计明细 (xls/xlsx)' }}
        <input type="file" accept=".xls,.xlsx" :disabled="importing" @change="onImport" />
      </label>
      <span class="import-tip">导入后写入 MySQL；已有数据时会提示是否覆盖。按「补扫原因」自动分类。</span>
    </div>

    <div class="card stat-card" v-if="stats.length">
      <div class="cat-tabs">
        <button
          class="cat-tab"
          :class="{ active: activeCategory === '' }"
          @click="switchCategory('')"
        >
          全部 <em>{{ totalCount }}</em>
        </button>
        <button
          v-for="s in stats"
          :key="s.category"
          class="cat-tab"
          :class="{ active: activeCategory === s.category }"
          @click="switchCategory(s.category)"
        >
          {{ s.category }} <em>{{ s.count }}</em>
        </button>
      </div>

      <div class="search-bar">
        <input
          v-model="keyword"
          class="search-input"
          placeholder="按 商品名称 / 监管码 / 单据编号 / 操作员 搜索"
          @keyup.enter="doSearch"
        />
        <button class="btn-primary" @click="doSearch">搜索</button>
      </div>

      <div class="table-wrap">
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
            <tr v-if="loadingRecords && records.length === 0">
              <td :colspan="colSpan" class="td-center">加载中…</td>
            </tr>
            <tr v-else-if="records.length === 0">
              <td :colspan="colSpan" class="td-center">无匹配记录</td>
            </tr>
            <tr v-for="r in records" :key="r.id">
              <td>{{ r.doc_no }}</td>
              <td class="td-serial">
                <button
                  v-if="r.serial_no"
                  type="button"
                  class="serial-copy"
                  :class="{ copied: copiedId === r.id }"
                  :title="copiedId === r.id ? '已复制' : '点击复制条码流水号'"
                  @click="copySerial(r)"
                >
                  <span class="td-mono">{{ r.serial_no }}</span>
                  <svg
                    v-if="copiedId !== r.id"
                    class="serial-icon"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2" />
                  </svg>
                  <svg
                    v-else
                    class="serial-icon"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    aria-hidden="true"
                  >
                    <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <span v-else class="td-muted">—</span>
              </td>
              <td>{{ r.goods_name }}</td>
              <td>{{ r.spec }}</td>
              <td class="td-ellipsis" :title="r.manufacturer">{{ r.manufacturer }}</td>
              <td class="td-mono">{{ r.drug_code }}</td>
              <td>{{ r.operator }}</td>
              <td class="td-mono">{{ fmtTime(r.op_time) }}</td>
              <td>
                <span class="reason-tag" :class="{ 'reason-ok': r.category === '空' }">{{ r.category }}</span>
              </td>
              <td v-if="showOwnerColumn" class="td-owner">
                <select
                  v-model="r.problem_owner"
                  class="owner-select"
                  :disabled="savingOwnerId === r.id"
                  @change="saveOwner(r)"
                >
                  <option value="我方">我方</option>
                  <option value="客户">客户</option>
                </select>
              </td>
              <td v-if="showIssueColumns" class="td-reason">
                <template v-if="isIssueRecord(r)">
                  <input
                    v-model="r.reason_note"
                    class="reason-input"
                    placeholder="填写原因说明"
                    maxlength="512"
                    :disabled="savingReasonId === r.id"
                    @blur="saveReason(r)"
                  />
                </template>
                <span v-else class="td-muted">—</span>
              </td>
              <td v-if="showIssueColumns" class="td-remark">
                <template v-if="isIssueRecord(r)">
                  <div
                    class="remark-paste"
                    :class="{
                      focused: pasteFocusId === r.id,
                      uploading: uploadingRemarkId === r.id,
                      hasimg: r.has_remark_image,
                    }"
                    tabindex="0"
                    :title="r.has_remark_image ? '点击后 Ctrl+V 可替换图片' : '点击后 Ctrl+V 粘贴图片'"
                    @click="pasteFocusId = r.id"
                    @focus="pasteFocusId = r.id"
                    @blur="pasteFocusId = null"
                    @paste="onRemarkPaste($event, r)"
                  >
                    <img
                      v-if="r.has_remark_image"
                      class="remark-thumb"
                      :src="remarkImageUrl(r.id, r._remarkVersion || r.id)"
                      alt="备注"
                      @click.stop="openPreview(r)"
                    />
                    <span v-else class="remark-hint">{{ uploadingRemarkId === r.id ? '上传中…' : '点击后粘贴图片' }}</span>
                    <label class="remark-upload" @click.stop>
                      {{ r.has_remark_image ? '更换' : '选择' }}
                      <input
                        type="file"
                        accept="image/*"
                        :disabled="uploadingRemarkId === r.id"
                        @change="onRemarkImage($event, r)"
                      />
                    </label>
                    <button
                      v-if="r.has_remark_image"
                      type="button"
                      class="remark-del"
                      title="删除备注图片"
                      @click.stop="removeRemark(r)"
                    >
                      ×
                    </button>
                  </div>
                </template>
                <span v-else class="td-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="previewImage" class="modal-mask" @click.self="closePreview">
        <div class="preview-box">
          <button type="button" class="preview-close" @click="closePreview">×</button>
          <img :src="previewImage" alt="备注大图" class="preview-img" />
        </div>
      </div>

      <div class="pager">
        <label class="pager-size">
          每页
          <select v-model.number="pageSize" @change="changePageSize">
            <option v-for="n in pageSizeOptions" :key="n" :value="n">{{ n }}</option>
          </select>
          条
        </label>
        <button class="btn-ghost" :disabled="page <= 1" @click="flipPage(-1)">上一页</button>
        <span class="pager-info">{{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
        <button class="btn-ghost" :disabled="page >= totalPages" @click="flipPage(1)">下一页</button>
        <label class="pager-jump">
          跳至
          <input
            v-model.number="jumpPage"
            type="number"
            min="1"
            :max="totalPages"
            @keyup.enter="goJumpPage"
          />
          页
          <button class="btn-ghost" type="button" @click="goJumpPage">Go</button>
        </label>
      </div>
    </div>

    <div v-else class="card empty-tip">
      该日期还没有数据，点击上方「导入统计明细」上传海康统计明细 xls 文件
    </div>
  </div>
</template>

<style scoped>
.nav-back {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.day-title {
  font-size: 16px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.import-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.import-btn {
  display: inline-block;
  position: relative;
  overflow: hidden;
}
.import-btn.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.import-btn input[type='file'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.import-tip {
  font-size: 13px;
  color: #8a94a6;
}
.stat-card {
  margin-bottom: 20px;
}
.cat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.cat-tab {
  background: #f1f4f9;
  color: #42506b;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 13px;
}
.cat-tab em {
  font-style: normal;
  font-weight: 700;
  margin-left: 4px;
  color: #2f6fed;
}
.cat-tab.active {
  background: #2f6fed;
  color: #fff;
}
.cat-tab.active em {
  color: #fff;
}
.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}
.search-input:focus {
  border-color: #2f6fed;
}
.table-wrap {
  overflow: auto;
  max-height: calc(100vh - 340px);
  border: 1px solid #edf0f5;
  border-radius: 8px;
}
.rec-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.rec-table th,
.rec-table td {
  border-bottom: 1px solid #edf0f5;
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
}
.rec-table th {
  background: #f8fafc;
  color: #5b6779;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}
.td-center {
  text-align: center;
  color: #8a94a6;
}
.td-mono {
  font-family: Consolas, monospace;
}
.td-serial {
  white-space: nowrap;
}
.serial-copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: #f1f4f9;
  border: 1px solid transparent;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.serial-copy:hover {
  border-color: #2f6fed;
  background: #e8f0fe;
  color: #2f6fed;
}
.serial-copy.copied {
  border-color: #1d8a4b;
  background: #e8f6ee;
  color: #1d8a4b;
}
.serial-icon {
  flex-shrink: 0;
  opacity: 0.55;
}
.serial-copy:hover .serial-icon,
.serial-copy.copied .serial-icon {
  opacity: 1;
}
.td-muted {
  color: #b0b8c7;
}
.td-ellipsis {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reason-tag {
  display: inline-block;
  background: #fdf0e6;
  color: #c2560c;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
}
.reason-tag.reason-ok {
  background: #e8f6ee;
  color: #1d8a4b;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}
.pager-info {
  font-size: 13px;
  color: #5b6779;
}
.pager-size,
.pager-jump {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #5b6779;
}
.pager-size select,
.pager-jump input {
  padding: 4px 8px;
  border: 1px solid #d7dce5;
  border-radius: 4px;
  font-size: 13px;
}
.pager-jump input {
  width: 64px;
}
.td-owner {
  min-width: 90px;
}
.owner-select {
  padding: 5px 8px;
  border: 1px solid #d7dce5;
  border-radius: 4px;
  font-size: 12px;
  background: #fff;
}
.td-reason {
  min-width: 160px;
  max-width: 220px;
  white-space: normal;
}
.reason-input {
  width: 100%;
  min-width: 140px;
  padding: 6px 8px;
  border: 1px solid #d7dce5;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}
.reason-input:focus {
  border-color: #2f6fed;
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
  min-width: 160px;
  padding: 6px 8px;
  border: 1px dashed #c5cedb;
  border-radius: 6px;
  background: #fafbfd;
  outline: none;
  cursor: pointer;
}
.remark-paste.focused {
  border-color: #2f6fed;
  background: #eef3fd;
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.15);
}
.remark-paste.uploading {
  opacity: 0.65;
}
.remark-hint {
  font-size: 12px;
  color: #8a94a6;
}
.remark-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #d7dce5;
  cursor: zoom-in;
}
.remark-upload {
  position: relative;
  display: inline-block;
  padding: 4px 10px;
  font-size: 12px;
  color: #2f6fed;
  background: #eef3fd;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
}
.remark-upload input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.remark-del {
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  color: #e5484d;
  background: #fff;
  border: 1px solid #e5484d;
  border-radius: 4px;
}
.remark-del:hover {
  background: #e5484d;
  color: #fff;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.preview-box {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  background: #fff;
  border-radius: 8px;
  padding: 12px;
}
.preview-close {
  position: absolute;
  top: 4px;
  right: 8px;
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: 24px;
  color: #5b6779;
  background: transparent;
  border: none;
}
.preview-img {
  max-width: 85vw;
  max-height: 80vh;
  display: block;
}
</style>
