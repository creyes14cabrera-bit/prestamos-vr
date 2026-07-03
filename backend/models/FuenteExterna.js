const mongoose = require('mongoose');

const fuenteSchema = new mongoose.Schema({
  idNum: { type: Number, required: true, unique: true, index: true },
  prestamista: { type: String, required: true },
  monto: { type: Number, required: true },
  tasaInteres: { type: Number, required: true },
  frecuencia: { type: String, required: true },
  fechaInicio: { type: String, required: true },
  estado: { type: String, default: 'activo' }, // activo | pagado | cancelado
  notas: { type: String, default: '' },
  saldo: { type: Number, required: true },
  interesesPagados: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.models.FuenteExterna || mongoose.model('FuenteExterna', fuenteSchema);
