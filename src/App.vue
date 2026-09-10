<script setup>
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { isLoggedIn, username, showLoginModal, cancelLogin } from './auth.js'
import { login, logout } from './api.js'

const route = useRoute()
const titles = {
  home: '九州通读码数据验收 · 城市管理',
  city: '日期文件夹',
  day: '验收数据明细',
  excel: 'Excel 编辑',
}

const loginUser = ref('')
const loginPass = ref('')
const loginError = ref('')
const loggingIn = ref(false)

watch(showLoginModal, (open) => {
  if (open) {
    loginUser.value = ''
    loginPass.value = ''
    loginError.value = ''
  }
})

async function doLogin() {
  loginError.value = ''
  const u = loginUser.value.trim()
  const p = loginPass.value
  if (!u || !p) {
    loginError.value = '请输入账号和密码'
    return
  }
  loggingIn.value = true
  try {
    await login(u, p)
    ElMessage.success('登录成功')
  } catch (e) {
    loginError.value = e.message || '登录失败'
  } finally {
    loggingIn.value = false
  }
}

async function doLogout() {
  await logout()
  ElMessage.success('已退出登录')
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-inner">
        <div class="header-left">
          <span class="logo">九州通读码数据验收</span>
          <el-tag effect="dark" type="info" size="small">{{ titles[route.name] || '' }}</el-tag>
        </div>
        <div class="header-right">
          <template v-if="isLoggedIn">
            <span class="user-name">{{ username }}</span>
            <el-button size="small" @click="doLogout">退出</el-button>
          </template>
          <el-button v-else size="small" type="primary" @click="showLoginModal = true">登录</el-button>
        </div>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>

    <el-dialog
      v-model="showLoginModal"
      title="账号登录"
      width="400px"
      :close-on-click-modal="false"
      @close="cancelLogin"
    >
      <p class="login-tip">浏览数据无需登录；添加、删除、导入或修改记录时需要登录</p>
      <el-form label-position="top" @submit.prevent="doLogin">
        <el-form-item label="账号">
          <el-input v-model="loginUser" placeholder="请输入账号" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="loginPass"
            type="password"
            placeholder="请输入密码"
            show-password
            autocomplete="current-password"
            @keyup.enter="doLogin"
          />
        </el-form-item>
        <el-alert v-if="loginError" :title="loginError" type="error" show-icon :closable="false" />
      </el-form>
      <template #footer>
        <el-button @click="cancelLogin">取消</el-button>
        <el-button type="primary" :loading="loggingIn" @click="doLogin">登录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.app-header {
  background: #1f3a5f;
  color: #fff;
  padding: 12px 24px;
}
.app-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.logo {
  font-size: 18px;
  font-weight: 600;
}
.user-name {
  font-size: 13px;
  opacity: 0.9;
}
.login-tip {
  margin: 0 0 12px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
