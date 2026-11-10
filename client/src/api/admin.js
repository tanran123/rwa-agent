import request from './request'

// 登录与系统管理
export const loginSession = (body) => request.post('/auth/login', body)
export const logoutSession = (body) => request.post('/auth/logout', body)
export const fetchSession = (username) => request.get('/auth/session', { params: { username } })

export const fetchMenus = () => request.get('/menus')

export const fetchUsers = () => request.get('/users')
export const createUser = (body) => request.post('/users', body)
export const saveUser = (id, body) => request.put('/users/' + id, body)
export const toggleUser = (id, body) => request.post(`/users/${id}/toggle`, body)
export const resetUserPassword = (id, body) => request.post(`/users/${id}/reset-password`, body)

export const fetchRoles = () => request.get('/roles')
export const createRole = (body) => request.post('/roles', body)
export const saveRole = (id, body) => request.put('/roles/' + id, body)
export const saveRoleMenus = (id, body) => request.put(`/roles/${id}/menus`, body)
export const toggleRole = (id, body) => request.post(`/roles/${id}/toggle`, body)

export const fetchLoginLogs = () => request.get('/login-logs')
export const fetchOperationLogs = () => request.get('/operation-logs')

export const fetchLlmConfigs = (owner) => request.get('/llm-configs', { params: { owner } })
export const createLlmConfig = (body) => request.post('/llm-configs', body)
export const saveLlmConfig = (id, body) => request.put('/llm-configs/' + id, body)
export const toggleLlmConfig = (id, body) => request.post(`/llm-configs/${id}/toggle`, body)
export const setDefaultLlmConfig = (id, body) => request.post(`/llm-configs/${id}/default`, body)
export const testLlmConfig = (id, body) => request.post(`/llm-configs/${id}/test`, body)

export const fetchTokenLogs = (params) => request.get('/token-logs', { params })
