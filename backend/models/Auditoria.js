const mongoose = require('mongoose');

const auditoriaSchema = new mongoose.Schema({
  fecha: { type: String, required: true }, // string formateado es-CO, igual que el original
  accion: { type: String, required: true },
  detalle: { type: String, default: '' },
  tipo: { type: String, default: 'info' }
}, { timestamps: true });

module.exports = mongoose.models.Auditoria || mongoose.model('Auditoria', auditoriaSchema);
