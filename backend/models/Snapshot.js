const mongoose = require('mongoose');

const QualitySchema = new mongoose.Schema({
    completeness: Number,
    nullCount: Number,
    distinctCount: Number,
    uniquenessRatio: Number,
    min: mongoose.Schema.Types.Mixed,
    max: mongoose.Schema.Types.Mixed,
    avg: Number,
    stdDev: Number,
    p25: Number,
    p50: Number,
    p75: Number,
    p95: Number,
    skewness: Number,
    kurtosis: Number,
    outlierCount: Number,
    outlierPct: Number,
}, { _id: false });

const ColumnSchema = new mongoose.Schema({
    name: String,
    dataType: String,
    isNullable: Boolean,
    defaultValue: String,
    isPrimaryKey: Boolean,
    isForeignKey: Boolean,
    isUnique: Boolean,
    isIndexed: Boolean,
    foreignKeyRef: {
        table: String,
        column: String,
    },
    aiDescription: String,
    quality: QualitySchema,
}, { _id: false });

const TableSchema = new mongoose.Schema({
    name: String,
    rowCount: Number,
    sizeBytes: Number,
    lastModified: Date,
    qualityScore: Number,
    qualityFlags: [String],
    aiSummary: String,
    aiUsageRecommendations: String,
    aiSampleQueries: [String],
    referencedBy: [{ table: String, column: String, _id: false }],
    columns: [ColumnSchema],
}, { _id: false });

const SnapshotSchema = new mongoose.Schema({
    connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Connection' },
    connectionName: String,
    databaseName: String,
    dbType: String,
    tables: [TableSchema],
    tableCount: Number,
    totalRows: Number,
    extractedAt: Date,
    aiGeneratedAt: Date,
    qualityAnalyzedAt: Date,
    previousSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Snapshot' },
    changes: {
        newTables: [String],
        droppedTables: [String],
        modifiedTables: [String],
    },
    databaseSummary: String,
    databaseDomain: String,
    keyEntities: [String],
    overallHealthAssessment: String,
    criticalIssues: [String],
});

module.exports = mongoose.model('Snapshot', SnapshotSchema);
