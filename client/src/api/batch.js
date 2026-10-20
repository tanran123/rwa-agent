import request from './request'

export const fetchBatches = () => request.get('/batches')

export const fetchBatchLines = (id) => request.get('/batches/' + id + '/lines')

export const createBatch = (body) => request.post('/batches', body)

export const fetchMeasure = () => request.get('/measure', { timeout: 60000 })

export const fetchPaper = (offset = 0) => request.get('/working-paper', { params: { offset, limit: 80 }, timeout: 60000 })

export const fetchUploadSamples = () => request.get('/upload-samples')
