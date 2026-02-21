import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
} from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import { getSnapshot } from '../api'

const NODE_W = 200
const NODE_H = 80

function layoutGraph(tables) {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'TB', ranksep: 60, nodesep: 40 })

    tables.forEach((t) => g.setNode(t.name, { width: NODE_W, height: NODE_H }))

    tables.forEach((table) => {
        ; (table.columns || []).forEach((col) => {
            if (col.isForeignKey && col.foreignKeyRef?.table) {
                if (g.hasNode(col.foreignKeyRef.table)) {
                    g.setEdge(table.name, col.foreignKeyRef.table, {
                        label: `${col.name}→${col.foreignKeyRef.column}`,
                    })
                }
            }
        })
    })

    dagre.layout(g)

    return { g, tables }
}

function TableNode({ data }) {
    const score = data.qualityScore ?? null
    const borderColor = score === null ? '#555' : score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444'

    return (
        <div style={{
            background: '#16181f',
            border: `2px solid ${borderColor}`,
            borderRadius: 10,
            padding: '10px 14px',
            width: NODE_W,
            minHeight: NODE_H,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 600, color: '#f0f1f6', marginBottom: 4 }}>
                {data.tableName}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#8b8fa8' }}>
                    {Number(data.rowCount || 0).toLocaleString()} rows
                </span>
                {score !== null && (
                    <span style={{
                        fontSize: '0.65rem', padding: '1px 6px', borderRadius: 100, fontWeight: 700,
                        color: borderColor, background: `${borderColor}20`, border: `1px solid ${borderColor}33`
                    }}>
                        {score}
                    </span>
                )}
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
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getSnapshot(snapshotId).then((res) => {
            const { g, tables } = layoutGraph(res.data.tables)

            const flowNodes = tables.map((table) => {
                const pos = g.node(table.name)
                return {
                    id: table.name,
                    type: 'tableNode',
                    position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
                    data: {
                        tableName: table.name,
                        rowCount: table.rowCount,
                        qualityScore: table.qualityScore,
                    },
                }
            })

            const flowEdges = []
            const edgeIndex = {}
            tables.forEach((table) => {
                ; (table.columns || []).forEach((col) => {
                    if (col.isForeignKey && col.foreignKeyRef?.table) {
                        const edgeId = `${table.name}->${col.foreignKeyRef.table}`
                        if (!edgeIndex[edgeId] && g.hasNode(col.foreignKeyRef.table)) {
                            edgeIndex[edgeId] = true
                            flowEdges.push({
                                id: edgeId,
                                source: table.name,
                                target: col.foreignKeyRef.table,
                                label: `${col.name}→${col.foreignKeyRef.column}`,
                                animated: true,
                                style: { stroke: '#6366f1', strokeWidth: 1.5 },
                                labelStyle: { fill: '#8b8fa8', fontSize: 9, fontFamily: 'var(--font-mono)' },
                                labelBgStyle: { fill: '#16181f', stroke: 'transparent' },
                            })
                        }
                    }
                })
            })

            setNodes(flowNodes)
            setEdges(flowEdges)
            setLoading(false)
        })
    }, [snapshotId])

    const handleNodeClick = useCallback((event, node) => {
        navigate(`/table/${snapshotId}/${encodeURIComponent(node.id)}`)
    }, [snapshotId, navigate])

    if (loading) return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
            <span className="spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
        </div>
    )

    return (
        <div className="page-full">
            <div style={{ position: 'absolute', top: 70, left: 24, zIndex: 10 }}>
                <div style={{
                    background: 'rgba(10,11,15,0.85)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '10px 16px',
                }}>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>Schema Lineage</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {nodes.length} tables · {edges.length} relationships — click any table to view details
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
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.1}
                maxZoom={2}
                style={{ background: 'var(--bg-base)' }}
            >
                <Background color="#1e2030" gap={24} size={1} />
                <Controls />
                <MiniMap
                    nodeColor={(n) => {
                        const s = n.data?.qualityScore
                        if (!s) return '#555'
                        return s >= 80 ? '#22c55e' : s >= 60 ? '#eab308' : '#ef4444'
                    }}
                    style={{ background: '#16181f' }}
                />
            </ReactFlow>
        </div>
    )
}
