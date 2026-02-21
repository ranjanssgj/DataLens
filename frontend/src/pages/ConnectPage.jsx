import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { createConnection, getConnections, deleteConnection, syncConnection, getDocStatus } from '../api'
import QualityBadge from '../components/QualityBadge'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const DB_TYPES = [
    { value: 'postgres', label: 'PostgreSQL', port: '5432' },
    { value: 'mysql', label: 'MySQL', port: '3306' },
    { value: 'mssql', label: 'SQL Server', port: '1433' },
    { value: 'snowflake', label: 'Snowflake', port: '' },
]

const DEFAULT_FORM = {
    name: '', type: 'postgres', host: '', port: '5432',
    database: '', username: '', password: '',
    account: '', warehouse: '', schema: '',
}

export default function ConnectPage({ setCurrentSnapshotId }) {
    const navigate = useNavigate()
    const [form, setForm] = useState(DEFAULT_FORM)
    const [connections, setConnections] = useState([])
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [syncPhase, setSyncPhase] = useState('')
    const [syncProgress, setSyncProgress] = useState(null)
    const [error, setError] = useState(null)
    const [syncingId, setSyncingId] = useState(null)
    const [perConnSyncProgress, setPerConnSyncProgress] = useState({})
    const [showForm, setShowForm] = useState(false)
    const [latestSnapshotMap, setLatestSnapshotMap] = useState({})

    useEffect(() => {
        loadConnections()
    }, [])

    const loadConnections = async () => {
        try {
            const res = await getConnections()
            setConnections(res.data)

            // Fetch latest snapshotId per connection for the 'View Dashboard' buttons
            const map = {}
            await Promise.all(res.data.map(async (conn) => {
                try {
                    const sr = await axios.get(`${API_BASE}/api/connections/${conn._id}/sync-status`)
                    if (sr.data.latestSnapshotId) map[conn._id] = sr.data.latestSnapshotId
                } catch (e) { }
            }))
            setLatestSnapshotMap(map)
        } catch (e) { }
        setLoading(false)
    }

    const handleTypeChange = (type) => {
        const dt = DB_TYPES.find((d) => d.value === type)
        setForm((f) => ({ ...f, type, port: dt?.port || '' }))
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)
        setSyncing(true)
        setSyncPhase('Saving connection…')

        try {
            const connRes = await createConnection(form)
            const connId = connRes.data._id
            await loadConnections()
            await runSync(connId)
        } catch (err) {
            setError(err.response?.data?.error || err.message)
            setSyncing(false)
            setSyncPhase('')
        }
    }

    const runSync = async (connId) => {
        try {
            setSyncPhase('Extracting schema…')
            const res = await syncConnection(connId)
            const snapshotId = res.data.snapshotId
            if (setCurrentSnapshotId) setCurrentSnapshotId(snapshotId)

            setSyncPhase('Analyzing data quality…')
            await pollDocStatus(snapshotId)
            navigate(`/dashboard/${snapshotId}`)
        } catch (err) {
            setError(err.response?.data?.error || err.message)
        } finally {
            setSyncing(false)
            setSyncPhase('')
            setSyncProgress(null)
        }
    }

    const pollDocStatus = async (snapshotId) => {
        return new Promise((resolve) => {
            const interval = setInterval(async () => {
                try {
                    const res = await getDocStatus(snapshotId)
                    const { status, progress, total, currentTable } = res.data
                    if (total > 0) {
                        setSyncPhase(
                            status === 'complete'
                                ? `✓ AI docs generated for ${total} tables`
                                : `Generating AI docs… ${currentTable ? `(${currentTable} — ${progress}/${total})` : `${progress}/${total}`}`
                        )
                        setSyncProgress(total > 0 ? (progress / total) * 100 : 0)
                    }
                    if (status === 'complete' || status === 'failed') {
                        clearInterval(interval)
                        resolve()
                    }
                } catch (e) {
                    clearInterval(interval)
                    resolve()
                }
            }, 3000)
        })
    }

    const handleSync = async (connectionId) => {
        setSyncingId(connectionId)
        setPerConnSyncProgress(prev => ({ ...prev, [connectionId]: { stage: 'Extracting schema...', pct: 10 } }))

        try {
            const syncRes = await axios.post(`${API_BASE}/api/connections/${connectionId}/sync`)
            const { snapshotId } = syncRes.data

            setPerConnSyncProgress(prev => ({ ...prev, [connectionId]: { stage: 'Analyzing quality...', pct: 40 } }))

            const poll = setInterval(async () => {
                try {
                    const statusRes = await axios.get(`${API_BASE}/api/snapshots/${snapshotId}/doc-status`)
                    const { status, progress, total, currentTable } = statusRes.data

                    if (status === 'running') {
                        const pct = total > 0 ? Math.round(60 + (progress / total) * 35) : 60
                        setPerConnSyncProgress(prev => ({
                            ...prev,
                            [connectionId]: { stage: `Generating AI docs (${progress}/${total}): ${currentTable || ''}`, pct }
                        }))
                    } else if (status === 'complete') {
                        clearInterval(poll)
                        setPerConnSyncProgress(prev => ({ ...prev, [connectionId]: { stage: 'Complete!', pct: 100 } }))
                        setSyncingId(null)
                        setTimeout(() => navigate(`/dashboard/${snapshotId}`), 1000)
                    } else if (status === 'failed') {
                        clearInterval(poll)
                        setPerConnSyncProgress(prev => ({ ...prev, [connectionId]: { stage: 'Failed — check logs', pct: 0 } }))
                        setSyncingId(null)
                    }
                } catch (e) {
                    clearInterval(poll)
                    setSyncingId(null)
                }
            }, 3000)

        } catch (err) {
            setSyncingId(null)
            setPerConnSyncProgress(prev => ({ ...prev, [connectionId]: { stage: 'Sync failed', pct: 0 } }))
        }
    }

    const handleDelete = async (id, e) => {
        e.stopPropagation()
        if (!confirm('Delete this connection and all its snapshots?')) return
        await deleteConnection(id)
        loadConnections()
    }

    const isSnowflake = form.type === 'snowflake'

    if (loading) return (
        <div className="page" style={{ textAlign: 'center', paddingTop: 120 }}>
            <span className="spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
            <p style={{ marginTop: 20, color: 'var(--text-muted)' }}>Checking existing connections…</p>
        </div>
    )

    return (
        <div className="page" style={{ maxWidth: 920 }}>
            <div className="mb-24" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 className="page-title">Connect Database</h1>
                    <p>Add a new database connection to generate AI-powered documentation and quality analysis.</p>
                </div>
                {connections.length > 0 && (
                    <button className="btn btn-primary" onClick={() => setShowForm(f => !f)}>
                        {showForm ? 'Hide Form' : '+ Add New Connection'}
                    </button>
                )}
            </div>

            {(showForm || connections.length === 0) && (
                !syncing ? (
                    <form onSubmit={handleSubmit} id="connect-form">
                        <div className="card" style={{ marginBottom: 24 }}>
                            <h3 style={{ marginBottom: 20 }}>Database Connection</h3>

                            <div className="form-grid">
                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                    <label className="form-label">Connection Name</label>
                                    <input
                                        className="form-input"
                                        placeholder="e.g. Production PostgreSQL"
                                        value={form.name}
                                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                        required
                                        id="conn-name"
                                    />
                                </div>

                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                    <label className="form-label">Database Type</label>
                                    <select
                                        className="form-select"
                                        value={form.type}
                                        onChange={(e) => handleTypeChange(e.target.value)}
                                        id="conn-type"
                                    >
                                        {DB_TYPES.map((d) => (
                                            <option key={d.value} value={d.value}>{d.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {!isSnowflake && (
                                    <>
                                        <div className="form-group">
                                            <label className="form-label">Host</label>
                                            <input className="form-input" placeholder="localhost" value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} required id="conn-host" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Port</label>
                                            <input className="form-input" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} required id="conn-port" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Database</label>
                                            <input className="form-input" placeholder="mydb" value={form.database} onChange={(e) => setForm((f) => ({ ...f, database: e.target.value }))} required id="conn-database" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Username</label>
                                            <input className="form-input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required id="conn-username" />
                                        </div>
                                    </>
                                )}

                                {isSnowflake && (
                                    <>
                                        <div className="form-group">
                                            <label className="form-label">Account</label>
                                            <input className="form-input" placeholder="xy12345.us-east-1" value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} required id="conn-account" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Warehouse</label>
                                            <input className="form-input" placeholder="COMPUTE_WH" value={form.warehouse} onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))} required id="conn-warehouse" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Database</label>
                                            <input className="form-input" value={form.database} onChange={(e) => setForm((f) => ({ ...f, database: e.target.value }))} required id="conn-database" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Schema</label>
                                            <input className="form-input" placeholder="PUBLIC" value={form.schema} onChange={(e) => setForm((f) => ({ ...f, schema: e.target.value }))} id="conn-schema" />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Username</label>
                                            <input className="form-input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required id="conn-username" />
                                        </div>
                                    </>
                                )}

                                <div className="form-group" style={isSnowflake ? {} : { gridColumn: '2' }}>
                                    <label className="form-label">Password</label>
                                    <input className="form-input" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} id="conn-password" />
                                </div>
                            </div>

                            {error && (
                                <div style={{ background: 'var(--red-bg)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: '0.875rem', marginTop: 12 }}>
                                    {error}
                                </div>
                            )}

                            <div style={{ marginTop: 20 }}>
                                <button type="submit" className="btn btn-primary" id="connect-submit-btn">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M5 12h14M12 5l7 7-7 7" />
                                    </svg>
                                    Connect &amp; Analyze
                                </button>
                            </div>
                        </div>
                    </form>
                ) : (
                    <div className="sync-progress-overlay">
                        <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
                        <div className="sync-progress-step">{syncPhase}</div>
                        {syncProgress !== null && (
                            <div className="sync-progress-bar" style={{ margin: '16px auto 0', maxWidth: 320 }}>
                                <div className="sync-progress-bar-fill" style={{ width: `${syncProgress}%` }} />
                            </div>
                        )}
                    </div>
                )
            )}

            {/* Saved Connections */}
            {connections.length > 0 && (
                <div className="section">
                    <div className="section-title">Saved Connections</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {connections.map((conn) => (
                            <div key={conn._id} className="card">
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{conn.name}</div>
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                            {conn.type.toUpperCase()} · {conn.host || conn.account}:{conn.port} · {conn.database}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                            Last sync: {conn.lastSyncedAt ? new Date(conn.lastSyncedAt).toLocaleString() : 'Never'}
                                        </div>
                                    </div>
                                    <div className="flex gap-8">
                                        {latestSnapshotMap[conn._id] && (
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => navigate(`/dashboard/${latestSnapshotMap[conn._id]}`)}
                                                id={`dashboard-btn-${conn._id}`}
                                            >
                                                View Dashboard
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleSync(conn._id)}
                                            disabled={syncingId === conn._id}
                                            id={`sync-btn-${conn._id}`}
                                        >
                                            {syncingId === conn._id ? 'Syncing…' : 'Sync Now'}
                                        </button>
                                        <button
                                            className="btn btn-danger btn-sm"
                                            onClick={(e) => handleDelete(conn._id, e)}
                                            id={`delete-btn-${conn._id}`}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>

                                {/* Per-connection sync progress */}
                                {syncingId === conn._id && (
                                    <div style={{ marginTop: 12 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ color: '#94a3b8', fontSize: 12 }}>
                                                {perConnSyncProgress[conn._id]?.stage || 'Starting...'}
                                            </span>
                                            <span style={{ color: '#6366f1', fontSize: 12 }}>
                                                {perConnSyncProgress[conn._id]?.pct || 0}%
                                            </span>
                                        </div>
                                        <div style={{ height: 4, background: '#1e293b', borderRadius: 2 }}>
                                            <div style={{
                                                height: '100%',
                                                width: `${perConnSyncProgress[conn._id]?.pct || 0}%`,
                                                background: '#6366f1',
                                                borderRadius: 2,
                                                transition: 'width 0.5s ease'
                                            }} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
