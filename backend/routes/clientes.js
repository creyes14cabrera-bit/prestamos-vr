const express = require('express');
const Cliente = require('../models/Cliente');
const { nextId } = require('../models/Counter');
const { hoy } = require('../lib/calc');
const { audit } = require('../lib/audit');
const serialize = require('../lib/serialize');

const router = express.Router();

// POST /api/clientes — equivalente a saveCli() (creación) y al alta rápida (btn-sv-cr).
router.post('/', async (req, res) => {
  const { nombre, cedula, telefono, email, direccion, empresa, ingresos } = req.body || {};
  if (!nombre || !String(nombre).trim() || !cedula || !String(cedula).trim() || !telefono || !String(telefono).trim()) {
    return res.status(400).json({ error: 'Complete campos obligatorios' });
  }

  const idNum = await nextId('cliente');
  const c = await Cliente.create({
    idNum,
    nombre: nombre.trim(),
    cedula: cedula.trim(),
    telefono: telefono.trim(),
    email: (email || '').trim(),
    direccion: (direccion || '').trim(),
    empresa: (empresa || '').trim(),
    ingresos: +ingresos || 0,
    estado: 'activo',
    fechaReg: hoy()
  });

  await audit('cliente', `Nuevo: ${c.nombre} (${c.cedula})`, 'cliente');
  res.status(201).json(serialize.cliente(c));
});

// PUT /api/clientes/:id — equivalente a saveCli() (edición).
router.put('/:id', async (req, res) => {
  const idNum = +req.params.id;
  const c = await Cliente.findOne({ idNum });
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });

  const { nombre, cedula, telefono, email, direccion, empresa, ingresos, estado } = req.body || {};
  if (!nombre || !String(nombre).trim() || !cedula || !String(cedula).trim() || !telefono || !String(telefono).trim()) {
    return res.status(400).json({ error: 'Complete campos obligatorios' });
  }

  c.nombre = nombre.trim();
  c.cedula = cedula.trim();
  c.telefono = telefono.trim();
  c.email = (email || '').trim();
  c.direccion = (direccion || '').trim();
  c.empresa = (empresa || '').trim();
  c.ingresos = +ingresos || 0;
  if (estado) c.estado = estado;
  await c.save();

  await audit('cliente', `Editado: ${c.nombre}`, 'cliente');
  res.json(serialize.cliente(c));
});

module.exports = router;
