import axios from 'axios'
import { currentUser } from '@/utils/auth'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
})

request.interceptors.request.use(
  (config) => {
    const user = currentUser()
    if (user && user.username) config.headers['X-RWA-User'] = user.username
    return config
  },
  (error) => Promise.reject(error),
)

request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const data = error && error.response && error.response.data
    const timedOut = error && (error.code === 'ECONNABORTED' || /timeout/i.test(String(error.message || '')))
    const message = (data && data.error) || (timedOut ? '请求超时，请稍后重试' : error.message || '请求失败')
    const wrapped = new Error(message)
    wrapped.status = error && error.response && error.response.status
    wrapped.data = data || null
    return Promise.reject(wrapped)
  },
)

export default request
