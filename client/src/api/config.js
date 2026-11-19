import request from './request'

const codeOf = (id) => encodeURIComponent(id)

export const fetchRuleDocuments = (params = {}) => request.get('/rule-documents', { params })

export const fetchRuleDocument = (id) => request.get('/rule-documents/' + codeOf(id))

export const createRuleDocument = (body) => request.post('/rule-documents', body)

export const saveRuleDocument = (id, body) => request.put('/rule-documents/' + codeOf(id), body)

export const deleteRuleDocument = (id) => request.delete('/rule-documents/' + codeOf(id))

export const validateRuleDocument = (id) => request.post('/rule-documents/' + codeOf(id) + '/validate')

export const validateRuleBody = (body) => request.post('/rule-documents/validate', body)

export const importRuleDocuments = (body) => request.post('/rule-documents/import', body, { timeout: 180000 })

export const fetchParameterTables = (jurisdiction = '') =>
  request.get('/parameter-tables', { params: jurisdiction ? { jurisdiction } : {} })

export const fetchParameterTable = (id) => request.get('/parameter-tables/' + codeOf(id))

export const saveParameterTable = (id, body) => request.put('/parameter-tables/' + codeOf(id), body)

export const fetchReferenceLists = (jurisdiction = '') =>
  request.get('/reference-lists', { params: jurisdiction ? { jurisdiction } : {} })

export const fetchReferenceList = (id) => request.get('/reference-lists/' + codeOf(id))

export const saveReferenceList = (id, body) => request.put('/reference-lists/' + codeOf(id), body)
