<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import { UniverSheetsDrawingPreset } from '@univerjs/preset-sheets-drawing'
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import sheetsDrawingZhCN from '@univerjs/preset-sheets-drawing/locales/zh-CN'
import { importFile, addImagesToWorkbook } from 'univer-file-import'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-drawing/lib/index.css'
import {
  getExcelMeta,
  fetchExcelBuffer,
  deleteExcel,
  saveExcelContent,
} from '../api.js'
import {
  excelBufferToWorkbookData,
  snapshotToXlsxKeepingImages,
} from '../utils/excelUniver.js'
import { isAuthCancelled } from '../auth.js'

const props = defineProps({ excelId: String })
const router = useRouter()

const containerRef = ref(null)
const meta = ref(null)
const loading = ref(true)
const saving = ref(false)
const tip = ref('')
let univerInstance = null
let univerAPI = null
let originalBuffer = null
let importedImages = []

function destroyUniver() {
  try {
    univerAPI?.dispose?.()
  } catch {}
  try {
    univerInstance?.dispose?.()
  } catch {}
  univerAPI = null
  univerInstance = null
  if (containerRef.value) containerRef.value.innerHTML = ''
}

function waitRendered(api, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    try {
      const stages = api?.Enum?.LifecycleStages
      const rendered = stages?.Rendered ?? stages?.Steady
      api.addEvent(api.Event.LifeCycleChanged, (event) => {
        if (rendered == null || event.stage === rendered || event.stage === stages?.Steady) {
          finish()
        }
      })
    } catch {
      // ignore
    }
    setTimeout(finish, timeoutMs)
  })
}

async function init() {
  loading.value = true
  tip.value = ''
  importedImages = []
  originalBuffer = null
  try {
    const data = await getExcelMeta(props.excelId)
    meta.value = data.excel
    document.title = `${meta.value.file_name} - Excel 编辑`

    // xls 走预览转码；xlsx 原样含图
    const preview = await fetchExcelBuffer(props.excelId, { preview: true })
    originalBuffer = preview.buffer

    const fileName = preview.converted
      ? String(meta.value.file_name || 'file.xls').replace(/\.xls$/i, '.xlsx')
      : meta.value.file_name || 'file.xlsx'
    const file = new File([preview.buffer], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    let workbookData
    try {
      const imported = await importFile(file, { includeImages: true })
      workbookData = imported.workbookData
      importedImages = imported.images || []
    } catch (e) {
      console.warn('[excel] importFile failed, fallback SheetJS', e)
      workbookData = excelBufferToWorkbookData(preview.buffer, meta.value.file_name)
    }

    const imgCount = importedImages.length
    if (preview.converted) {
      tip.value = imgCount
        ? `已从旧版 .xls 转码打开（解析到 ${imgCount} 张图）。可编辑后保存；建议源文件使用 .xlsx 以更好保留图片。`
        : '已从旧版 .xls 转码打开。可编辑后保存；嵌入图片在 .xls 转换后可能无法保留，建议使用 .xlsx。'
    } else {
      tip.value = imgCount
        ? `可编辑单元格与查看图片（已加载 ${imgCount} 张）。保存时会尽量保留原文件中的图片。`
        : '可直接编辑单元格。若原文件含图但未显示，请确认是 .xlsx 且图片为浮动/单元格图。'
    }

    loading.value = false
    await nextTick()
    if (!containerRef.value) throw new Error('容器未就绪')

    destroyUniver()
    const created = createUniver({
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: mergeLocales(sheetsZhCN, sheetsDrawingZhCN),
      },
      presets: [
        UniverSheetsCorePreset({ container: containerRef.value }),
        UniverSheetsDrawingPreset(),
      ],
    })
    univerInstance = created.univer
    univerAPI = created.univerAPI
    univerAPI.createWorkbook(workbookData)

    if (importedImages.length) {
      await waitRendered(univerAPI, 3000)
      try {
        const result = await addImagesToWorkbook(univerAPI, importedImages)
        if (result?.failed) {
          console.warn('[excel] some images failed', result)
        }
      } catch (e) {
        console.warn('[excel] addImagesToWorkbook failed', e)
        ElMessage.warning('部分图片未能插入编辑器，保存时仍会尽量从原文件保留')
      }
    }
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
    loading.value = false
  }
}

