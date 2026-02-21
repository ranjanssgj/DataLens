const mongoose = require('mongoose');

const ConnectionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['postgres', 'mysql', 'mssql', 'snowflake'], required: true },
    host: { type: String },
    port: { type: String },
    database: { type: String },
    username: { type: String },
    password: { type: String },
    // Snowflake-specific
    account: { type: String },
    warehouse: { type: String },
    schema: { type: String },
    lastSyncedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Connection', ConnectionSchema);
