export default function QualityBadge({ score, size = 'normal' }) {
    if (score === undefined || score === null) {
        return <span className="badge badge-blue" style={size === 'sm' ? { fontSize: '0.7rem' } : {}}>N/A</span>
    }

    const cls = score >= 80 ? 'badge-green' : score >= 60 ? 'badge-yellow' : 'badge-red'
    const icon = score >= 80 ? '●' : score >= 60 ? '●' : '●'
    const style = size === 'sm' ? { fontSize: '0.7rem', padding: '2px 8px' } : {}

    return (
        <span className={`badge ${cls}`} style={style} title={`Quality Score: ${score}/100`}>
            {icon} {score}
        </span>
    )
}
