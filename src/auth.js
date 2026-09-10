import { ref, computed } from 'vue'

const TOKEN_KEY = 'jzt_auth_token'
const USER_KEY = 'jzt_auth_user'

export const token = ref(localStorage.getItem(TOKEN_KEY) || '')
export const username = ref(localStorage.getItem(USER_KEY) || '')
export const isLoggedIn = computed(() => !!token.value)

/** 登录弹窗是否打开 */
export const showLoginModal = ref(false)

let pending = null

export function openLogin() {
  showLoginModal.value = true
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
  })
}

export function cancelLogin() {
  showLoginModal.value = false
  if (pending) {
    const p = pending
    pending = null
    p.reject(new Error('已取消登录'))
  }
}

export function setSession(newToken, user) {
  token.value = newToken
  username.value = user
  localStorage.setItem(TOKEN_KEY, newToken)
  localStorage.setItem(USER_KEY, user)
  showLoginModal.value = false
  if (pending) {
    const p = pending
    pending = null
    p.resolve(true)
  }
}

export function clearSession() {
  token.value = ''
  username.value = ''
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function logoutLocal() {
  clearSession()
}

/** 修改数据前调用：未登录则弹出登录框，登录成功后继续 */
export async function ensureAuth() {
  if (isLoggedIn.value) return true
  await openLogin()
  return true
}

export function isAuthCancelled(err) {
  return err && err.message === '已取消登录'
}
