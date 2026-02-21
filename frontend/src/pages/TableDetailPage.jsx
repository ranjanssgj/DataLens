import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import { getSnapshot } from '../api'
import QualityBadge from '../components/QualityBadge'
import ChatPanel from '../components/ChatPanel'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

function fmt(v, decimals = 2) {
    if (v === undefined || v === null) return 'N/A'
    return Number(v).toFixed(decimals)
}

function formatBytes(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0, s = bytes
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
    return `${s.toFixed(1)} ${units[i]}`
}

const TH = ({ children }) => (
    <th style={{
        background: '#1e293b', color: '#64748b', fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        padding: '10px 14px', textAlign: 'left', borderBottom: '1px solid #1e293b',
        whiteSpace: 'nowrap',
    }}>{children}</th>
)
const TD = ({ children, mono, muted, highlight }) => (
    <td style={{
        padding: '10px 14px', fontSize: '0.8125rem', borderBottom: '1px solid #0f172a',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        color: highlight ? highlight : muted ? '#64748b' : '#cbd5e1',
        verticalAlign: 'top',
    }}>{children ?? '—'}</td>
)

export default function TableDetailPage() {
    const { snapshotId, tableName } = useParams()
    const navigate = useNavigate()
    const [snapshot, setSnapshot] = useState(null)
    const [table, setTable] = useState(null)
    const [loading, setLoading] = useState(true)
    const [overview, setOverview] = useState(null)
    const [overviewLoading, setOverviewLoading] = useState(true)

    useEffect(() => {
        getSnapshot(snapshotId).then((res) => {
            setSnapshot(res.data)
            const t = res.data.tables.find((t) => t.name === decodeURIComponent(tableName))
            setTable(t)
            setLoading(false)
        })
    }, [snapshotId, tableName])

    useEffect(() => {
        // Fetch table overview from Gemini on page load
        axios.post(`${API_BASE}/api/snapshots/${snapshotId}/table-overview/${encodeURIComponent(tableName)}`)
            .then(r => { setOverview(r.data); setOverviewLoading(false) })
            .catch(() => setOverviewLoading(false))
    }, [snapshotId, tableName])

    if (loading) return (
        <div className="page" style={{ textAlign: 'center', paddingTop: 120 }}>
            <span className="spinner" style={{ width: 40, height: 40 }} />
        </div>
    )

    if (!table) return (
        <div className="page empty-state">
            <h3>Table not found</h3>
            <button className="btn btn-secondary mt-16" onClick={() => navigate(-1)}>← Back</button>
        </div>
    )

    const numericCols = table.columns?.filter((c) => c.quality?.avg !== undefined) || []
    const qualityCols = table.columns?.filter((c) => c.quality?.completeness !== undefined) || []

    // Merge AI column descriptions from overview into table columns
    const colDescriptions = overview?.columnDescriptions || {}

    return (
        <div className="page" style={{ maxWidth: 1100 }}>
            {/* Header */}
            <div className="mb-24">
                <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    ← Back to Dashboard
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700 }}>{table.name}</h1>
                    <QualityBadge score={table.qualityScore} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        ROWS: {Number(table.rowCount || 0).toLocaleString()}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        SIZE: {formatBytes(table.sizeBytes)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        COLS: {table.columns?.length}
                    </span>
                </div>

                {/* Quality Flags */}
                {table.qualityFlags?.length > 0 && (
                    <div className="warning-box mt-16">
                        <strong>⚠ Quality Warnings</strong>
                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {table.qualityFlags.map((f, i) => <span key={i} className="flag-chip">{f}</span>)}
                        </div>
                    </div>
                )}
            </div>

            {/* AI OVERVIEW */}
            <div className="section">
                <div className="section-title">AI Overview</div>
                <div className="card">
                    {overviewLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
                            <span className="spinner" style={{ width: 20, height: 20 }} />
                            Generating AI analysis…
                        </div>
                    ) : overview ? (
                        <>
                            {overview.tableSummary && (
                                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 16px 0' }}>
                                    {overview.tableSummary}
                                </p>
                            )}

                            {overview.usageRecommendations && (
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Usage Recommendations</div>
                                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{overview.usageRecommendations}</p>
                                </div>
                            )}

                            {overview.analyticalInsights && (
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Analytical Insights</div>
                                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{overview.analyticalInsights}</p>
                                </div>
                            )}

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
                                {overview.qualityInsight && (
                                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 16px', borderLeft: '3px solid #f59e0b' }}>
                                        <div style={{ color: '#f59e0b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Quality Insight</div>
                                        <p style={{ color: '#cbd5e1', fontSize: 13, margin: 0, lineHeight: 1.6 }}>{overview.qualityInsight}</p>
                                    </div>
                                )}
                                {overview.optimizationTips && (
                                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 16px', borderLeft: '3px solid #6366f1' }}>
                                        <div style={{ color: '#6366f1', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Optimization Tips</div>
                                        <p style={{ color: '#cbd5e1', fontSize: 13, margin: 0, lineHeight: 1.6 }}>{overview.optimizationTips}</p>
                                    </div>
                                )}
                                {overview.dataGovernanceNotes && (
                                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 16px', borderLeft: '3px solid #22c55e', gridColumn: overview.qualityInsight && overview.optimizationTips ? '1 / -1' : 'auto' }}>
                                        <div style={{ color: '#22c55e', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Data Governance</div>
                                        <p style={{ color: '#cbd5e1', fontSize: 13, margin: 0, lineHeight: 1.6 }}>{overview.dataGovernanceNotes}</p>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>AI overview unavailable. Try clicking Regen AI Docs from the dashboard.</p>
                    )}
                </div>
            </div>

            {/* SAMPLE QUERIES */}
            {(overview?.sampleQueries?.length > 0 || table.aiSampleQueries?.length > 0) && (
                <div className="section">
                    <div className="section-title">Sample Queries</div>
                    {(overview?.sampleQueries || table.aiSampleQueries || []).map((q, i) => (
                        <div key={i} className="code-block" style={{ marginBottom: 12 }}>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8125rem' }}>{q}</pre>
                        </div>
                    ))}
                </div>
            )}

            {/* COLUMN DETAILS */}
            <div className="section">
                <div className="section-title">Column Details ({table.columns?.length})</div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <TH>Column</TH>
                                    <TH>Type</TH>
                                    <TH>Nullable</TH>
                                    <TH>Constraints</TH>
                                    <TH>AI Description</TH>
                                </tr>
                            </thead>
                            <tbody>
                                {table.columns?.map((col) => (
                                    <tr key={col.name} style={{ background: 'transparent' }}>
                                        <TD mono>{col.name}</TD>
                                        <TD mono muted>{col.dataType}</TD>
                                        <TD muted>{col.isNullable ? 'YES' : 'NO'}</TD>
                                        <td style={{ padding: '10px 14px', borderBottom: '1px solid #0f172a' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                {col.isPrimaryKey && <span className="constraint-badge constraint-pk">PK</span>}
                                                {col.isForeignKey && (
                                                    <Link
                                                        to={`/table/${snapshotId}/${encodeURIComponent(col.foreignKeyRef?.table)}`}
                                                        className="constraint-badge constraint-fk"
                                                        style={{ textDecoration: 'none' }}
                                                    >
                                                        FK→{col.foreignKeyRef?.table}
                                                    </Link>
                                                )}
                                                {col.isUnique && <span className="constraint-badge constraint-unique">UNIQUE</span>}
                                                {col.isIndexed && !col.isPrimaryKey && <span className="constraint-badge constraint-indexed">IDX</span>}
                                            </div>
                                        </td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.8125rem', color: '#94a3b8', maxWidth: 300, borderBottom: '1px solid #0f172a' }}>
                                            {colDescriptions[col.name] || col.aiDescription || <span style={{ color: '#475569', fontStyle: 'italic' }}>—</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* COMPLETENESS & NULL ANALYSIS */}
            {qualityCols.length > 0 && (
                <div className="section">
                    <div className="section-title">Completeness &amp; Null Analysis</div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <TH>Column</TH>
                                        <TH>Completeness</TH>
                                        <TH>Nulls</TH>
                                        <TH>Distinct</TH>
                                        <TH>Uniqueness Ratio</TH>
                                    </tr>
                                </thead>
                                <tbody>
                                    {qualityCols.map((col) => {
                                        const comp = col.quality.completeness ?? 0
                                        const compColor = comp >= 90 ? '#22c55e' : comp >= 70 ? '#f59e0b' : '#ef4444'
                                        return (
                                            <tr key={col.name}>
                                                <TD mono>{col.name}</TD>
                                                <td style={{ padding: '10px 14px', borderBottom: '1px solid #0f172a' }}>
                                                    <span style={{ color: compColor, fontWeight: 600 }}>{comp.toFixed(1)}%</span>
                                                </td>
                                                <TD muted>{col.quality.nullCount?.toLocaleString()}</TD>
                                                <TD muted>{col.quality.distinctCount?.toLocaleString()}</TD>
                                                <TD muted>{col.quality.uniquenessRatio !== undefined ? `${(col.quality.uniquenessRatio * 100).toFixed(1)}%` : '—'}</TD>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* NUMERIC STATISTICS */}
            {numericCols.length > 0 && (
                <div className="section">
                    <div className="section-title">Numeric Statistics</div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <TH>Column</TH>
                                        <TH>Min</TH>
                                        <TH>Avg</TH>
                                        <TH>Max</TH>
                                        <TH>P50</TH>
                                        <TH>P95</TH>
                                        <TH>Skewness</TH>
                                        <TH>Outliers</TH>
                                    </tr>
                                </thead>
                                <tbody>
                                    {numericCols.map((col) => (
                                        <tr key={col.name}>
                                            <TD mono>{col.name}</TD>
                                            <TD muted>{fmt(col.quality.min)}</TD>
                                            <TD>{fmt(col.quality.avg)}</TD>
                                            <TD muted>{fmt(col.quality.max)}</TD>
                                            <TD muted>{fmt(col.quality.p50)}</TD>
                                            <TD muted>{fmt(col.quality.p95)}</TD>
                                            <td style={{ padding: '10px 14px', borderBottom: '1px solid #0f172a', fontSize: '0.8125rem', color: Math.abs(col.quality.skewness ?? 0) > 1 ? '#f59e0b' : '#64748b' }}>
                                                {fmt(col.quality.skewness)}
                                            </td>
                                            <td style={{ padding: '10px 14px', borderBottom: '1px solid #0f172a', fontSize: '0.8125rem', color: (col.quality.outlierCount ?? 0) > 0 ? '#f59e0b' : '#64748b' }}>
                                                {col.quality.outlierCount ?? 0} ({fmt(col.quality.outlierPct, 1)}%)
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* REFERENCED BY */}
            {table.referencedBy?.length > 0 && (
                <div className="section">
                    <div className="section-title">Referenced By</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {table.referencedBy.map((ref, i) => (
                            <Link
                                key={i}
                                to={`/table/${snapshotId}/${encodeURIComponent(ref.table)}`}
                                className="badge badge-purple"
                                style={{ textDecoration: 'none', cursor: 'pointer' }}
                            >
                                {ref.table}.{ref.column}
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            <ChatPanel snapshotId={snapshotId} />
        </div>
    )
}
