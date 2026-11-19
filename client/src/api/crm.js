import request from './request'

const params = (meta = {}) => ({
  version: meta.version || '',
  jurisdiction: meta.jurisdiction || ''
})

// 信用风险缓释配置。产品清单和可选源表列由接口从产品标准字段配置的产品注册读出。
// 注意：/crm 的缓释规则列表在 api/exposure.js 的 fetchCrm，不是这里。
export const fetchCrmConfig = (meta = {}) => request.get('/crm-config', { params: params(meta), timeout: 20000 })

export const saveCrmConfig = (config, meta = {}) =>
  request.put('/crm-config', { config: { ...config, version: (meta.version || config.version || '') }, ...params(meta) }, { timeout: 20000 })
