<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { isLoggedIn, username, showLoginModal, cancelLogin } from './auth.js'
import { login, logout } from './api.js'

const route = useRoute()
const titles = {
  home: '九州通读码数据验收 · 城市管理',
  city: '日期文件夹',
  day: '验收数据明细',
}

const loginUser = ref('dream')
const loginPass = ref('dream')
const loginError = ref('')
const loggingIn = ref(false)

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
  } catch (e) {
    loginError.value = e.message || '登录失败'
  } finally {
    loggingIn.value = false
  }
}

async function doLogout() {
  await logout()
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-inner">
        <div class="header-left">
          <span class="logo">📦 九州通读码数据验收</span>
          <span class="crumb">{{ titles[route.name] || '' }}</span>
        </div>
        <div class="header-right">
          <template v-if="isLoggedIn">
            <span class="user-name">{{ username }}</span>
            <button type="button" class="btn-header" @click="doLogout">退出</button>
          </template>
          <button v-else type="button" class="btn-header" @click="showLoginModal = true">登录</button>
        </div>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>

    <div v-if="showLoginModal" class="login-mask" @click.self="cancelLogin">
      <div class="login-card">
        <h3>账号登录</h3>
        <p class="login-tip">浏览数据无需登录；添加、删除、导入或修改记录时需要登录</p>
        <label class="login-field">
          账号
          <input v-model="loginUser" class="login-input" autocomplete="username" @keyup.enter="doLogin" />
        </label>
        <label class="login-field">
          密码
          <input
            v-model="loginPass"
            type="password"
            class="login-input"
            autocomplete="current-password"
            @keyup.enter="doLogin"
          />
        </label>
        <p v-if="loginError" class="login-error">{{ loginError }}</p>
        <div class="login-actions">
          <button type="button" class="btn-ghost" @click="cancelLogin">取消</button>
          <button type="button" class="btn-primary" :disabled="loggingIn" @click="doLogin">
            {{ loggingIn ? '登录中…' : '登录' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-header {
  background: #1f3a5f;
  color: #fff;
  padding: 14px 24px;
}
.app-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.header-left {
  display: flex;
  align-items: baseline;
  gap: 16px;
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
.crumb {
  font-size: 13px;
  opacity: 0.75;
}
.user-name {
  font-size: 13px;
  opacity: 0.9;
}
.btn-header {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
}
.btn-header:hover {
  background: rgba(255, 255, 255, 0.22);
}
.login-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.login-card {
  width: 360px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 10px;
  padding: 22px 22px 18px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.2);
  color: #2c3e50;
}
.login-card h3 {
  margin: 0 0 8px;
  font-size: 18px;
}
.login-tip {
  margin: 0 0 16px;
  font-size: 12px;
  color: #8a94a6;
  line-height: 1.5;
}
.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #5b6779;
}
.login-input {
  padding: 9px 12px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}
.login-input:focus {
  border-color: #2f6fed;
}
.login-error {
  margin: 0 0 10px;
  color: #e5484d;
  font-size: 13px;
}
.login-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
</style>
