import axios from 'axios'
import i18n from '../i18n'

export const api = axios.create({
  baseURL: '/api',
  headers: { Accept: 'application/json' },
})

// Attach the active UI language to every request.
api.interceptors.request.use((config) => {
  config.params = { lang: i18n.language?.slice(0, 2) || 'en', ...config.params }
  return config
})
