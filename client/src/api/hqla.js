import request from './request'

const long = { timeout: 120000 }

// ---------------------------------------------------------------- 任务
export const listTasks = () => request.get('/hqla/tasks')
export const createTask = (body) => request.post('/hqla/tasks', body)
export const getTask = (id) => request.get(`/hqla/tasks/${id}`)
export const updateTask = (id, body) => request.put(`/hqla/tasks/${id}`, body)
export const deleteTask = (id) => request.delete(`/hqla/tasks/${id}`)
export const duplicateTask = (id) => request.post(`/hqla/tasks/${id}/duplicate`)
export const archiveTask = (id, archived) => request.post(`/hqla/tasks/${id}/archive`, { archived })
export const exportTaskArchive = (id) => request.get(`/hqla/tasks/${id}/archive.json`)
export const importTask = (doc) => request.post('/hqla/import', doc)

// ---------------------------------------------------------------- 任务数据
export const saveInput = (id, body) => request.put(`/hqla/tasks/${id}/input`, body)
export const saveList = (id, code, body) => request.put(`/hqla/tasks/${id}/lists/${code}`, body)
export const deleteList = (id, code) => request.delete(`/hqla/tasks/${id}/lists/${code}`)
export const saveConfig = (id, config) => request.put(`/hqla/tasks/${id}/config`, { config })
export const saveSample = (id, sample) => request.put(`/hqla/tasks/${id}/sample`, { sample })
export const saveFetch = (id, fetchLog, fetchSig) => request.put(`/hqla/tasks/${id}/fetch`, { fetchLog, fetchSig })
export const saveReported = (id, rows) => request.put(`/hqla/tasks/${id}/reported`, { rows })

// ---------------------------------------------------------------- 引擎（Flask 转发）
export const listMeta = () => request.get('/hqla/list-meta')
export const reference = () => request.get('/hqla/reference')
export const upsertReference = (rows) => request.post('/hqla/reference', { rows })
export const demo = (kind) => request.get(`/hqla/demo/${kind}`)
export const inspectUpload = (body) => request.post('/hqla/inspect', body, long)
export const parseUpload = (body) => request.post('/hqla/parse', body, long)
export const computeTask = (id) => request.post(`/hqla/tasks/${id}/compute`, {}, long)
export const planSample = (id) => request.post(`/hqla/tasks/${id}/sample`, {}, long)
export const listHits = (id, code) => request.post(`/hqla/tasks/${id}/list-hits`, { code }, long)
export const exportWorkbook = (id) => request.post(`/hqla/tasks/${id}/export`, {}, { ...long, responseType: 'blob' })

// ---------------------------------------------------------------- 工具
export function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      resolve(text.slice(text.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadJson(data, filename) {
  downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), filename)
}
