import request from './request'

export const fetchEadConfig = (side) => request.get('/ead-config', { params: { side } })

export const saveEadConfig = (side, config) => request.put('/ead-config', { side, config })

export const trialEad = (body) => request.post('/ead-trial', body)
