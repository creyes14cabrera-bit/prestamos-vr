const express = require('express');
const FuenteExterna = require('../models/FuenteExterna');
const { nextId } = require('../models/Counter');
const { audit } = require('../lib/audit');
const serialize = require('../lib/serialize');

const router = express.Router();

// POST /api/fondeo — equivalente a guardarFuente() (creación).
router.post('/', async (req, res) => {
  const { prestamista, monto, tasaInteres, frecuencia, fechaInicio, estado, notas } = req.body || {};
  const m = +monto, t = +tasaInteres;
  if (!prestamista || !String(prestamista).trim() || !m || !t || !fechaInicio) {
    return res.status(400).json({ error: 'Complete todos los campos obligatorios' });
  }

  const idNum = await nextId('fuente');
  const f = await FuenteExterna.create({
    idNum,
    prestamista: prestamista.trim(),
    monto: m,
    tasaInteres: t,
    frecuencia,
    fechaInicio,
    estado: estado || 'activo',
    notas: notas || '',
    saldo: m,
    interesesPagados: 0
  });

  await audit('fondeo', `Fuente ${f.prestamista} creada — $${m}`, 'fondeo');
  res.status(201).json(serialize.fuente(f));
});

// PUT /api/fondeo/:id — equivalente a guardarFuente() (edición).
router.put('/:id', async (req, res) => {
  const f = await FuenteExterna.findOne({ idNum: +req.params.id });
  if (!f) return res.status(404).json({ error: 'Fuente no encontrada' });

  const { prestamista, monto, tasaInteres, frecuencia, fechaInicio, estado, notas } = req.body || {};
  const m = +monto, t = +tasaInteres;
  if (!prestamista || !String(prestamista).trim() || !m || !t || !fechaInicio) {
    return res.status(400).json({ error: 'Complete todos los campos obligatorios' });
  }

  const dif = m - f.monto;
  f.saldo = f.saldo + dif;
  f.prestamista = prestamista.trim();
  f.monto = m;
  f.tasaInteres = t;
  f.frecuencia = frecuencia;
  f.fechaInicio = fechaInicio;
  f.estado = estado;
  f.notas = notas || '';
  await f.save();

  await audit('fondeo', `Fuente ${f.prestamista} editada — $${m}`, 'fondeo');
  res.json(serialize.fuente(f));
});

// DELETE /api/fondeo/:id — equivalente a eliminarFuente().
router.delete('/:id', async (req, res) => {
  const idNum = +req.params.id;
  const f = await FuenteExterna.findOneAndDelete({ idNum });
  if (!f) return res.status(404).json({ error: 'Fuente no encontrada' });
  await audit('fondeo', `Fuente #${idNum} eliminada`, 'fondeo');
  res.json({ ok: true });
});

// POST /api/fondeo/:id/pago — equivalente a confirmarPagoFuente().
router.post('/:id/pago', async (req, res) => {
  const f = await FuenteExterna.findOne({ idNum: +req.params.id });
  if (!f) return res.status(404).json({ error: 'Fuente no encontrada' });

  const monto = +(req.body && req.body.monto) || 0;
  if (monto <= 0 || monto > f.saldo) return res.status(400).json({ error: 'Monto inválido' });

  f.saldo -= monto;
  f.interesesPagados = (f.interesesPagados || 0) + monto;
  if (f.saldo <= 0) f.estado = 'pagado';
  await f.save();

  await audit('fondeo', `Pago a fuente ${f.prestamista} — $${monto}`, 'fondeo');
  res.json(serialize.fuente(f));
});

module.exports = router;
