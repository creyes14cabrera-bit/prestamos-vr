const express = require('express');
const Config = require('../models/Config');
const { audit } = require('../lib/audit');
const serialize = require('../lib/serialize');

const router = express.Router();

router.get('/', async (req, res) => {
  const cfg = await Config.findById('config');
  res.json(serialize.cfg(cfg));
});

// PUT /api/config — equivalente a btn-save-cfg y a guardarCapital (m-capital).
router.put('/', async (req, res) => {
  const cfg = await Config.findById('config');
  const { capitalBase, interes, gracia, minimo, moratoria, frec } = req.body || {};

  if (capitalBase !== undefined) {
    const v = +capitalBase;
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'Capital base inválido' });
    cfg.capitalBase = v;
  }
  if (interes !== undefined) cfg.interes = +interes || 10;
  if (gracia !== undefined) cfg.gracia = +gracia || 5;
  if (minimo !== undefined) cfg.minimo = +minimo || 0;
  if (moratoria !== undefined) cfg.moratoria = +moratoria || 3;
  if (frec !== undefined) cfg.frec = frec;

  await cfg.save();
  await audit('config', 'Configuración actualizada', 'config');
  res.json(serialize.cfg(cfg));
});

module.exports = router;
