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

export const fetchLiquidityConfigCheck = (jurisdiction, version) =>
  request.get('/liquidity/config-check', { params: params(jurisdiction, version) })
