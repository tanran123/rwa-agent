import request from './request'

const params = (jurisdiction, version) => {
  const query = {}
  if (jurisdiction) query.jurisdiction = jurisdiction
  if (version) query.version = version
  return query
}

export const fetchLiquidityVersions = (jurisdiction = '') =>
  request.get('/liquidity/versions', { params: jurisdiction ? { jurisdiction } : {} })

export const fetchLiquidityMeta = (jurisdiction, version) =>
  request.get('/liquidity/meta', { params: params(jurisdiction, version) })

export const fetchLiquidityProducts = (jurisdiction, version) =>
  request.get('/liquidity/products', { params: params(jurisdiction, version) })

export const fetchLiquidityProduct = (code, jurisdiction, version) =>
  request.get('/liquidity/products/' + encodeURIComponent(code), { params: params(jurisdiction, version) })

export const createLiquidityProduct = (body) => request.post('/liquidity/products', body)

export const saveLiquidityProduct = (code, body) =>
  request.put('/liquidity/products/' + encodeURIComponent(code), body)

export const copyLiquidityProduct = (code, body) =>
  request.post('/liquidity/products/' + encodeURIComponent(code) + '/copy', body)

export const deleteLiquidityProduct = (code, jurisdiction, version) =>
  request.delete('/liquidity/products/' + encodeURIComponent(code), { params: params(jurisdiction, version) })

export const createLiquidityField = (code, body) =>
  request.post('/liquidity/products/' + encodeURIComponent(code) + '/fields', body)

export const saveLiquidityField = (code, fieldCode, body) =>
  request.put('/liquidity/products/' + encodeURIComponent(code) + '/fields/' + encodeURIComponent(fieldCode), body)

export const deleteLiquidityField = (code, fieldCode, jurisdiction, version) =>
  request.delete('/liquidity/products/' + encodeURIComponent(code) + '/fields/' + encodeURIComponent(fieldCode), {
    params: params(jurisdiction, version)
  })

export const fetchLiquidityRules = (jurisdiction, version) =>
  request.get('/liquidity/rules', { params: params(jurisdiction, version) })

export const fetchLiquidityParams = (jurisdiction, version) =>
  request.get('/liquidity/params', { params: params(jurisdiction, version) })

export const fetchLiquidityDictionaries = (jurisdiction, version, productCode = '') =>
  request.get('/liquidity/dictionaries', {
    params: { ...params(jurisdiction, version), ...(productCode ? { product_code: productCode } : {}) }
  })

export const saveLiquidityGroup = (code, groupCode, body) =>
  groupCode
    ? request.put('/liquidity/products/' + encodeURIComponent(code) + '/groups/' + encodeURIComponent(groupCode), body)
    : request.post('/liquidity/products/' + encodeURIComponent(code) + '/groups', body)

export const deleteLiquidityGroup = (code, groupCode, jurisdiction, version) =>
  request.delete('/liquidity/products/' + encodeURIComponent(code) + '/groups/' + encodeURIComponent(groupCode), {
    params: params(jurisdiction, version)
  })

export const validateLiquidityGroups = (code, jurisdiction, version) =>
  request.post('/liquidity/products/' + encodeURIComponent(code) + '/groups/validate', params(jurisdiction, version))

export const saveLiquidityFieldGroup = (code, groupCode, body) =>
  groupCode
    ? request.put('/liquidity/products/' + encodeURIComponent(code) + '/field-groups/' + encodeURIComponent(groupCode), body)
    : request.post('/liquidity/products/' + encodeURIComponent(code) + '/field-groups', body)

export const deleteLiquidityFieldGroup = (code, groupCode, jurisdiction, version) =>
  request.delete('/liquidity/products/' + encodeURIComponent(code) + '/field-groups/' + encodeURIComponent(groupCode), {
    params: params(jurisdiction, version)
  })

export const saveLiquidityDictionary = (body) =>
  body.originalCode
    ? request.put('/liquidity/dictionaries/' + encodeURIComponent(body.originalCode), body)
    : request.post('/liquidity/dictionaries', body)

export const deleteLiquidityDictionary = (dictCode, jurisdiction, version) =>
  request.delete('/liquidity/dictionaries/' + encodeURIComponent(dictCode), { params: params(jurisdiction, version) })

export const saveLiquidityDictionaryItem = (dictCode, itemCode, body) =>
  itemCode
    ? request.put('/liquidity/dictionaries/' + encodeURIComponent(dictCode) + '/items/' + encodeURIComponent(itemCode), body)
    : request.post('/liquidity/dictionaries/' + encodeURIComponent(dictCode) + '/items', body)

export const deleteLiquidityDictionaryItem = (dictCode, itemCode, jurisdiction, version, productCode = '') =>
  request.delete('/liquidity/dictionaries/' + encodeURIComponent(dictCode) + '/items/' + encodeURIComponent(itemCode), {
    params: { ...params(jurisdiction, version), ...(productCode ? { product_code: productCode } : {}) }
  })

export const saveLiquidityRuleScope = (code, body) =>
  request.post('/liquidity/products/' + encodeURIComponent(code) + '/rule-scopes', body)

export const deleteLiquidityRuleScope = (code, id, jurisdiction, version) =>
  request.delete('/liquidity/products/' + encodeURIComponent(code) + '/rule-scopes/' + encodeURIComponent(id), {
    params: params(jurisdiction, version)
  })
