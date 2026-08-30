const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const applicantRoutes = require('./routes/applicantRoutes');
const checklistRoutes = require('./routes/checklistRoutes');
const vaultRoutes = require('./routes/vaultRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const schemeRoutes = require('./routes/schemeRoutes');
const adminRoutes = require('./routes/adminRoutes');
const inspectionRoutes = require('./routes/inspectionRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'UDAAN backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/applicant', applicantRoutes);
app.use('/api/checklist', checklistRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/schemes', schemeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/notifications', notificationRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

module.exports = app;
