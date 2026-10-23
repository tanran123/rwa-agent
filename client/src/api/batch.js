import request from './request'

export const fetchBatches = () => request.get('/batches')

export const fetchBatchLines = (id) => request.get('/batches/' + id + '/lines')

export const createBatch = (body) => request.post('/batches', body)

export const fetchBatch = (id) => request.get('/batches/' + id, { timeout: 60000 })

export const fetchMeasure = () => request.get('/measure', { timeout: 60000 })

export const saveMeasureRun = (body) => request.post('/measure/runs', body, { timeout: 60000 })

export const uploadWorkbook = (body) => request.post('/measure/workbook', body, { timeout: 120000 })

export const applyMeasureChoices = (body) => request.post('/measure/apply', body, { timeout: 120000 })

export const mapMeasureFields = (body) => request.post('/measure/map', body, { timeout: 180000 })

export const detectMeasureProducts = (body) => request.post('/measure/products', body, { timeout: 180000 })

export const classifyMeasure = (uploadId) => request.post('/measure/classify', { uploadId }, { timeout: 300000 })

export const fetchPaper = (offset = 0) => request.get('/working-paper', { params: { offset, limit: 80 }, timeout: 60000 })

export const fetchUploadSamples = () => request.get('/upload-samples')