function getSnapshot() {
  const wb = univerAPI?.getActiveWorkbook?.()
  if (!wb) throw new Error('表格未就绪')
  if (typeof wb.save === 'function') return wb.save()
  if (typeof wb.getSnapshot === 'function') return wb.getSnapshot()
  throw new Error('当前版本无法导出表格数据')
}

async function saveChanges() {
  if (!meta.value || !univerAPI) return
  saving.value = true
  try {
    const snapshot = getSnapshot()
    const arr = await snapshotToXlsxKeepingImages(snapshot, originalBuffer, importedImages)
    let fileName = meta.value.file_name || 'edited.xlsx'
    if (!/\.xlsx$/i.test(fileName)) fileName = fileName.replace(/\.(xls)?$/i, '') + '.xlsx'
    const result = await saveExcelContent(props.excelId, arr, fileName)
    meta.value.file_name = result.file_name
    meta.value.file_size = result.file_size
    originalBuffer = arr
    ElMessage.success('修改已保存')
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function downloadLocal() {
  if (!meta.value) return
  saving.value = true
  try {
    let arr
    let fileName = meta.value.file_name || 'export.xlsx'
    try {
      const snapshot = getSnapshot()
      arr = await snapshotToXlsxKeepingImages(snapshot, originalBuffer, importedImages)
      if (!/\.xlsx$/i.test(fileName)) fileName = fileName.replace(/\.(xls)?$/i, '') + '.xlsx'
    } catch {
      const file = await fetchExcelBuffer(props.excelId, { download: true })
      arr = file.buffer
    }
    const blob = new Blob([arr], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    ElMessage.success('已下载到本地')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function removeFile() {
  try {
    await ElMessageBox.confirm(`确定删除「${meta.value?.file_name}」吗？`, '删除确认', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await deleteExcel(props.excelId)
    ElMessage.success('已删除')
    router.push(`/city/${meta.value.city_id}`)
  } catch (e) {
    if (isAuthCancelled(e)) return
    ElMessage.error(e.message)
  }
}

onMounted(init)
onBeforeUnmount(destroyUniver)
</script>

<template>
  <div class="excel-page">
    <div class="excel-toolbar">
      <el-button @click="router.push(meta ? `/city/${meta.city_id}` : '/')">← 返回日期文件夹</el-button>
      <div class="excel-title" v-if="meta">
        <strong>{{ meta.city_name }} · {{ meta.day_date }}</strong>
        <span class="file-name">{{ meta.file_name }}</span>
      </div>
      <div class="excel-actions">
        <el-button type="primary" :loading="saving" :disabled="!meta || loading" @click="saveChanges">
          保存修改
        </el-button>
        <el-button :disabled="!meta || loading" @click="downloadLocal">下载</el-button>
        <el-button type="danger" plain :disabled="!meta" @click="removeFile">删除</el-button>
      </div>
    </div>

    <el-alert v-if="tip" class="excel-tip" :title="tip" type="info" show-icon :closable="false" />

    <div class="excel-body" v-loading="loading" element-loading-text="正在加载 Excel…">
      <div ref="containerRef" class="univer-host"></div>
    </div>
  </div>
</template>

<style scoped>
.excel-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 56px);
  margin: -20px -24px -40px;
  background: #fff;
}
.excel-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.excel-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.excel-title strong {
  font-size: 14px;
}
.file-name {
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.excel-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.excel-tip {
  margin: 0;
  border-radius: 0;
}
.excel-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.univer-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
