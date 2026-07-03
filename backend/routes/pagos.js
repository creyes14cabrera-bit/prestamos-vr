const express = require('express');
const Pago = require('../models/Pago');
const Config = require('../models/Config');
const { audit } = require('../lib/audit');
const serialize = require('../lib/serialize');

const router = express.Router();

// PUT /api/pagos/:id — equivalente a saveEditPayment().
router.put('/:id', async (req, res) => {
  const pg = await Pago.findOne({ idNum: +req.params.id });
  if (!pg) return res.status(404).json({ error: 'Pago no encontrado' });

  const { monto, capital, interes, fecha, metodo, referencia } = req.body || {};
  const newMonto = +monto, newCapital = +capital, newInteres = +interes;
  if (newMonto < 0 || newCapital < 0 || newInteres < 0) {
    return res.status(400).json({ error: 'Valores negativos no permitidos' });
  }

  const oldInteres = pg.intereses || 0;
  if (oldInteres !== newInteres) {
    const cfg = await Config.findById('config');
    cfg.ganancias = (cfg.ganancias || 0) - oldInteres + newInteres;
    await cfg.save();
  }

  pg.monto = newMonto;
  pg.capital = newCapital;
  pg.intereses = newInteres;
  pg.fechaPago = fecha;
  pg.metodo = metodo;
  pg.referencia = referencia;
  await pg.save();

  await audit('pago', `Pago #${pg.idNum} EDITADO`, 'pago');
  res.json(serialize.pago(pg));
});

module.exports = router;
