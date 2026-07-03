const express = require('express');
const Cliente = require('../models/Cliente');
const Prestamo = require('../models/Prestamo');
const Pago = require('../models/Pago');
const FuenteExterna = require('../models/FuenteExterna');
const Auditoria = require('../models/Auditoria');
const Config = require('../models/Config');
const { checkMora } = require('../lib/calc');
const serialize = require('../lib/serialize');

const router = express.Router();

// Recalcula estado/diasMora de mora igual que hacía checkMora() en cada upd() del
// original, y persiste los cambios para que el resto de endpoints (dashboard, etc.)
// vean el estado ya actualizado.
async function refreshMora(cfg) {
  const prestamos = await Prestamo.find({ estado: { $ne: 'pagado' } });
  const plain = prestamos.map((p) => p.toObject());
  checkMora(plain, cfg.gracia);

  const ops = plain
    .filter((p, i) => p.estado !== prestamos[i].estado || p.diasMora !== prestamos[i].diasMora)
    .map((p) => ({
      updateOne: { filter: { idNum: p.idNum }, update: { estado: p.estado, diasMora: p.diasMora } }
    }));
  if (ops.length) await Prestamo.bulkWrite(ops);
}

// GET /api/state — bootstrap completo, equivalente a cargar() + checkMora() del original.
router.get('/', async (req, res) => {
  const cfg = await Config.findById('config');
  await refreshMora(cfg);

  const [clientes, prestamos, pagos, fuentesExternas, auditoria] = await Promise.all([
    Cliente.find().sort({ idNum: 1 }),
    Prestamo.find().sort({ idNum: 1 }),
    Pago.find().sort({ idNum: 1 }),
    FuenteExterna.find().sort({ idNum: 1 }),
    Auditoria.find().sort({ createdAt: -1 }).limit(500)
  ]);

  res.json({
    cfg: serialize.cfg(cfg),
    clientes: clientes.map(serialize.cliente),
    prestamos: prestamos.map(serialize.prestamo),
    pagos: pagos.map(serialize.pago),
    fuentesExternas: fuentesExternas.map(serialize.fuente),
    auditoria: auditoria.map(serialize.auditoria)
  });
});

module.exports = router;
