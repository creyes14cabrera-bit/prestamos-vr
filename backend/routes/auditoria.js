const express = require('express');
const Auditoria = require('../models/Auditoria');
const serialize = require('../lib/serialize');

const router = express.Router();

router.get('/', async (req, res) => {
  const items = await Auditoria.find().sort({ createdAt: -1 }).limit(500);
  res.json(items.map(serialize.auditoria));
});

// DELETE /api/auditoria — equivalente a btn-clr-audit.
router.delete('/', async (req, res) => {
  await Auditoria.deleteMany({});
  res.json({ ok: true });
});

module.exports = router;
