import request from './request'

export const fetchExposureClasses = () => request.get('/exposure-classes')

export const fetchExposureClass = (name = '') =>
  request.get('/exposure-class', { params: name ? { name } : {} })

export const fetchWeights = () => request.get('/weights')

export const fetchCrm = () => request.get('/crm')

export const fetchProductRules = (product = '') =>
  request.get('/product-rules', { params: product ? { product } : {} })

export const proposeExposureTree = (name, messages) =>
  request.post('/exposure-tree/propose', { name, messages }, { timeout: 120000 })

export const saveExposureTree = (body) => request.post('/exposure-tree/save', body)

export const copyExposureTree = (label) => request.post('/exposure-tree/copy', { label })

export const fetchExposureChat = (name = '') =>
  request.get('/exposure-tree/chat', { params: name ? { name } : {} })

export const saveExposureChat = (name, messages, draft) =>
  request.post('/exposure-tree/chat', { name, messages, draft })
