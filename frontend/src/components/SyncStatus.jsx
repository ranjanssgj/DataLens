import { useState } from 'react'
import { getSyncStatus, syncConnection } from '../api'

export default function SyncStatus({ connectionId, onSynced }) {
    const [syncing, setSyncing] = useState(false)
    const [lastSync, setLastSync] = useState(null)

    async function handleSync() {
        setSyncing(true)
        try {
            const res = await syncConnection(connectionId)
            if (onSynced) onSynced(res.data.snapshotId)
        } catch (err) {
            console.error(err)
        } finally {
            setSyncing(false)
        }
    }

    const formatDate = (d) => {
        if (!d) return 'Never'
        return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    return (
        <div className="flex-center gap-12" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            <span>Last sync: {formatDate(lastSync)}</span>
            <button
                className="btn btn-secondary btn-sm"
                onClick={handleSync}
                disabled={syncing}
                id="sync-now-btn"
            >
                {syncing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                )}
                Sync Now
            </button>
        </div>
    )
}
