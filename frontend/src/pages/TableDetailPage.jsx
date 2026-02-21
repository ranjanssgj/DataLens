import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getSnapshot } from '../api'
import QualityBadge from '../components/QualityBadge'

function fmt(v, decimals = 2) {
    if (v === undefined || v === null) return 'N/A'
    return Number(v).toFixed(decimals)
}

function ProgressBar({ value }) {
    const pct = value ?? 0
    const cls = pct >= 80 ? 'green' : pct >= 60 ? 'yellow' : 'red'
    return (
        <div className="progress-bar-wrapper">
            <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} data-color={cls} />
            </div>
            <span className="progress-bar-label">{pct.toFixed(0)}%</span>
        </div>
    )
}

export default function TableDetailPage() {
    const { snapshotId, tableName } = useParams()
    const navigate = useNavigate()
    const [snapshot, setSnapshot] = useState(null)
    const [table, setTable] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getSnapshot(snapshotId).then((res) => {
            setSnapshot(res.data)
            const t = res.data.tables.find((t) => t.name === decodeURIComponent(tableName))
            setTable(t)
            setLoading(false)
        })
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

    return (
        <div className="page" style={{ maxWidth: 1100 }}>
            {/* Header */}
            <div className="mb-24">
                <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    ← Back to Dashboard
                </button>
                <div className="flex-center gap-16">
                    <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700 }}>{table.name}</h1>
                    <QualityBadge score={table.qualityScore} />
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
                    {[
                        ['Rows', Number(table.rowCount || 0).toLocaleString()],
                        ['Size', formatBytes(table.sizeBytes)],
                        ['Columns', table.columns?.length],
                        ['FK Refs', table.referencedBy?.length || 0],
                    ].map(([label, val]) => (
                        <div key={label}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label} </span>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{val}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Quality Flags */}
            {table.qualityFlags?.length > 0 && (
                <div className="warning-box mb-16">
                    <strong>⚠ Quality Warnings</strong>
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {table.qualityFlags.map((f, i) => <span key={i} className="flag-chip">{f}</span>)}
                    </div>
                </div>
            )}

            {/* AI Summary */}
            {table.aiSummary && (
                <div className="section">
                    <div className="section-title">Business Summary</div>
                    <div className="card">
                        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{table.aiSummary}</p>
                        {table.aiUsageRecommendations && (
                            <>
                                <div className="divider" />
                                <h4 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>Usage Recommendations</h4>
                                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{table.aiUsageRecommendations}</p>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Columns Table */}
            <div className="section">
                <div className="section-title">Columns ({table.columns?.length})</div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Column</th>
                                <th>Type</th>
                                <th>Nullable</th>
                                <th>Constraints</th>
                                <th>AI Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            {table.columns?.map((col) => (
                                <tr key={col.name}>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                                        {col.name}
                                    </td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                        {col.dataType}
                                    </td>
                                    <td style={{ fontSize: '0.8125rem', color: col.isNullable ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                                        {col.isNullable ? 'YES' : 'NO'}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
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
                                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', maxWidth: 280 }}>
                                        {col.aiDescription || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Data Quality Section */}
            <div className="section">
                <div className="section-title">Data Quality</div>
                <div className="card">
                    {(table.columns || []).filter((c) => c.quality?.completeness !== undefined).map((col) => (
                        <div key={col.name} style={{ marginBottom: 14 }}>
                            <div className="flex-between" style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                                    {col.name}
                                </span>
                                <div style={{ display: 'flex', gap: 16, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    <span>Nulls: {col.quality.nullCount?.toLocaleString()}</span>
                                    <span>Distinct: {col.quality.distinctCount?.toLocaleString()}</span>
                                </div>
                            </div>
                            <div className="progress-bar-wrapper">
                                <div className="progress-bar-track">
                                    <div className="progress-bar-fill" style={{
                                        width: `${col.quality.completeness ?? 0}%`,
                                        background: col.quality.completeness >= 80 ? 'var(--green)' : col.quality.completeness >= 60 ? 'var(--yellow)' : 'var(--red)'
                                    }} />
                                </div>
                                <span className="progress-bar-label">{(col.quality.completeness ?? 0).toFixed(0)}%</span>
                            </div>
                        </div>
                    ))}

                    {/* Numeric stats */}
                    {numericCols.length > 0 && (
                        <>
                            <div className="divider" />
                            <h4 style={{ color: 'var(--text-primary)', marginBottom: 14 }}>Numeric Statistics</h4>
                            <div style={{ overflowX: 'auto' }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Column</th>
                                            <th>Min</th>
                                            <th>Avg</th>
                                            <th>Max</th>
                                            <th>P50</th>
                                            <th>P95</th>
                                            <th>Outliers</th>
                                            <th>Skewness</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {numericCols.map((col) => (
                                            <tr key={col.name}>
                                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{col.name}</td>
                                                <td>{fmt(col.quality.min)}</td>
                                                <td>{fmt(col.quality.avg)}</td>
                                                <td>{fmt(col.quality.max)}</td>
                                                <td>{fmt(col.quality.p50)}</td>
                                                <td>{fmt(col.quality.p95)}</td>
                                                <td style={{ color: col.quality.outlierCount > 0 ? 'var(--yellow)' : 'inherit' }}>
                                                    {col.quality.outlierCount} ({fmt(col.quality.outlierPct, 1)}%)
                                                </td>
                                                <td style={{ color: Math.abs(col.quality.skewness ?? 0) > 1 ? 'var(--yellow)' : 'inherit' }}>
                                                    {fmt(col.quality.skewness)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Sample Queries */}
            {table.aiSampleQueries?.length > 0 && (
                <div className="section">
                    <div className="section-title">Sample Queries</div>
                    {table.aiSampleQueries.map((q, i) => (
                        <div key={i} className="code-block" style={{ marginBottom: 12 }}>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{q}</pre>
                        </div>
                    ))}
                </div>
            )}

            {/* Referenced By */}
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
        </div>
    )
}

function formatBytes(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0, s = bytes
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
    return `${s.toFixed(1)} ${units[i]}`
}
