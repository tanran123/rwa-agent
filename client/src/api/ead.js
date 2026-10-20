import request from './request'

export const fetchEadRules = (side) => request.get('/ead-rules', { params: { side } })

export const createEadRule = (rule) => request.post('/ead-rules', rule)

export const updateEadRule = (id, rule) => request.put('/ead-rules/' + id, rule)

export const trialEad = (body) => request.post('/ead-trial', body)

export const fetchCcf = () => request.get('/ccf')
