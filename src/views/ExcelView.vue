<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'
import { getExcelMeta, fetchExcelBuffer, deleteExcel } from '../api.js'
import { excelBufferToWorkbookData } from '../utils/excelToUniver.js'
import { isAuthCancelled } from '../auth.js'

const props = defineProps({ excelId: String })
const router = useRouter()

const containerRef = ref(null)
const meta = ref(null)
const loading = ref(true)
const error = ref('')
let univerInstance = null
let univerAPI = null

async function init() {
  loading.value = true
  error.value = ''
  try {
    const data = await getExcelMeta(props.excelId)
    meta.value = data.excel
    document.title = `${meta.value.file_name} - Excel 浏览`

    const buffer = await fetchExcelBuffer(props.excelId)
    const workbookData = excelBufferToWorkbookData(buffer, meta.value.file_name)

    loading.value = false
    await nextTick()
    if (!containerRef.value) throw new Error('容器未就绪')

    destroyUniver()
    const created = createUniver({
      locale: LocaleType.ZH_CN,
      locales: {
        [LocaleType.ZH_CN]: mergeLocales(sheetsZhCN),
      },
      presets: [
        UniverSheetsCorePreset({
          container: containerRef.value,
        }),
      ],
    })
    univerInstance = created.univer
    univerAPI = created.univerAPI
    univerAPI.createWorkbook(workbookData)
  } catch (e) {
    error.value = e.message || '加载失败'
    loading.value = false
  }
}

function destroyUniver() {
  try {
    univerAPI?.dispose?.()
  } catch {
    // ignore
  }
  try {
    univerInstance?.dispose?.()
  } catch {
    // ignore
  }
  univerAPI = null
  univerInstance = null
  if (containerRef.value) containerRef.value.innerHTML = ''
}

async function removeFile() {
  if (!confirm(`确定删除「${meta.value?.file_name}」吗？`)) return
  try {
    await deleteExcel(props.excelId)
    router.push(`/city/${meta.value.city_id}`)
  } catch (e) {
    if (isAuthCancelled(e)) return
    alert(e.message)
  }
}

onMounted(init)
onBeforeUnmount(destroyUniver)
</script>

<template>
  <div class="excel-page">
    <div class="excel-toolbar">
      <button class="btn-ghost" @click="router.push(meta ? `/city/${meta.city_id}` : '/')">
        ← 返回日期文件夹
      </button>
      <div class="excel-title" v-if="meta">
        <strong>{{ meta.city_name }} · {{ meta.day_date }}</strong>
        <span class="file-name">{{ meta.file_name }}</span>
      </div>
      <div class="excel-actions">
        <button v-if="meta" class="btn-danger" type="button" @click="removeFile">删除此文件</button>
      </div>
    </div>

    <div class="excel-body">
      <div v-if="loading" class="excel-status">正在用 Univer 加载 Excel…</div>
      <div v-else-if="error" class="excel-status error">{{ error }}</div>
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
}
.excel-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #edf0f5;
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
  color: #8a94a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.excel-actions {
  margin-left: auto;
}
.excel-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.excel-status {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f4f6fa;
  color: #8a94a6;
}
.excel-status.error {
  color: #e5484d;
}
.univer-host {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
