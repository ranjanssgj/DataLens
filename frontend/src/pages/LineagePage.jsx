import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    MarkerType,
    Handle,
    Position,
} from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import { getSnapshot } from '../api'

const NODE_W = 210
const NODE_H = 72

function layoutGraph(tables) {
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
    return g
}

function TableNode({ data }) {
    const score = data.qualityScore ?? null
    const borderColor = score === null ? '#2d2d3a' : score >= 80 ? '#4ade80' : score >= 60 ? '#facc15' : '#f87171'

    return (
        <div style={{ position: 'relative' }}>
            <Handle type="target" position={Position.Left} style={{ background: '#6366f1', width: 8, height: 8, border: 'none' }} />
            <Handle type="source" position={Position.Right} style={{ background: '#6366f1', width: 8, height: 8, border: 'none' }} />
            <div style={{
                background: '#13141f',
                border: `1px solid ${borderColor}`,
                borderRadius: 8,
                padding: '10px 14px',
                width: NODE_W,
                height: NODE_H,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 5,
            }}>
                <div style={{ fontFamily: 'monospace', fontSize: '0.8125rem', fontWeight: 600, color: '#f0f1f6' }}>
                    {data.tableName}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: '#8b8fa8' }}>
                        {Number(data.rowCount || 0).toLocaleString()} rows
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#8b8fa8' }}>
                        {data.colCount} cols
                    </span>
                    {score !== null && (
                        <span style={{
                            fontSize: '0.65rem', padding: '1px 6px', borderRadius: 100, fontWeight: 600,
                            color: borderColor, background: `${borderColor}22`,
                        }}>
                            Q{score}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}

const nodeTypes = { tableNode: TableNode }

export default function LineagePage() {
    const { snapshotId } = useParams()
    const navigate = useNavigate()
    const [nodes, setNodes, onNodesChange] = useNodesState([])
    const [edges, setEdges, onEdgesChange] = useEdgesState([])
    const [snapshot, setSnapshot] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getSnapshot(snapshotId).then((res) => {
            const tables = res.data.tables ?? []
            setSnapshot(res.data)
            const g = layoutGraph(tables)

            const flowNodes = tables.map((table) => {
                const pos = g.node(table.name)
                return {
                    id: table.name,
                    type: 'tableNode',
                    position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
                    data: {
                        tableName: table.name,
                        rowCount: table.rowCount,
                        colCount: table.columns?.length ?? 0,
                        qualityScore: table.qualityScore,
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
                        const edgeId = `${table.name}→${target}`
                        if (seen.has(edgeId)) return
                        seen.add(edgeId)
                        flowEdges.push({
                            id: edgeId,
                            source: table.name,
                            target,
                            label: `${col.name} → ${col.foreignKeyRef.column}`,
                            animated: false,
                            type: 'smoothstep',
                            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#6366f1' },
                            style: { stroke: '#6366f1', strokeWidth: 1.5 },
                            labelStyle: { fill: '#94a3b8', fontSize: 9, fontFamily: 'monospace' },
                            labelBgStyle: { fill: '#0f111a', stroke: 'transparent', fillOpacity: 0.9 },
                            labelBgPadding: [4, 3],
                        })
                    }
                })
            })

            setNodes(flowNodes)
            setEdges(flowEdges)
            setLoading(false)
        }).catch(() => setLoading(false))
    }, [snapshotId])

    const handleNodeClick = useCallback((_, node) => {
        navigate(`/table/${snapshotId}/${encodeURIComponent(node.id)}`)
    }, [snapshotId, navigate])

    if (loading) return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
            <span className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
        </div>
    )

    return (
        <div className="page-full">
            {/* Info panel */}
            <div style={{ position: 'absolute', top: 70, left: 24, zIndex: 10 }}>
                <div style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 16px',
                    minWidth: 220,
                }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                        Schema Lineage
                    </div>
                    {snapshot && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {snapshot.connectionName} · {snapshot.databaseName}
                        </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        {nodes.length} tables · {edges.length} FK relationships
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>
                        Click any table to view details
                    </div>
                    {/* Legend */}
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {[['var(--green)', 'Quality ≥ 80'], ['var(--yellow)', 'Quality 60–79'], ['var(--red)', 'Quality < 60']].map(([c, l]) => (
                            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                <span style={{ width: 10, height: 10, borderRadius: 2, background: c, flexShrink: 0 }} />
                                {l}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                minZoom={0.1}
                maxZoom={2}
                style={{ background: 'var(--bg-base)' }}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="var(--bg-elevated)" gap={28} size={1} />
                <Controls />
                <MiniMap
                    nodeColor={(n) => {
                        const s = n.data?.qualityScore
                        return !s ? 'var(--border)' : s >= 80 ? 'var(--green)' : s >= 60 ? 'var(--yellow)' : 'var(--red)'
                    }}
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                />
            </ReactFlow>
        </div>
    )
}
