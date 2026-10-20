import request from './request'

export const fetchRuleVersions = (jurisdiction = '') =>
  request.get('/rule-versions', { params: { jurisdiction } })

export const fetchClauses = ({ jurisdiction = '', q = '' } = {}) =>
  request.get('/clauses', { params: { jurisdiction, q } })

export const fetchParams = () => request.get('/params')

export const saveParam = (id, value) => request.put('/params/' + id, { value })
