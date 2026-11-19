import request from './request'

export const fetchOrgs = (jurisdiction = '') =>
  request.get('/orgs', { params: { jurisdiction } })

export const createOrg = (body) => request.post('/orgs', body)

export const saveOrg = (id, body) => request.put('/orgs/' + encodeURIComponent(id), body)

export const deleteOrg = (id) => request.delete('/orgs/' + encodeURIComponent(id))

export const deleteOrgs = (ids) => request.post('/orgs/batch-delete', { ids })

export const fetchRuleVersions = (jurisdiction = '') =>
  request.get('/rule-versions', { params: { jurisdiction } })

export const createRuleVersion = (body) => request.post('/rule-versions', body)

export const saveRuleVersion = (id, body) => request.put('/rule-versions/' + encodeURIComponent(id), body)

export const deleteRuleVersion = (id) => request.delete('/rule-versions/' + encodeURIComponent(id))

export const deleteRuleVersions = (ids) => request.post('/rule-versions/batch-delete', { ids })

export const fetchClauses = ({ jurisdiction = '', q = '', version = '' } = {}) =>
  request.get('/clauses', { params: { jurisdiction, q, version } })

export const createClause = (body) => request.post('/clauses', body)

export const saveClause = (id, body) => request.put('/clauses/' + encodeURIComponent(id), body)

export const deleteClause = (id) => request.delete('/clauses/' + encodeURIComponent(id))

export const deleteClauses = (ids) => request.post('/clauses/batch-delete', { ids })

export const fetchRuleVersionOverview = (id) => request.get('/rule-versions/' + encodeURIComponent(id) + '/overview')

export const validateRuleVersion = (id) => request.post('/rule-versions/' + encodeURIComponent(id) + '/validate')

export const submitRuleVersionReview = (id) => request.post('/rule-versions/' + encodeURIComponent(id) + '/submit-review')

export const publishRuleVersion = (id) => request.post('/rule-versions/' + encodeURIComponent(id) + '/publish')

export const cloneRuleVersion = (id, body) => request.post('/rule-versions/' + encodeURIComponent(id) + '/clone', body)

export const fetchRuleVersionDiff = (id, sourceId) => request.get('/rule-versions/' + encodeURIComponent(id) + '/diff/' + encodeURIComponent(sourceId))

export const fetchRuleVersionRevisions = (id, limit = 100) => request.get('/rule-versions/' + encodeURIComponent(id) + '/revisions', { params: { limit } })

export const createRuleSnapshot = (id) => request.post('/rule-versions/' + encodeURIComponent(id) + '/snapshot')

export const fetchRuleSnapshot = (id, items = true) => request.get('/rule-snapshots/' + encodeURIComponent(id), { params: { items: items ? 1 : 0 } })

export const compareRuleSnapshots = (id, otherId) => request.get('/rule-snapshots/' + encodeURIComponent(id) + '/compare/' + encodeURIComponent(otherId))

export const rollbackRuleSnapshot = (id) => request.post('/rule-snapshots/' + encodeURIComponent(id) + '/rollback')

export const fetchClauseImpact = (id) => request.get('/clauses/' + encodeURIComponent(id) + '/impact')

export const fetchClauseRelations = (id) => request.get('/clauses/' + encodeURIComponent(id) + '/relations')

export const saveClauseRelations = (id, relations) => request.put('/clauses/' + encodeURIComponent(id) + '/relations', { relations })
