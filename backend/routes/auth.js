const express = require('express');
const bcrypt = require('bcryptjs');
const Config = require('../models/Config');
const requireAuth = require('../middleware/auth');
const { signSession, setSessionCookie, clearSessionCookie } = require('../lib/authUtil');
const { audit } = require('../lib/audit');

const router = express.Router();

// POST /api/auth/login — sin protección, es el único punto de entrada público.
router.post('/login', async (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const cfg = await Config.findById('config');
  if (!cfg || cfg.auth.user !== user) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const ok = await bcrypt.compare(pass, cfg.auth.passHash);
  if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = signSession({ user });
  setSessionCookie(res, token);
  res.json({ ok: true, user });
});

router.post('/logout', requireAuth, (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.user });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { pass } = req.body || {};
  if (!pass || !pass.trim()) return res.status(400).json({ error: 'Ingrese contraseña' });

  const cfg = await Config.findById('config');
  cfg.auth.passHash = await bcrypt.hash(pass, 10);
  await cfg.save();
  await audit('config', 'Contraseña de acceso actualizada', 'config');
  res.json({ ok: true });
});

module.exports = router;
