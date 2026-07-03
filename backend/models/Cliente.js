const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
  idNum: { type: Number, required: true, unique: true, index: true },
  nombre: { type: String, required: true },
  cedula: { type: String, required: true },
  telefono: { type: String, required: true },
  email: { type: String, default: '' },
  direccion: { type: String, default: '' },
  empresa: { type: String, default: '' },
  ingresos: { type: Number, default: 0 },
  estado: { type: String, default: 'activo' }, // activo | moroso | inactivo
  fechaReg: { type: String, required: true }
});

module.exports = mongoose.models.Cliente || mongoose.model('Cliente', clienteSchema);
