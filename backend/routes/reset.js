const express = require('express');
const bcrypt = require('bcryptjs');
const Cliente = require('../models/Cliente');
const Prestamo = require('../models/Prestamo');
const Pago = require('../models/Pago');
const FuenteExterna = require('../models/FuenteExterna');
const Auditoria = require('../models/Auditoria');
const Config = require('../models/Config');
const { Counter } = require('../models/Counter');

const router = express.Router();

// POST /api/reset — equivalente a btn-do-reiniciar. Requiere texto exacto de confirmación,
// igual que el modal original que exige escribir "REINICIAR".
router.post('/', async (req, res) => {
  if ((req.body && req.body.confirm) !== 'REINICIAR') {
    return res.status(400).json({ error: 'Confirmación inválida' });
  }

  await Promise.all([
    Cliente.deleteMany({}),
    Prestamo.deleteMany({}),
    Pago.deleteMany({}),
    FuenteExterna.deleteMany({}),
    Auditoria.deleteMany({}),
    Counter.deleteMany({})
  ]);

  const user = process.env.ADMIN_USER || 'admi';
  const pass = process.env.ADMIN_PASS || '12345';
  const passHash = await bcrypt.hash(pass, 10);

  await Config.findByIdAndUpdate(
    'config',
    {
      capitalBase: 0,
      ganancias: 0,
      interes: 10,
      gracia: 5,
      minimo: 50000,
      moratoria: 3,
      frec: 'quincenal',
      auth: { user, passHash }
    },
    { upsert: true }
  );

  await Auditoria.create({ fecha: new Date().toLocaleString('es-CO'), accion: 'sistema', detalle: 'Sistema reiniciado', tipo: 'sistema' });

  res.json({ ok: true });
});

module.exports = router;
