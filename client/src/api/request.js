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
    const message = (data && data.error) || error.message || '请求失败'
    return Promise.reject(new Error(message))
  },
)

export default request
