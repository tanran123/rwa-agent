import request from './request'

export const fetchEadRules = (side) => request.get('/ead-rules', { params: { side } })

export const fetchCcf = () => request.get('/ccf')
