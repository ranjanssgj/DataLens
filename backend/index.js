require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

const connectDB = require('./config/db');
const Connection = require('./models/Connection');
const Snapshot = require('./models/Snapshot');
const Artifact = require('./models/Artifact');
const { exportJson, exportMarkdown } = require('./services/exportService');

const app = express();
const PORT = process.env.PORT || 5000;
const PYTHON_SERVICE = process.env.PYTHON_SERVICE || 'http://localhost:8000';

const chatSessions = {};

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:5175',
            'http://localhost:3000',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5174',
        ];

        const isVercel = origin.endsWith('.vercel.app');

        if (allowedOrigins.includes(origin) || isVercel) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
    credentials: true,
    optionsSuccessStatus: 200,
}));

app.options(/.*/, cors());
app.use(express.json());

connectDB();


async function runFullSyncPipeline(connection, snapshotId) {
    const credentials = {
        db_type: connection.type,
        host: connection.host,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        password: connection.password,
        account: connection.account,
        warehouse: connection.warehouse,
        schema: connection.schema,
    };

    const callPython = async (label, fn) => {
        try {
            return await fn();
        } catch (err) {
            const detail = err.response?.data?.detail || err.response?.data || err.message;
            console.error(`[SYNC] ${label} failed:`, JSON.stringify(detail));
            throw new Error(`${label} failed: ${JSON.stringify(detail)}`);
        }
    };

    const extractRes = await callPython('extract', () =>
        axios.post(`${PYTHON_SERVICE}/extract`, credentials)
    );
    const tables = extractRes.data.tables;

    let snapshot;
    if (snapshotId) {
        snapshot = await Snapshot.findByIdAndUpdate(
            snapshotId,
            { tables, tableCount: tables.length, totalRows: tables.reduce((s, t) => s + (t.rowCount || 0), 0), extractedAt: new Date() },
            { new: true }
        );
    } else {
        const prevSnapshot = await Snapshot.findOne({ connectionId: connection._id }).sort({ extractedAt: -1 });
        snapshot = await Snapshot.create({
            connectionId: connection._id,
            connectionName: connection.name,
            databaseName: connection.database,
            dbType: connection.type,
            tables,
            tableCount: tables.length,
            totalRows: tables.reduce((s, t) => s + (t.rowCount || 0), 0),
            extractedAt: new Date(),
            previousSnapshotId: prevSnapshot?._id || null,
        });
    }

    await callPython('quality', () =>
        axios.post(`${PYTHON_SERVICE}/quality/${snapshot._id}`, credentials)
    );

    axios.post(`${PYTHON_SERVICE}/generate-docs/${snapshot._id}`, credentials).catch((err) => {
        const detail = err.response?.data?.detail || err.message;
        console.error('[SYNC] generate-docs error:', detail);
    });

    connection.lastSyncedAt = new Date();
    await connection.save();

    return snapshot;
}


app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'DataLens Express API',
        timestamp: new Date().toISOString()
    });
});


