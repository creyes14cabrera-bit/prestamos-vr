const express = require('express');
const cookieParser = require('cookie-parser');
const connectDB = require('./db');
const ensureConfig = require('./lib/ensureConfig');
const requireAuth = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const clientesRoutes = require('./routes/clientes');
const prestamosRoutes = require('./routes/prestamos');
const pagosRoutes = require('./routes/pagos');
const fondeoRoutes = require('./routes/fondeo');
const auditoriaRoutes = require('./routes/auditoria');
const configRoutes = require('./routes/config');
const resetRoutes = require('./routes/reset');

const app = express();

app.use(express.json());
app.use(cookieParser());

// Conecta a Mongo y siembra el usuario admin en cada request (barato: cacheado tras la
// primera llamada, ver db.js / ensureConfig.js). Necesario en el modelo serverless donde
// no hay un "arranque" único como en un servidor tradicional siempre activo.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    await ensureConfig();
    next();
  } catch (e) {
    console.error('Error de conexión a la base de datos:', e.message);
    res.status(500).json({ error: 'Error de conexión a la base de datos' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);

// Todo lo demás bajo /api requiere sesión válida.
app.use('/api/state', requireAuth, stateRoutes);
app.use('/api/clientes', requireAuth, clientesRoutes);
app.use('/api/prestamos', requireAuth, prestamosRoutes);
app.use('/api/pagos', requireAuth, pagosRoutes);
app.use('/api/fondeo', requireAuth, fondeoRoutes);
app.use('/api/auditoria', requireAuth, auditoriaRoutes);
app.use('/api/config', requireAuth, configRoutes);
app.use('/api/reset', requireAuth, resetRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

module.exports = app;
