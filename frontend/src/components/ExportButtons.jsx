import { exportJson as apiExportJson, exportMarkdown as apiExportMarkdown, triggerDownload } from '../api'
import { useState } from 'react'

export default function ExportButtons({ snapshotId }) {
    const [loading, setLoading] = useState(null)

    const handleExport = async (format) => {
        setLoading(format)
        try {
            let res, filename
            if (format === 'json') {
                res = await apiExportJson(snapshotId)
                filename = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] || 'export.json'
            } else {
                res = await apiExportMarkdown(snapshotId)
                filename = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] || 'export.md'
            }
            triggerDownload(res.data, filename)
        } catch (err) {
            console.error('Export error:', err)
        } finally {
            setLoading(null)
        }
    }

    return (
        <div className="flex gap-8">
            <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleExport('json')}
                disabled={!!loading}
                id="export-json-btn"
            >
                {loading === 'json' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                )}
                Export JSON
            </button>
            <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleExport('markdown')}
                disabled={!!loading}
                id="export-markdown-btn"
            >
                {loading === 'markdown' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                )}
                Export Markdown
            </button>
        </div>
    )
}
