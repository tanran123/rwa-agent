import request from './request'
import { currentUser } from '@/utils/auth'

const codeOf = (code) => encodeURIComponent(code)

export const fetchProducts = () => request.get('/products')

export const fetchProductStandardProducts = (version = '') =>
  request.get('/product-standard/products', { params: version ? { version } : {} })

export const fetchProductGroupMappings = (version = '') =>
  request.get('/product-standard/group-mappings', { params: version ? { version } : {} })

export const assistProductGroup = (body) =>
  request.post('/product-standard/assist/group', body, { timeout: 240000 })

/**
 * 分组生成的流式版本：事件为 status / token / decision / field / dictionary / mapping / result / error。
 * action=answer 时只有 status / token / result / error。
 */
export async function assistProductGroupStream(body, handlers = {}, signal) {
  const base = import.meta.env.VITE_API_BASE_URL || '/api'
  const user = currentUser()
  const response = await fetch(base + '/product-standard/assist/group/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user && user.username ? { 'X-RWA-User': user.username } : {})
    },
    body: JSON.stringify(body),
    signal
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = text
    try {
      const parsed = JSON.parse(text)
      message = parsed.error || text
    } catch {
      // keep raw text
    }
    throw new Error(message || '请求失败')
  }
  if (!response.body) throw new Error('浏览器不支持流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (frame) => {
    let event = 'message'
    const data = []
    frame.split('\n').forEach((line) => {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    })
    if (!data.length) return
    let payload = null
    try {
      payload = JSON.parse(data.join('\n'))
    } catch {
      payload = { text: data.join('\n') }
    }
    const handler = handlers[event]
    if (typeof handler === 'function') handler(payload)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const frame = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      if (frame.trim()) dispatch(frame)
      index = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) dispatch(buffer)
}

export const createProduct = (body) => request.post('/products', body)

export const saveProduct = (code, body) => request.put('/products/' + codeOf(code), body)

export const deleteProduct = (code) => request.delete('/products/' + codeOf(code))

export const deleteProducts = (ids) => request.post('/products/batch-delete', { ids })

export const fetchProductFields = (code) => request.get('/products/' + codeOf(code) + '/fields')

export const createProductField = (code, body) => request.post('/products/' + codeOf(code) + '/fields', body)

export const saveProductField = (code, fieldCode, body) =>
  request.put('/products/' + codeOf(code) + '/fields/' + codeOf(fieldCode), body)

export const deleteProductField = (code, fieldCode) =>
  request.delete('/products/' + codeOf(code) + '/fields/' + codeOf(fieldCode))

export const deleteProductFields = (code, ids) =>
  request.post('/products/' + codeOf(code) + '/fields/batch-delete', { ids })

export const fetchFieldMappings = (product = '') =>
  request.get('/field-mappings', { params: product ? { product } : {} })

export const createFieldMapping = (body) => request.post('/field-mappings', body)

export const saveFieldMapping = (id, body) => request.put('/field-mappings/' + encodeURIComponent(id), body)

export const deleteFieldMapping = (id) => request.delete('/field-mappings/' + encodeURIComponent(id))

export const deleteFieldMappings = (ids) => request.post('/field-mappings/batch-delete', { ids })


/**
 * 分组智能配置工作流：事件包括 intent / plan / status / token / decision /
 * field / mapping / dictionary / review / diff / proposal / conflict /
 * approval_required / result / error。
 */
export async function assistProductGroupWorkflow(body, handlers = {}, signal) {
  return streamGroupWorkflowRequest('/product-standard/assist/group/workflow', body, handlers, signal)
}

export async function assistProductGroupWorkflowResume(body, handlers = {}, signal) {
  return streamGroupWorkflowRequest('/product-standard/assist/group/workflow/resume', body, handlers, signal)
}

async function streamGroupWorkflowRequest(path, body, handlers, signal) {
  const base = import.meta.env.VITE_API_BASE_URL || '/api'
  const user = currentUser()
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(user && user.username ? { 'X-RWA-User': user.username } : {})
    },
    body: JSON.stringify(body),
    signal
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = text
    try {
      const parsed = JSON.parse(text)
      message = parsed.error || text
    } catch {
      // keep raw text
    }
    throw new Error(message || '请求失败')
  }
  if (!response.body) throw new Error('浏览器不支持流式响应')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (frame) => {
    let event = 'message'
    const data = []
    frame.split('\n').forEach((line) => {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    })
    if (!data.length) return
    let payload = null
    try { payload = JSON.parse(data.join('\n')) } catch { payload = { text: data.join('\n') } }
    const handler = handlers[event]
    if (typeof handler === 'function') handler(payload)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const frame = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      if (frame.trim()) dispatch(frame)
      index = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) dispatch(buffer)
}

export const fetchGroupRun = (runId) => request.get('/product-standard/group-runs/' + encodeURIComponent(runId))
export const fetchGroupProposal = (proposalId) => request.get('/product-standard/group-proposals/' + encodeURIComponent(proposalId))
export const fetchGroupConstraints = (params = {}) => request.get('/product-standard/group-constraints', { params })
export const saveGroupConstraints = (body) => request.put('/product-standard/group-constraints', body)
