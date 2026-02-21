import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSnapshot } from '../api'
import QualityBadge from '../components/QualityBadge'
import ExportButtons from '../components/ExportButtons'

function formatNum(n) {
    if (n === undefined || n === null) return 'N/A'
    return Number(n).toLocaleString()
}

function formatBytes(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0, s = bytes
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
    return `${s.toFixed(1)} ${units[i]}`
}

export default function DashboardPage() {
    const { snapshotId } = useParams()
    const navigate = useNavigate()
    const [snapshot, setSnapshot] = useState(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    useEffect(() => {
        getSnapshot(snapshotId).then((res) => {
            setSnapshot(res.data)
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [snapshotId])

    if (loading) return (
        <div className="page" style={{ textAlign: 'center', paddingTop: 120 }}>
            <span className="spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
            <p style={{ marginTop: 20 }}>Loading snapshot…</p>
        </div>
    )

    if (!snapshot) return (
        <div className="page empty-state">
            <h3>Snapshot not found</h3>
            <p>Return to connections and run a sync.</p>
        </div>
    )

    const avgQuality = snapshot.tables.length > 0
        ? Math.round(snapshot.tables.reduce((s, t) => s + (t.qualityScore || 0), 0) / snapshot.tables.length)
        : 0

    const filtered = snapshot.tables.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase())
    )

    return (
        <div className="page">
            {/* Header */}
            <div className="flex-between mb-24">
                <div>
                    <h1 className="page-title">{snapshot.connectionName}</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
                        <span className="badge badge-purple">{snapshot.dbType?.toUpperCase()}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            {snapshot.databaseName}
                        </span>
                        {snapshot.extractedAt && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                                Synced {new Date(snapshot.extractedAt).toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>
                <ExportButtons snapshotId={snapshotId} />
            </div>

            {/* Stats */}
            <div className="stats-row">
                <div className="stat-item">
                    <span className="stat-label">Tables</span>
                    <span className="stat-value">{snapshot.tableCount}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Total Rows</span>
                    <span className="stat-value">{formatNum(snapshot.totalRows)}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Avg Quality</span>
                    <span className="stat-value" style={{ color: avgQuality >= 80 ? 'var(--green)' : avgQuality >= 60 ? 'var(--yellow)' : 'var(--red)' }}>
                        {avgQuality}%
                    </span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">AI Docs</span>
                    <span className="stat-value" style={{ fontSize: '1rem', color: snapshot.aiGeneratedAt ? 'var(--green)' : 'var(--yellow)' }}>
                        {snapshot.aiGeneratedAt ? '● Complete' : '● Generating…'}
                    </span>
                </div>
            </div>

            {/* Search */}
            <div style={{ marginBottom: 20 }}>
                <input
                    className="form-input"
                    placeholder="Search tables…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ maxWidth: 320 }}
                    id="table-search"
                />
            </div>

            {/* Table Cards Grid */}
            <div className="grid-3">
                {filtered.map((table) => (
                    <div
                        key={table.name}
                        className="card card-clickable"
                        onClick={() => navigate(`/table/${snapshotId}/${encodeURIComponent(table.name)}`)}
                        id={`table-card-${table.name}`}
                        style={{
                            borderLeft: `3px solid ${(table.qualityScore ?? 0) >= 80 ? 'var(--green)' :
                                    (table.qualityScore ?? 0) >= 60 ? 'var(--yellow)' : 'var(--red)'
                                }`
                        }}
                    >
                        <div className="flex-between mb-8">
                            <h4 style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
                                {table.name}
                            </h4>
                            <QualityBadge score={table.qualityScore} size="sm" />
                        </div>

                        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {formatNum(table.rowCount)} rows
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {table.columns?.length || 0} cols
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {formatBytes(table.sizeBytes)}
                            </span>
                        </div>

                        {table.aiSummary ? (
                            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                {table.aiSummary.split('. ').slice(0, 2).join('. ')}.
                            </p>
                        ) : (
                            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                AI docs generating…
                            </p>
                        )}

                        {table.qualityFlags?.length > 0 && (
                            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {table.qualityFlags.slice(0, 2).map((f, i) => (
                                    <span key={i} className="flag-chip" style={{ fontSize: '0.65rem' }}>⚠ {f.substring(0, 40)}{f.length > 40 ? '…' : ''}</span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {filtered.length === 0 && (
                <div className="empty-state">
                    <h3>No tables match "{search}"</h3>
                </div>
            )}
        </div>
    )
}
