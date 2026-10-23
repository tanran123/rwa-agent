import request from './request'

const codeOf = (code) => encodeURIComponent(code)

export const fetchProducts = () => request.get('/products')

export const createProduct = (body) => request.post('/products', body)

export const saveProduct = (code, body) => request.put('/products/' + codeOf(code), body)

export const deleteProduct = (code) => request.delete('/products/' + codeOf(code))

export const fetchProductFields = (code) => request.get('/products/' + codeOf(code) + '/fields')

export const createProductField = (code, body) => request.post('/products/' + codeOf(code) + '/fields', body)

export const saveProductField = (code, fieldCode, body) =>
  request.put('/products/' + codeOf(code) + '/fields/' + codeOf(fieldCode), body)

export const deleteProductField = (code, fieldCode) =>
  request.delete('/products/' + codeOf(code) + '/fields/' + codeOf(fieldCode))

export const fetchFieldMappings = (product = '') =>
  request.get('/field-mappings', { params: product ? { product } : {} })

export const createFieldMapping = (body) => request.post('/field-mappings', body)

export const saveFieldMapping = (id, body) => request.put('/field-mappings/' + encodeURIComponent(id), body)

export const deleteFieldMapping = (id) => request.delete('/field-mappings/' + encodeURIComponent(id))
