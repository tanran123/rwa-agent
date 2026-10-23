import request from './request'

export const fetchEadConfig = () => request.get('/ead-config')

export const saveEadConfig = (config) => request.put('/ead-config', { config })

export const checkEadFormula = (body) => request.post('/ead-formula/check', body, { timeout: 20000 })

export const trialEad = (body) => request.post('/ead-trial', body)

export const fetchCcf = () => request.get('/ccf')

export const createCcf = (body) => request.post('/ccf', body)

export const saveCcf = (id, body) => request.put('/ccf/' + encodeURIComponent(id), body)

export const deleteCcf = (id) => request.delete('/ccf/' + encodeURIComponent(id))

export const deleteCcfs = (ids) => request.post('/ccf/batch-delete', { ids })
