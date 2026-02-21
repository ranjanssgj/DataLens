import { useState, useEffect } from 'react'
import { getArtifacts, downloadArtifact, triggerDownload } from '../api'

function formatBytes(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0, s = bytes
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
    return `${s.toFixed(1)} ${units[i]}`
}

export default function ArtifactsPage() {
    const [artifacts, setArtifacts] = useState([])
    const [loading, setLoading] = useState(true)
    const [downloading, setDownloading] = useState(null)

    useEffect(() => {
        getArtifacts().then((res) => { setArtifacts(res.data); setLoading(false) })
    }, [])

    const handleDownload = async (artifact) => {
        setDownloading(artifact._id)
        try {
            const res = await downloadArtifact(artifact._id)
            triggerDownload(res.data, artifact.filename)
        } catch (err) {
            console.error(err)
        } finally {
            setDownloading(null)
        }
    }

    // Group by connectionName
    const grouped = artifacts.reduce((acc, a) => {
        const key = a.connectionName || 'Unknown'
        if (!acc[key]) acc[key] = []
        acc[key].push(a)
        return acc
    }, {})

    if (loading) return (
        <div className="page" style={{ textAlign: 'center', paddingTop: 120 }}>
            <span className="spinner" style={{ width: 40, height: 40 }} />
        </div>
    )

    return (
        <div className="page">
            <div className="mb-24">
                <h1 className="page-title">Artifacts</h1>
                <p>Previously exported JSON and Markdown data dictionaries, available for re-download.</p>
            </div>

            {artifacts.length === 0 ? (
                <div className="empty-state">
                    <div style={{ fontSize: '3rem', marginBottom: 12 }}>📄</div>
                    <h3>No exports yet</h3>
                    <p>Export a snapshot from the Dashboard to see files here.</p>
                </div>
            ) : (
                Object.entries(grouped).map(([connName, items]) => (
                    <div key={connName} className="section">
                        <div className="section-title">{connName}</div>
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Format</th>
                                        <th>Filename</th>
                                        <th>Size</th>
                                        <th>Created</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((artifact) => (
                                        <tr key={artifact._id}>
                                            <td>
                                                <span className={`badge ${artifact.format === 'json' ? 'badge-blue' : 'badge-purple'}`}>
                                                    {artifact.format.toUpperCase()}
                                                </span>
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                                                {artifact.filename}
                                            </td>
                                            <td style={{ color: 'var(--text-muted)' }}>{formatBytes(artifact.sizeBytes)}</td>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                                                {new Date(artifact.createdAt).toLocaleString()}
                                            </td>
                                            <td>
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => handleDownload(artifact)}
                                                    disabled={downloading === artifact._id}
                                                    id={`download-btn-${artifact._id}`}
                                                >
                                                    {downloading === artifact._id ? (
                                                        <span className="spinner" style={{ width: 12, height: 12 }} />
                                                    ) : (
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                            <polyline points="7 10 12 15 17 10" />
                                                            <line x1="12" y1="15" x2="12" y2="3" />
                                                        </svg>
                                                    )}
                                                    Download
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}
