import request from './request'

const long = { timeout: 120000 }

// ---------------------------------------------------------------- 任务
export const getTask = (id) => request.get(`/hqla/tasks/${id}`)
export const updateTask = (id, body) => request.put(`/hqla/tasks/${id}`, body)
export const deleteTask = (id) => request.delete(`/hqla/tasks/${id}`)
export const archiveTask = (id, archived) => request.post(`/hqla/tasks/${id}/archive`, { archived })

// ---------------------------------------------------------------- 任务数据
export const saveInput = (id, body) => request.put(`/hqla/tasks/${id}/input`, body)
export const saveDatasets = (id, datasets) => request.put(`/hqla/tasks/${id}/datasets`, { datasets })
export const saveDatasetMeta = (id, datasetId, patch) =>
  request.put(`/hqla/tasks/${id}/datasets/${encodeURIComponent(datasetId)}`, patch)
export const deleteDataset = (id, datasetId) =>
  request.delete(`/hqla/tasks/${id}/datasets/${encodeURIComponent(datasetId)}`)
export const identifyDatasets = (id) => request.post(`/hqla/tasks/${id}/identify`, {}, long)
export const autoMapDatasets = (id) => request.post(`/hqla/tasks/${id}/auto-map`, {}, long)
export const checkQuality = (id) => request.post(`/hqla/tasks/${id}/quality`, {}, long)

// ---------------------------------------------------------------- 阶段 2：记录级识别与字段对应
export const getTaskSnapshot = (id) => request.get(`/hqla/tasks/${id}/snapshot`)
export const recognizeProducts = (id, body = {}) =>
  request.post(`/hqla/tasks/${id}/products/recognize`, body, long)
export const listRecognitions = (id, params = {}) =>
  request.get(`/hqla/tasks/${id}/recognitions`, { params })
export const confirmRecognitions = (id, body = {}) =>
  request.post(`/hqla/tasks/${id}/recognitions/confirm`, body)
export const suggestFields = (id, body = {}) =>
  request.post(`/hqla/tasks/${id}/fields/suggest`, body, long)
export const listFields = (id, params = {}) =>
  request.get(`/hqla/tasks/${id}/fields`, { params })
export const confirmFields = (id, body = {}) =>
  request.post(`/hqla/tasks/${id}/fields/confirm`, body)

// ---------------------------------------------------------------- 阶段 3：质量检查与计算批次
export const getPreflight = (id, allowPartial = false) =>
  request.get(`/hqla/tasks/${id}/preflight`, { params: allowPartial ? { allowPartial: 1 } : {} })
export const runQuality = (id) => request.post(`/hqla/tasks/${id}/quality/run`, {}, long)
export const listQualityRuns = (id) => request.get(`/hqla/tasks/${id}/quality/runs`)
export const listQualityIssues = (id, params = {}) =>
  request.get(`/hqla/tasks/${id}/quality/issues`, { params })
export const computeRun = (id, body = {}) => request.post(`/hqla/tasks/${id}/runs`, body, long)
export const listRuns = (id) => request.get(`/hqla/tasks/${id}/runs`)
export const getRun = (id, runId) => request.get(`/hqla/tasks/${id}/runs/${runId}`)
export const listRunResults = (id, runId, params = {}) =>
  request.get(`/hqla/tasks/${id}/runs/${runId}/results`, { params })
export const listRunExceptions = (id, runId, params = {}) =>
  request.get(`/hqla/tasks/${id}/runs/${runId}/exceptions`, { params })
export const exportRunWorkbook = (id, runId) =>
  request.get(`/hqla/tasks/${id}/runs/${runId}/export.xlsx`, { ...long, responseType: 'blob' })
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
export const inspectWorkbook = (body) => request.post('/hqla/inspect-workbook', body, long)
export const parseWorkbook = (body) => request.post('/hqla/parse-workbook', body, long)
export const computeTask = (id) => request.post(`/hqla/tasks/${id}/compute`, {}, long)
export const computeLcr = (id) => request.post(`/hqla/tasks/${id}/lcr-compute`, {}, long)
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
