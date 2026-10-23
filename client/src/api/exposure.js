import request from './request'

export const fetchExposureClasses = () => request.get('/exposure-classes')

export const fetchExposureClass = (name = '') =>
  request.get('/exposure-class', { params: name ? { name } : {} })

export const fetchWeights = () => request.get('/weights')

export const createWeightRule = (body) => request.post('/weight-rules', body)

export const saveWeightRule = (id, body) => request.put('/weight-rules/' + encodeURIComponent(id), body)

export const deleteWeightRule = (id) => request.delete('/weight-rules/' + encodeURIComponent(id))

export const deleteWeightRules = (ids) => request.post('/weight-rules/batch-delete', { ids })

export const createBankGrade = (body) => request.post('/bank-grades', body)

export const saveBankGrade = (id, body) => request.put('/bank-grades/' + encodeURIComponent(id), body)

export const deleteBankGrade = (id) => request.delete('/bank-grades/' + encodeURIComponent(id))

export const deleteBankGrades = (ids) => request.post('/bank-grades/batch-delete', { ids })

export const createMoWeight = (body) => request.post('/mo-weights', body)

export const saveMoWeight = (id, body) => request.put('/mo-weights/' + encodeURIComponent(id), body)

export const deleteMoWeight = (id) => request.delete('/mo-weights/' + encodeURIComponent(id))

export const deleteMoWeights = (ids) => request.post('/mo-weights/batch-delete', { ids })

export const fetchCrm = () => request.get('/crm')

export const createCrmRule = (body) => request.post('/crm', body)

export const saveCrmRule = (id, body) => request.put('/crm/' + encodeURIComponent(id), body)

export const deleteCrmRule = (id) => request.delete('/crm/' + encodeURIComponent(id))

export const deleteCrmRules = (ids) => request.post('/crm/batch-delete', { ids })

export const fetchProductRules = (product = '') =>
  request.get('/product-rules', { params: product ? { product } : {} })

export const createProductRule = (body) => request.post('/product-rules', body)

export const saveProductRule = (id, body) => request.put('/product-rules/' + encodeURIComponent(id), body)

export const deleteProductRule = (id) => request.delete('/product-rules/' + encodeURIComponent(id))

export const deleteProductRules = (ids) => request.post('/product-rules/batch-delete', { ids })

export const proposeExposureTree = (name, messages) =>
  request.post('/exposure-tree/propose', { name, messages }, { timeout: 120000 })

export const saveExposureTree = (body) => request.post('/exposure-tree/save', body)

export const copyExposureTree = (label) => request.post('/exposure-tree/copy', { label })

export const deleteExposureTree = (name) => request.post('/exposure-tree/delete', { name })

export const fetchExposureChat = (name = '') =>
  request.get('/exposure-tree/chat', { params: name ? { name } : {} })

export const saveExposureChat = (name, messages, draft) =>
  request.post('/exposure-tree/chat', { name, messages, draft })
