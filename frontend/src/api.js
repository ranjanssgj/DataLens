import axios from 'axios'

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 300000, // 5 minutes — needed for long sync operations
})

export const createConnection = (data) => api.post('/api/connections', data)
export const getConnections = () => api.get('/api/connections')
export const deleteConnection = (id) => api.delete(`/api/connections/${id}`)

export const syncConnection = (id) => api.post(`/api/connections/${id}/sync`)
export const getDocStatus = (snapshotId) => api.get(`/api/snapshots/${snapshotId}/doc-status`)
export const getSyncStatus = (connId) => api.get(`/api/connections/${connId}/sync-status`)

export const getSnapshots = (connId) => api.get(`/api/connections/${connId}/snapshots`)
export const getSnapshot = (id) => api.get(`/api/snapshots/${id}`)

export const exportJson = (snapshotId) =>
    api.get(`/api/snapshots/${snapshotId}/export/json`, { responseType: 'blob' })
export const exportMarkdown = (snapshotId) =>
    api.get(`/api/snapshots/${snapshotId}/export/markdown`, { responseType: 'blob' })
export const getArtifacts = () => api.get('/api/artifacts')
export const downloadArtifact = (id) =>
    api.get(`/api/artifacts/${id}/download`, { responseType: 'blob' })

export const sendChat = (snapshotId, question, sessionId) =>
    api.post(`/api/snapshots/${snapshotId}/chat`, { question, sessionId })

export function triggerDownload(blob, filename) {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
}
