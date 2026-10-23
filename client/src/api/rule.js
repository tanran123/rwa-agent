import request from './request'

export const fetchRuleVersions = (jurisdiction = '') =>
  request.get('/rule-versions', { params: { jurisdiction } })

export const createRuleVersion = (body) => request.post('/rule-versions', body)

export const saveRuleVersion = (id, body) => request.put('/rule-versions/' + encodeURIComponent(id), body)

export const deleteRuleVersion = (id) => request.delete('/rule-versions/' + encodeURIComponent(id))

export const deleteRuleVersions = (ids) => request.post('/rule-versions/batch-delete', { ids })

export const fetchClauses = ({ jurisdiction = '', q = '' } = {}) =>
  request.get('/clauses', { params: { jurisdiction, q } })

export const createClause = (body) => request.post('/clauses', body)

export const saveClause = (id, body) => request.put('/clauses/' + encodeURIComponent(id), body)

export const deleteClause = (id) => request.delete('/clauses/' + encodeURIComponent(id))

export const deleteClauses = (ids) => request.post('/clauses/batch-delete', { ids })

export const fetchParams = () => request.get('/params')

export const createParam = (body) => request.post('/params', body)

export const saveParam = (id, body) => request.put('/params/' + encodeURIComponent(id), body)

export const deleteParam = (id) => request.delete('/params/' + encodeURIComponent(id))

export const deleteParams = (ids) => request.post('/params/batch-delete', { ids })
