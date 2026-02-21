import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getSnapshot } from '../api'
import QualityBadge from '../components/QualityBadge'

export default function QualityPage() {
    const { snapshotId } = useParams()
    const [snapshot, setSnapshot] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getSnapshot(snapshotId).then((res) => { setSnapshot(res.data); setLoading(false) })
    }, [snapshotId])

    if (loading) return (
        <div className="page" style={{ textAlign: 'center', paddingTop: 120 }}>
            <span className="spinner" style={{ width: 40, height: 40 }} />
        </div>
    )

    if (!snapshot) return <div className="page empty-state"><h3>Not found</h3></div>

    const sorted = [...snapshot.tables].sort((a, b) => (a.qualityScore ?? 100) - (b.qualityScore ?? 100))
    const avg = sorted.length ? Math.round(sorted.reduce((s, t) => s + (t.qualityScore ?? 0), 0) / sorted.length) : 0
    const lowCount = sorted.filter((t) => (t.qualityScore ?? 0) < 60).length

    return (
        <div className="page">
            <div className="mb-24">
                <h1 className="page-title">Data Quality</h1>
                <p>{snapshot.connectionName} — tables sorted by quality score (worst first)</p>
            </div>

            {/* Summary */}
            <div className="stats-row mb-24">
                <div className="stat-item">
                    <span className="stat-label">Avg Quality</span>
                    <span className="stat-value" style={{ color: avg >= 80 ? 'var(--green)' : avg >= 60 ? 'var(--yellow)' : 'var(--red)' }}>
                        {avg}/100
                    </span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Tables Below 60</span>
                    <span className="stat-value" style={{ color: lowCount > 0 ? 'var(--red)' : 'var(--green)' }}>
                        {lowCount}
                    </span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Total Tables</span>
                    <span className="stat-value">{sorted.length}</span>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {sorted.map((table) => {
                    const score = table.qualityScore ?? 0
                    const borderColor = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : 'var(--red)'
                    const colsWithQuality = (table.columns || []).filter((c) => c.quality?.completeness !== undefined)

                    return (
                        <div
                            key={table.name}
                            className="card"
                            id={`quality-card-${table.name}`}
                            style={{ borderLeft: `4px solid ${borderColor}` }}
                        >
                            <div className="flex-between mb-12">
                                <div>
                                    <h4 style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: 4 }}>
                                        {table.name}
                                    </h4>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                        {Number(table.rowCount || 0).toLocaleString()} rows · {table.columns?.length} columns
                                    </div>
                                </div>
                                <QualityBadge score={table.qualityScore} />
                            </div>

                            {/* Quality flags */}
                            {table.qualityFlags?.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
                                    {table.qualityFlags.map((f, i) => (
                                        <span key={i} className="flag-chip">⚠ {f}</span>
                                    ))}
                                </div>
                            )}

                            {/* Column completeness bars */}
                            {colsWithQuality.length > 0 && (
                                <div>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>
                                        Column Completeness
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px 16px' }}>
                                        {colsWithQuality.slice(0, 12).map((col) => (
                                            <div key={col.name}>
                                                <div className="flex-between" style={{ marginBottom: 3 }}>
                                                    <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                                        {col.name}
                                                    </span>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                        {(col.quality.completeness ?? 0).toFixed(0)}%
                                                    </span>
                                                </div>
                                                <div className="progress-bar-track" style={{ height: 4 }}>
                                                    <div className="progress-bar-fill" style={{
                                                        width: `${col.quality.completeness ?? 0}%`,
                                                        background: col.quality.completeness >= 80 ? 'var(--green)' : col.quality.completeness >= 60 ? 'var(--yellow)' : 'var(--red)'
                                                    }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Numeric stats summary */}
                                    {(table.columns || []).filter((c) => c.quality?.avg !== undefined).length > 0 && (
                                        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                                            {(table.columns || []).filter((c) => c.quality?.avg !== undefined).slice(0, 4).map((col) => (
                                                <div key={col.name} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-base)', borderRadius: 6, padding: '6px 10px' }}>
                                                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{col.name}</span>&nbsp;
                                                    avg:{Number(col.quality.avg).toFixed(1)} · p50:{Number(col.quality.p50 ?? 0).toFixed(1)}
                                                    {col.quality.outlierCount > 0 && (
                                                        <span style={{ color: 'var(--yellow)' }}> · {col.quality.outlierCount} outliers</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
