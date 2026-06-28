import axios from 'axios'
import i18n from '../i18n'

const TOKEN_KEY = 'tibia_atlas_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export const api = axios.create({
  baseURL: '/api',
  headers: { Accept: 'application/json' },
})

// Attach the active UI language and (if present) the admin token to every request.
api.interceptors.request.use((config) => {
  config.params = { lang: i18n.language?.slice(0, 2) || 'en', ...config.params }
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401, drop the stale token so the admin UI bounces back to login.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) clearToken()
    return Promise.reject(error)
  },
)
