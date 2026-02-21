import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import ChatPanel from './components/ChatPanel'
import ConnectPage from './pages/ConnectPage'
import DashboardPage from './pages/DashboardPage'
import TableDetailPage from './pages/TableDetailPage'
import QualityPage from './pages/QualityPage'
import LineagePage from './pages/LineagePage'
import ArtifactsPage from './pages/ArtifactsPage'
import { useState } from 'react'

export default function App() {
    const [currentSnapshotId, setCurrentSnapshotId] = useState(null)

    return (
        <BrowserRouter>
            <Navbar />
            <Routes>
                <Route path="/" element={<ConnectPage setCurrentSnapshotId={setCurrentSnapshotId} />} />
                <Route path="/dashboard/:snapshotId" element={<DashboardPage />} />
                <Route path="/table/:snapshotId/:tableName" element={<TableDetailPage />} />
                <Route path="/quality/:snapshotId" element={<QualityPage />} />
                <Route path="/lineage/:snapshotId" element={<LineagePage />} />
                <Route path="/artifacts" element={<ArtifactsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    )
}
