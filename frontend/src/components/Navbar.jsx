import { NavLink, useParams } from 'react-router-dom'

const DatabaseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
)

export default function Navbar() {
    const params = useParams()
    const snapshotId = params.snapshotId || null

    return (
        <nav className="navbar">
            <NavLink to="/" className="navbar-logo">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <defs>
                        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#8b5cf6" />
                        </linearGradient>
                    </defs>
                    <circle cx="12" cy="12" r="10" stroke="url(#lg)" strokeWidth="2" />
                    <path d="M8 12h8M12 8v8" stroke="url(#lg)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                DataLens AI
            </NavLink>

            <div className="navbar-links">
                <NavLink
                    to="/"
                    className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
                    end
                >
                    <DatabaseIcon />
                    Connections
                </NavLink>

                {snapshotId && (
                    <>
                        <NavLink
                            to={`/dashboard/${snapshotId}`}
                            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="7" height="7" rx="1" />
                                <rect x="14" y="3" width="7" height="7" rx="1" />
                                <rect x="3" y="14" width="7" height="7" rx="1" />
                                <rect x="14" y="14" width="7" height="7" rx="1" />
                            </svg>
                            Dashboard
                        </NavLink>
                        <NavLink
                            to={`/quality/${snapshotId}`}
                            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                            Quality
                        </NavLink>
                        <NavLink
                            to={`/lineage/${snapshotId}`}
                            className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="18" cy="18" r="3" />
                                <circle cx="6" cy="6" r="3" />
                                <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                                <line x1="6" y1="9" x2="6" y2="21" />
                            </svg>
                            Lineage
                        </NavLink>
                    </>
                )}

                <NavLink
                    to="/artifacts"
                    className={({ isActive }) => `navbar-link${isActive ? ' active' : ''}`}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Artifacts
                </NavLink>
            </div>
        </nav>
    )
}