app.post('/api/connections', async (req, res) => {
    try {
        const conn = await Connection.create(req.body);
        res.json(conn);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/connections', async (req, res) => {
    try {
        const connections = await Connection.find({}, '-password');
        res.json(connections);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/connections/:id', async (req, res) => {
    try {
        await Connection.findByIdAndDelete(req.params.id);
        await Snapshot.deleteMany({ connectionId: req.params.id });
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/snapshots/:id/regenerate', async (req, res) => {
    try {
        const snapshot = await Snapshot.findById(req.params.id);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        // Fire-and-forget — FastAPI reads mongo_uri from its own .env
        await axios.post(
            `${PYTHON_SERVICE}/generate-docs/${req.params.id}`,
            {},
            { timeout: 10000 }
        );

        res.json({
            success: true,
            message: 'AI regeneration started. Poll /doc-status for progress.',
            pollUrl: `/api/snapshots/${req.params.id}/doc-status`,
            snapshotId: req.params.id,
        });
    } catch (err) {
        const detail = err.response?.data?.detail || err.message;
        console.error('[REGEN] Error:', detail);
        res.status(500).json({ error: detail });
    }
});

app.post('/api/snapshots/:id/re-embed', async (req, res) => {
    try {
        const snapshot = await Snapshot.findById(req.params.id);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        const pyRes = await axios.post(`${PYTHON_SERVICE}/re-embed/${req.params.id}`);

        res.json({
            success: true,
            tablesIndexed: pyRes.data.tablesIndexed,
            message: 'Embeddings re-indexed successfully.',
        });
    } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
        console.error('[RE-EMBED] Error:', detail);
        res.status(500).json({ error: detail });
    }
});


app.post('/api/connections/:id/sync', async (req, res) => {
    try {
        const connection = await Connection.findById(req.params.id);
        if (!connection) return res.status(404).json({ error: 'Connection not found' });

        const snapshot = await runFullSyncPipeline(connection, null);

        res.json({
            success: true,
            snapshotId: snapshot._id.toString(),
            message: 'Sync started. AI documentation generating in background.',
            pollUrl: `/api/snapshots/${snapshot._id}/doc-status`,
        });
    } catch (err) {
        console.error('Sync error:', err.message);
        res.status(500).json({
            success: false,
            error: err.message,
            hint: 'Make sure the Python service is running on port 8000',
        });
    }
});

app.get('/api/snapshots/:id/doc-status', async (req, res) => {
    try {
        const pyRes = await axios.get(`${PYTHON_SERVICE}/job-status/${req.params.id}`);
        res.json(pyRes.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/connections/:id/snapshots', async (req, res) => {
    try {
        const snapshots = await Snapshot.find(
            { connectionId: req.params.id },
            'connectionName databaseName dbType tableCount totalRows extractedAt aiGeneratedAt qualityAnalyzedAt'
        ).sort({ extractedAt: -1 });
        res.json(snapshots);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/snapshots/:id', async (req, res) => {
    try {
        const snapshot = await Snapshot.findById(req.params.id);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
        res.json(snapshot);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/snapshots/:id/export/json', async (req, res) => {
    try {
        const { content, filename } = await exportJson(req.params.id);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/json');
        res.send(content);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/snapshots/:id/export/markdown', async (req, res) => {
    try {
        const { content, filename } = await exportMarkdown(req.params.id);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'text/markdown');
        res.send(content);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/artifacts', async (req, res) => {
    try {
        const artifacts = await Artifact.find({}, '-content').sort({ createdAt: -1 });
        res.json(artifacts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/artifacts/:id/download', async (req, res) => {
    try {
        const artifact = await Artifact.findById(req.params.id);
        if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
        const contentType = artifact.format === 'json' ? 'application/json' : 'text/markdown';
        res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
        res.setHeader('Content-Type', contentType);
        res.send(artifact.content);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/snapshots/:id/chat', async (req, res) => {
    try {
        const { question, sessionId } = req.body;

        if (!question || question.trim() === '') {
            return res.status(400).json({ error: 'Question is required' });
        }

        const sid = sessionId || uuidv4();
        if (!chatSessions[sid]) chatSessions[sid] = [];
        const history = chatSessions[sid];

        const pyRes = await axios.post(`${PYTHON_SERVICE}/chat`, {
            question,
            snapshotId: req.params.id,
            history: history.slice(-20),
        }, { timeout: 60000 }); // 60 second timeout for AI response

        const { answer, sourceTables } = pyRes.data;

        history.push({ role: 'user', content: question });
        history.push({ role: 'assistant', content: answer });
        if (history.length > 20) chatSessions[sid] = history.slice(-20);

        res.json({ answer, sourceTables, sessionId: sid });
    } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data || err.message;
        console.error('[CHAT] Error:', JSON.stringify(detail));
        res.status(500).json({
            error: 'Chat failed',
            detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
        });
    }
});


app.post('/api/snapshots/:id/table-overview/:tableName', async (req, res) => {
    try {
        const snapshot = await Snapshot.findById(req.params.id);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        const table = snapshot.tables.find(t => t.name === req.params.tableName);
        if (!table) return res.status(404).json({ error: 'Table not found' });

        const pyRes = await axios.post(
            `${PYTHON_SERVICE}/table-overview`,
            { table, snapshotId: req.params.id },
            { timeout: 30000 }
        );
        res.json(pyRes.data);
    } catch (err) {
        const detail = err.response?.data?.detail || err.message;
        res.status(500).json({ error: detail });
    }
});


app.get('/api/connections/:id/sync-status', async (req, res) => {
    try {
        const connection = await Connection.findById(req.params.id, 'lastSyncedAt');
        if (!connection) return res.status(404).json({ error: 'Not found' });
        const latest = await Snapshot.findOne({ connectionId: req.params.id }).sort({ extractedAt: -1 }).select('_id');
        res.json({ lastSyncedAt: connection.lastSyncedAt, latestSnapshotId: latest?._id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


cron.schedule('0 */6 * * *', async () => {
    console.log('[CRON] Running schema change detection...');
    try {
        const connections = await Connection.find({});
        for (const conn of connections) {
            try {
                const credentials = {
                    db_type: conn.type,
                    host: conn.host,
                    port: conn.port,
                    database: conn.database,
                    username: conn.username,
                    password: conn.password,
                    account: conn.account,
                    warehouse: conn.warehouse,
                    schema: conn.schema,
                };

                const extractRes = await axios.post(`${PYTHON_SERVICE}/extract`, credentials);
                const currentTables = extractRes.data.tables;
                const currentTableNames = currentTables.map((t) => t.name).sort();
                const currentColCounts = currentTables.reduce((acc, t) => {
                    acc[t.name] = (t.columns || []).length;
                    return acc;
                }, {});

                const latestSnapshot = await Snapshot.findOne({ connectionId: conn._id }).sort({ extractedAt: -1 });

                if (!latestSnapshot) {
                    console.log(`[CRON] No snapshot for ${conn.name}, skipping`);
                    conn.lastSyncedAt = new Date();
                    await conn.save();
                    continue;
                }

                const prevTableNames = latestSnapshot.tables.map((t) => t.name).sort();
                const prevColCounts = latestSnapshot.tables.reduce((acc, t) => {
                    acc[t.name] = (t.columns || []).length;
                    return acc;
                }, {});

                const newTables = currentTableNames.filter((n) => !prevTableNames.includes(n));
                const droppedTables = prevTableNames.filter((n) => !currentTableNames.includes(n));
                const modifiedTables = currentTableNames.filter(
                    (n) => prevColCounts[n] !== undefined && prevColCounts[n] !== currentColCounts[n]
                );

                if (newTables.length > 0 || droppedTables.length > 0 || modifiedTables.length > 0) {
                    console.log(`[CRON] Change detected in ${conn.name}:`, { newTables, droppedTables, modifiedTables });
                    const snapshot = await Snapshot.create({
                        connectionId: conn._id,
                        connectionName: conn.name,
                        databaseName: conn.database,
                        dbType: conn.type,
                        tables: currentTables,
                        tableCount: currentTables.length,
                        totalRows: currentTables.reduce((s, t) => s + (t.rowCount || 0), 0),
                        extractedAt: new Date(),
                        previousSnapshotId: latestSnapshot._id,
                        changes: { newTables, droppedTables, modifiedTables },
                    });

                    await axios.post(`${PYTHON_SERVICE}/quality/${snapshot._id}`, credentials);
                    axios.post(`${PYTHON_SERVICE}/generate-docs/${snapshot._id}`, credentials).catch(() => { });
                } else {
                    console.log(`[CRON] No change in ${conn.name}`);
                }

                conn.lastSyncedAt = new Date();
                await conn.save();
            } catch (err) {
                console.error(`[CRON] Error for connection ${conn.name}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[CRON] Fatal error:', err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Express backend running on port ${PORT}`);
});
