import request from './request'

// 信用风险 RWA 任务工作台：主任务（季度）+ 暴露子任务
export const fetchTasks = () => request.get('/rwa-tasks')
export const fetchTask = (id) => request.get('/rwa-tasks/' + id)
export const createTask = (body) => request.post('/rwa-tasks', body)
export const updateTask = (id, body) => request.put('/rwa-tasks/' + id, body)
export const deleteTask = (id) => request.delete('/rwa-tasks/' + id)

export const createSubtask = (taskId, body) => request.post(`/rwa-tasks/${taskId}/subs`, body)
export const updateSubtask = (taskId, subId, body) => request.put(`/rwa-tasks/${taskId}/subs/${subId}`, body)
export const deleteSubtask = (taskId, subId) => request.delete(`/rwa-tasks/${taskId}/subs/${subId}`)
export const archiveSubtask = (taskId, subId, batchId) => request.post(`/rwa-tasks/${taskId}/subs/${subId}/archive`, { batchId })
