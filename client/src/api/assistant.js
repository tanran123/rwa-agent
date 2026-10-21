import request from './request'

export const fetchAssistant = () => request.get('/assistant')

export const sendRuleChat = (messages) => request.post('/rules/chat', { messages }, { timeout: 60000 })
