<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import VueOfficeExcel from '@vue-office/excel'
import '@vue-office/excel/lib/index.css'
import { getExcelMeta, fetchExcelBuffer, deleteExcel } from '../api.js'
import { isAuthCancelled } from '../auth.js'

const props = defineProps({ excelId: String })
const router = useRouter()

const meta = ref(null)
const src = ref(null)
const loading = ref(true)
const saving = ref(false)
const tip = ref('')

async function init() {
  loading.value = true
  tip.value = ''
  src.value = null
  try {
    const data = await getExcelMeta(props.excelId)
    meta.value = data.excel
    document.title = `${meta.value.file_name} - Excel 浏览`

    const preview = await fetchExcelBuffer(props.excelId, { preview: true })
    src.value = preview.buffer
    if (preview.converted) {
      tip.value =
        '当前文件为旧版 .xls，预览已自动转码为 xlsx（中文乱码已处理）。旧格式无法保留嵌入图片；请尽量使用 .xlsx 导入以完整显示图片。'
    }
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function saveFile() {
  if (!meta.value) return
  saving.value = true
  try {
    const { buffer } = await fetchExcelBuffer(props.excelId, { download: true })
    const blob = new Blob([buffer], {
      type: meta.value.mime_type || 'application/octet-stream',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.value.file_name || 'export.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    ElMessage.success('已保存到本地')
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

function onRendered() {
  ElMessage.success({ message: 'Excel 渲染完成', duration: 1500 })
}

function onError() {
  ElMessage.error('Excel 渲染失败，请尝试另存为 .xlsx 后重新导入')
}

onMounted(init)
onBeforeUnmount(() => {
  src.value = null
})
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
        <el-button type="primary" :loading="saving" :disabled="!meta" @click="saveFile">保存到本地</el-button>
        <el-button type="danger" plain :disabled="!meta" @click="removeFile">删除此文件</el-button>
      </div>
    </div>

    <el-alert
      v-if="tip"
      class="excel-tip"
      :title="tip"
      type="warning"
      show-icon
      :closable="false"
    />

    <div class="excel-body" v-loading="loading" element-loading-text="正在加载 Excel…">
      <vue-office-excel
        v-if="src"
        :src="src"
        class="office-excel"
        @rendered="onRendered"
        @error="onError"
      />
      <el-empty v-else-if="!loading" description="无法加载文件" />
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
  flex: 1;
  min-height: 0;
  position: relative;
}
.office-excel {
  width: 100%;
  height: 100%;
}
</style>
