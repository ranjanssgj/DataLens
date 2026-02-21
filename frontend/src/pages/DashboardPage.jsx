import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactFlow, {
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    MarkerType,
    Handle,
    Position,
} from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import { getSnapshot } from '../api'
import ExportButtons from '../components/ExportButtons'
import ChatPanel from '../components/ChatPanel'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000'

const NODE_W = 200
const NODE_H = 68

function formatNum(n) {
    if (n === undefined || n === null) return '—'
    return Number(n).toLocaleString()
}

function formatBytes(bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0, s = bytes
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
    return `${s.toFixed(1)} ${units[i]}`
}

const StatCard = ({ label, value, color = 'var(--text-primary)', tooltip }) => (
    <div style={{ textAlign: 'center', padding: '8px 4px', position: 'relative' }} title={tooltip}>
        <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value ?? '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
)

// Custom node component with hover tooltip
function TableNode({ data }) {
    const [hovered, setHovered] = useState(false)
    const score = data.qualityScore ?? null
    const borderColor = score === null ? '#2d2d3a'
        : score >= 80 ? '#4ade80'
            : score >= 60 ? '#facc15'
                : '#f87171'

    return (
        <div
            style={{ position: 'relative' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* ReactFlow connection handles — required for edges to render */}
            <Handle type="target" position={Position.Left} style={{ background: '#6366f1', width: 8, height: 8, border: 'none' }} />
            <Handle type="source" position={Position.Right} style={{ background: '#6366f1', width: 8, height: 8, border: 'none' }} />

            <div style={{
                background: '#13141f',
                border: `1px solid ${hovered ? '#6366f1' : '#2d2d3a'}`,
                borderRadius: 7,
                padding: '9px 13px',
                width: NODE_W,
                height: NODE_H,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 4,
                opacity: data.dimmed ? 0.25 : 1,
                transition: 'opacity 0.15s, border-color 0.15s',
            }}>
                <div style={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#f0f1f6',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                }}>
                    {data.tableName}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#8b8fa8' }}>
                    {formatNum(data.rowCount)} rows · {data.colCount} cols
                </div>
            </div>

            {/* Hover tooltip */}
            {hovered && (
                <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: 8,
                    background: '#1e2030',
                    border: '1px solid #2d2d3a',
                    borderRadius: 6,
                    padding: '8px 12px',
                    minWidth: 180,
                    zIndex: 1000,
                    pointerEvents: 'none',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#f0f1f6', marginBottom: 6 }}>
                        {data.tableName}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        {[
                            ['Rows', formatNum(data.rowCount)],
                            ['Columns', data.colCount],
                            ['Size', formatBytes(data.sizeBytes)],
                            ['Quality', score !== null ? `${score}/100` : '—'],
                        ].map(([k, v]) => (
                            <tr key={k}>
                                <td style={{ color: '#8b8fa8', fontSize: 11, paddingRight: 12, paddingBottom: 2 }}>{k}</td>
                                <td style={{ color: '#f0f1f6', fontSize: 11, fontWeight: 500, paddingBottom: 2 }}>{v}</td>
                            </tr>
                        ))}
                    </table>
                    {data.qualityFlags?.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 10, color: '#facc15' }}>
                            {data.qualityFlags[0]}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

const nodeTypes = { tableNode: TableNode }

function buildGraph(tables, search = '') {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 36, marginx: 40, marginy: 40 })

    tables.forEach((t) => g.setNode(t.name, { width: NODE_W, height: NODE_H }))
    tables.forEach((table) => {
        ; (table.columns || []).forEach((col) => {
            if (col.isForeignKey && col.foreignKeyRef?.table) {
                if (g.hasNode(col.foreignKeyRef.table)) {
                    g.setEdge(table.name, col.foreignKeyRef.table)
                }
            }
        })
    })
    dagre.layout(g)

    const query = search.trim().toLowerCase()
    const matchedNames = query
        ? new Set(tables.filter(t => t.name.toLowerCase().includes(query)).map(t => t.name))
        : null

    const flowNodes = tables.map((table) => {
        const pos = g.node(table.name)
        const dimmed = matchedNames !== null && !matchedNames.has(table.name)
        return {
            id: table.name,
            type: 'tableNode',
            position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
            data: {
                tableName: table.name,
                rowCount: table.rowCount,
                colCount: table.columns?.length ?? 0,
                sizeBytes: table.sizeBytes,
                qualityScore: table.qualityScore,
                qualityFlags: table.qualityFlags,
                dimmed,
            },
        }
    })

    const seen = new Set()
    const flowEdges = []
    tables.forEach((table) => {
        ; (table.columns || []).forEach((col) => {
            if (col.isForeignKey && col.foreignKeyRef?.table) {
                const target = col.foreignKeyRef.table
                if (!g.hasNode(target)) return
                const edgeId = `${table.name}__${target}`
                if (seen.has(edgeId)) return
                seen.add(edgeId)
                const isDimmed = matchedNames !== null &&
                    !matchedNames.has(table.name) && !matchedNames.has(target)
                flowEdges.push({
                    id: edgeId,
                    source: table.name,
                    target,
                    label: `${col.name} → ${col.foreignKeyRef.column}`,
                    animated: false,
                    type: 'smoothstep',
                    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: isDimmed ? '#333' : '#6366f1' },
                    style: { stroke: isDimmed ? '#333' : '#6366f1', strokeWidth: 1.5, opacity: isDimmed ? 0.2 : 1 },
                    labelStyle: { fill: isDimmed ? '#555' : '#94a3b8', fontSize: 9, fontFamily: 'monospace' },
                    labelBgStyle: { fill: '#0f111a', stroke: 'transparent', fillOpacity: isDimmed ? 0 : 0.9 },
                    labelBgPadding: [4, 3],
                })
            }
        })
    })

    return { flowNodes, flowEdges }
}

export default function DashboardPage() {
    const { snapshotId } = useParams()
    const navigate = useNavigate()
    const [snapshot, setSnapshot] = useState(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [regenStatus, setRegenStatus] = useState(null) // null | 'running' | 'complete' | 'failed'
    const [regenProgress, setRegenProgress] = useState({ progress: 0, total: 0, currentTable: '' })
    const [reindexStatus, setReindexStatus] = useState('idle') // idle, running, complete, failed
    const [refreshing, setRefreshing] = useState(false)
    const [nodes, setNodes, onNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])
    const rfRef = useRef(null)

    const applyGraph = useCallback((tables, searchQuery) => {
        const { flowNodes, flowEdges } = buildGraph(tables, searchQuery)
        setNodes(flowNodes)
        setEdges(flowEdges)
    }, [setNodes, setEdges])

    const loadSnapshot = useCallback((skipCache = false) => {
        const cacheKey = `snapshot_${snapshotId}`
        if (!skipCache) {
            const cached = sessionStorage.getItem(cacheKey)
            if (cached) {
                try {
                    const data = JSON.parse(cached)
                    setSnapshot(data)
                    applyGraph(data.tables ?? [], '')
                    setLoading(false)
                    return
                } catch { /* ignore */ }
            }
        }
        getSnapshot(snapshotId).then((res) => {
            setSnapshot(res.data)
            sessionStorage.setItem(cacheKey, JSON.stringify(res.data))
            applyGraph(res.data.tables ?? [], '')
            setLoading(false)
            setRefreshing(false)
        }).catch(() => { setLoading(false); setRefreshing(false) })
    }, [snapshotId, applyGraph])

    useEffect(() => { loadSnapshot(false) }, [loadSnapshot])

    // Re-run graph when search changes
    useEffect(() => {
        if (snapshot?.tables) applyGraph(snapshot.tables, search)
    }, [search, snapshot, applyGraph])

    const handleRefresh = () => {
        setRefreshing(true)
        sessionStorage.removeItem(`snapshot_${snapshotId}`)
        loadSnapshot(true)
    }

    const handleRegenerate = async () => {
        setRegenStatus('running')
        setRegenProgress({ progress: 0, total: 0, currentTable: 'Starting...' })
        try {
            await axios.post(`${API_BASE}/api/snapshots/${snapshotId}/regenerate`)

            const pollInterval = setInterval(async () => {
                try {
                    const statusRes = await axios.get(`${API_BASE}/api/snapshots/${snapshotId}/doc-status`)
                    const { status, progress, total, currentTable } = statusRes.data

                    setRegenProgress({ progress: progress || 0, total: total || 0, currentTable: currentTable || '' })

                    if (status === 'complete') {
                        clearInterval(pollInterval)
                        setRegenStatus('complete')
                        // Clear cache and reload fresh snapshot with AI overview
                        sessionStorage.removeItem(`snapshot_${snapshotId}`)
                        const freshData = await axios.get(`${API_BASE}/api/snapshots/${snapshotId}`)
                        setSnapshot(freshData.data)
                        sessionStorage.setItem(`snapshot_${snapshotId}`, JSON.stringify(freshData.data))
                        applyGraph(freshData.data.tables ?? [], search)
                    } else if (status === 'failed') {
                        clearInterval(pollInterval)
                        setRegenStatus('failed')
                    }
                } catch (e) {
                    clearInterval(pollInterval)
                    setRegenStatus('failed')
                }
            }, 3000)
        } catch (err) {
            console.error('[REGEN]', err.response?.data?.error || err.message)
            setRegenStatus('failed')
        }
    }

    const handleReIndex = async () => {
        setReindexStatus('running')
        try {
            await axios.post(`${API_BASE}/api/snapshots/${snapshotId}/re-embed`)
            setReindexStatus('complete')
            setTimeout(() => setReindexStatus('idle'), 3000)
        } catch (err) {
            console.error('[RE-EMBED]', err.response?.data?.error || err.message)
            setReindexStatus('failed')
            setTimeout(() => setReindexStatus('idle'), 3000)
        }
    }

    const handleNodeClick = useCallback((_, node) => {
        navigate(`/table/${snapshotId}/${encodeURIComponent(node.id)}`)
    }, [navigate, snapshotId])

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

    const tables = snapshot.tables ?? []
    const avgQuality = tables.length > 0
        ? Math.round(tables.reduce((s, t) => s + (t.qualityScore || 0), 0) / tables.length)
        : 0

    // Overall completeness: average completeness across all columns in all tables
    const allCompleteness = []
    tables.forEach(table => {
        table.columns?.forEach(col => {
            if (col.quality?.completeness !== undefined) {
                allCompleteness.push(col.quality.completeness)
            }
        })
    })
    const avgCompleteness = allCompleteness.length > 0
        ? Math.round(allCompleteness.reduce((a, b) => a + b, 0) / allCompleteness.length)
        : null

    // Freshness: percentage of tables that are NOT stale (no STALE_DATA flag)
    const staleTables = tables.filter(t => t.qualityFlags?.includes('STALE_DATA')).length
    const freshnessScore = tables.length > 0
        ? Math.round(((tables.length - staleTables) / tables.length) * 100)
        : 100

    // Key Health: percentage of tables with no PK issues and no FK violations
    const keyIssues = tables.filter(t =>
        t.qualityFlags?.some(f =>
            f === 'NO_PRIMARY_KEY' ||
            f === 'PK_DUPLICATE_VALUES' ||
            f.startsWith('FK_VIOLATION')
        )
    ).length
    const keyHealthScore = tables.length > 0
        ? Math.round(((tables.length - keyIssues) / tables.length) * 100)
        : 100

    return (
        <div className="page">
            {/* Header */}
            <div className="flex-between mb-24">
                <div>
                    <h1 className="page-title">{snapshot.connectionName}</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
                        <span className="badge badge-purple">{snapshot.dbType?.toUpperCase()}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{snapshot.databaseName}</span>
                        {snapshot.databaseDomain && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>· {snapshot.databaseDomain}</span>
                        )}
                        {snapshot.extractedAt && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                                Synced {new Date(snapshot.extractedAt).toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => navigate('/connect')}
                    >
                        + Add Connection
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleRefresh}
                        disabled={refreshing}
                    >
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleRegenerate}
                        disabled={regenStatus === 'running'}
                    >
                        {regenStatus === 'running' ? 'Generating…' : 'Regen AI Docs'}
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleReIndex}
                        disabled={reindexStatus === 'running'}
                    >
                        {reindexStatus === 'running' ? 'Re-indexing…' : 'Re-index Vectors'}
                    </button>
                    {regenStatus === 'complete' && (
                        <span style={{ color: '#22c55e', fontSize: 13 }}>✅ Done</span>
                    )}
                    {regenStatus === 'failed' && (
                        <span style={{ color: '#ef4444', fontSize: 13 }}>❌ Failed</span>
                    )}
                    {reindexStatus === 'complete' && (
                        <span style={{ color: '#22c55e', fontSize: 13 }}>✅ Indexed</span>
                    )}
                    {reindexStatus === 'failed' && (
                        <span style={{ color: '#ef4444', fontSize: 13 }}>❌ Failed</span>
                    )}
                    <ExportButtons snapshotId={snapshotId} />
                </div>
            </div>

            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, marginBottom: 28, background: 'var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: 'var(--bg-card)', padding: 16 }}>
                    <StatCard label="Tables" value={snapshot.tableCount} />
                </div>
                <div style={{ background: 'var(--bg-card)', padding: 16 }}>
                    <StatCard label="Total Rows" value={formatNum(snapshot.totalRows)} />
                </div>
                <div style={{ background: 'var(--bg-card)', padding: 16 }}>
                    <StatCard label="Avg Quality" value={`${avgQuality}%`}
                        color={avgQuality >= 80 ? '#22c55e' : avgQuality >= 60 ? '#f59e0b' : '#ef4444'} />
                </div>
                <div style={{ background: 'var(--bg-card)', padding: 16 }}>
                    <StatCard
                        label="Completeness"
                        value={avgCompleteness !== null ? `${avgCompleteness}%` : 'N/A'}
                        color={avgCompleteness === null ? 'var(--text-primary)' : avgCompleteness >= 90 ? '#22c55e' : avgCompleteness >= 70 ? '#f59e0b' : '#ef4444'}
                        tooltip="Average % of non-null values across all columns"
                    />
                </div>
                <div style={{ background: 'var(--bg-card)', padding: 16 }}>
                    <StatCard
                        label="Freshness"
                        value={`${freshnessScore}%`}
                        color={freshnessScore === 100 ? '#22c55e' : freshnessScore >= 80 ? '#f59e0b' : '#ef4444'}
                        tooltip="% of tables with up-to-date data (no stale flag)"
                    />
                </div>
                <div style={{ background: 'var(--bg-card)', padding: 16 }}>
                    <StatCard
                        label="Key Health"
                        value={`${keyHealthScore}%`}
                        color={keyHealthScore === 100 ? '#22c55e' : keyHealthScore >= 80 ? '#f59e0b' : '#ef4444'}
                        tooltip="% of tables with valid PKs and no FK violations"
                    />
                </div>
            </div>

            {/* AI Database Overview — always shown */}
            {(() => {
                const dbSummary = snapshot.databaseSummary || null
                const dbDomain = snapshot.databaseDomain || null
                const healthAssessment = snapshot.overallHealthAssessment || null
                const criticalIssues = snapshot.criticalIssues || []
                const keyEntities = snapshot.keyEntities || []

                if (!dbSummary) {
                    return (
                        <div style={{ background: '#0f172a', borderRadius: 12, padding: 24, marginBottom: 24, borderLeft: '4px solid #334155', textAlign: 'center' }}>
                            <div style={{ color: '#475569', fontSize: 14 }}>
                                AI overview not generated yet — click{' '}
                                <strong style={{ color: '#6366f1', cursor: 'pointer' }} onClick={handleRegenerate}>Regen AI Docs</strong>{' '}
                                or <strong style={{ color: '#6366f1', cursor: 'pointer' }} onClick={handleReIndex}>Re-index Vectors</strong>{' '}
                                to generate
                            </div>
                        </div>
                    )
                }

                return (
                    <div style={{ background: '#0f172a', borderRadius: 12, padding: 24, marginBottom: 24, borderLeft: '4px solid #6366f1' }}>
                        <div style={{ color: '#6366f1', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>
                            {dbDomain ? `${dbDomain} · ` : ''}Database Overview
                        </div>
                        <p style={{ color: '#e2e8f0', margin: '0 0 16px 0', lineHeight: 1.7, fontSize: 15 }}>{dbSummary}</p>
                        {healthAssessment && (
                            <p style={{ color: '#94a3b8', margin: '0 0 12px 0', fontSize: 13, lineHeight: 1.6 }}>
                                <strong style={{ color: '#cbd5e1' }}>Health: </strong>{healthAssessment}
                            </p>
                        )}
                        {criticalIssues.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ color: '#f87171', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>⚠ Critical Issues</div>
                                {criticalIssues.map((issue, i) => (
                                    <div key={i} style={{ color: '#fca5a5', fontSize: 12, marginLeft: 12, marginBottom: 4 }}>• {issue}</div>
                                ))}
                            </div>
                        )}
                        {keyEntities.length > 0 && (
                            <div>
                                <span style={{ color: '#64748b', fontSize: 12 }}>Key Entities: </span>
                                {keyEntities.map(e => (
                                    <span key={e} style={{ background: '#1e293b', color: '#a5b4fc', borderRadius: 4, padding: '2px 8px', marginRight: 6, fontSize: 11 }}>{e}</span>
                                ))}
                            </div>
                        )}
                    </div>
                )
            })()}

            {/* Search — above the lineage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <input
                    className="form-input"
                    placeholder="Search tables — highlights in graph"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ maxWidth: 320, marginBottom: 0 }}
                    id="table-search"
                />
                {search && (
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSearch('')}
                    >
                        Clear
                    </button>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {search
                        ? `${tables.filter(t => t.name.toLowerCase().includes(search.toLowerCase())).length} match — click node to open table`
                        : `${tables.length} tables · ${edges.length} relationships`
                    }
                </span>
            </div>

            {/* Inline Lineage — full height, navigable */}
            <div style={{
                marginBottom: 28,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                height: 560,
            }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={handleNodeClick}
                    nodeTypes={nodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.12 }}
                    minZoom={0.08}
                    maxZoom={2}
                    style={{ background: '#0a0b0f' }}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background color="var(--bg-elevated)" gap={28} size={1} />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>
            <ChatPanel snapshotId={snapshotId} />

            {/* Regen progress toast */}
            {regenStatus === 'running' && (
                <div style={{
                    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                    background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
                    padding: '16px 24px', zIndex: 1000, minWidth: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}>
                    <div style={{ color: '#a5b4fc', fontWeight: 600, marginBottom: 8 }}>
                        ⚡ Generating AI Documentation
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
                        {regenProgress.total > 0
                            ? `Table ${regenProgress.progress}/${regenProgress.total}: ${regenProgress.currentTable}`
                            : regenProgress.currentTable || 'Starting...'}
                    </div>
                    <div style={{ height: 4, background: '#0f172a', borderRadius: 2 }}>
                        <div style={{
                            height: '100%',
                            width: regenProgress.total > 0
                                ? `${Math.round((regenProgress.progress / regenProgress.total) * 100)}%`
                                : '15%',
                            background: 'linear-gradient(90deg, #6366f1, #a5b4fc)',
                            borderRadius: 2,
                            transition: 'width 0.5s ease',
                        }} />
                    </div>
                </div>
            )}
        </div>
    )
}
