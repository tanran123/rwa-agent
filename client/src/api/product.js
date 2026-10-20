import request from './request'

export const fetchProducts = () => request.get('/products')

export const fetchProductFields = (code) => request.get('/products/' + code + '/fields')

export const fetchFieldMappings = (product = '') =>
  request.get('/field-mappings', { params: product ? { product } : {} })
