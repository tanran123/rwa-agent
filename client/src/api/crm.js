import request from './request'

// 信用风险缓释配置。产品清单和可选源表列都由接口从 product_type / product_field 读出。
// 注意：/crm 的缓释规则列表在 api/exposure.js 的 fetchCrm，不是这里。
export const fetchCrmConfig = () => request.get('/crm-config', { timeout: 20000 })

export const saveCrmConfig = (config) => request.put('/crm-config', { config }, { timeout: 20000 })
