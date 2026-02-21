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

const StatCard = ({ label, value, color = 'var(--text-primary)' }) => (
    <div style={{ textAlign: 'center', padding: '8px 4px' }}>
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
    const [regenerating, setRegenerating] = useState(false)
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
        setRegenerating(true)
        try {
            await axios.post(`${API_BASE}/api/snapshots/${snapshotId}/regenerate`)
            const poll = setInterval(async () => {
                try {
                    const res = await axios.get(`${API_BASE}/api/snapshots/${snapshotId}/doc-status`)
                    if (res.data.status === 'complete' || res.data.status === 'failed') {
                        clearInterval(poll)
                        setRegenerating(false)
                        sessionStorage.removeItem(`snapshot_${snapshotId}`)
                        loadSnapshot(true)
                    }
                } catch { clearInterval(poll); setRegenerating(false) }
            }, 5000)
        } catch (e) { console.error(e); setRegenerating(false) }
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
    const tablesWithIssues = tables.filter(t => t.qualityFlags?.length > 0).length

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
                        onClick={handleRefresh}
                        disabled={refreshing}
                    >
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleRegenerate}
                        disabled={regenerating}
                    >
                        {regenerating ? 'Regenerating…' : 'Regen AI Docs'}
                    </button>
                    <ExportButtons snapshotId={snapshotId} />
                </div>
            </div>

            {/* Stats Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: 1,
                marginBottom: 28,
                background: 'var(--border)',
                borderRadius: 10,
                overflow: 'hidden',
            }}>
                {[
                    { label: 'Tables', value: snapshot.tableCount },
                    { label: 'Total Rows', value: formatNum(snapshot.totalRows) },
                    { label: 'Avg Quality', value: `${avgQuality}%` },
                    { label: 'Tables w/ Issues', value: tablesWithIssues },
                    { label: 'AI Docs', value: snapshot.aiGeneratedAt ? 'Ready' : 'Pending' },
                    { label: 'DB Type', value: snapshot.dbType?.toUpperCase() },
                ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg-card)', padding: 16 }}>
                        <StatCard {...s} />
                    </div>
                ))}
            </div>

            {/* AI Database Summary */}
            {snapshot.databaseSummary && (
                <div style={{
                    padding: '14px 18px',
                    marginBottom: 24,
                    background: 'var(--bg-card)',
                    borderRadius: 8,
                    borderLeft: '3px solid var(--border-accent)',
                }}>
                    <h4 style={{ color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>Database Overview</h4>
                    <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.875rem' }}>{snapshot.databaseSummary}</p>
                    {snapshot.keyEntities?.length > 0 && (
                        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Key entities:</span>
                            {snapshot.keyEntities.map(e => (
                                <span key={e} className="badge badge-purple" style={{ fontSize: 11 }}>{e}</span>
                            ))}
                        </div>
                    )}
                </div>
            )}

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
        </div>
    )
}
