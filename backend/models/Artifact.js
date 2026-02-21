const mongoose = require('mongoose');

const ArtifactSchema = new mongoose.Schema({
    snapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Snapshot' },
    connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Connection' },
    connectionName: String,
    format: { type: String, enum: ['json', 'markdown'] },
    content: String,
    filename: String,
    sizeBytes: Number,
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Artifact', ArtifactSchema);
