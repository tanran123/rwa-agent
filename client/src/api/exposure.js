import request from './request'

export const fetchExposureClass = () => request.get('/exposure-class')

export const fetchWeights = () => request.get('/weights')

export const fetchCrm = () => request.get('/crm')

export const fetchProductRules = (product = '') =>
  request.get('/product-rules', { params: product ? { product } : {} })
