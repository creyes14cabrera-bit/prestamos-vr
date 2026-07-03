const mongoose = require('mongoose');

const pagoSchema = new mongoose.Schema({
  idNum: { type: Number, required: true, unique: true, index: true },
  prestamoId: { type: Number, required: true, index: true },
  clienteId: { type: Number, required: true },
  clienteNombre: { type: String, required: true },
  numCuota: { type: Number, default: 0 },
  monto: { type: Number, required: true },
  capital: { type: Number, default: 0 },
  intereses: { type: Number, default: 0 },
  intPendienteAntes: { type: Number, default: 0 },
  intPendienteQuedo: { type: Number, default: 0 },
  tipoPago: { type: String, required: true },
  metodo: { type: String, default: 'efectivo' },
  referencia: { type: String, default: '' },
  fechaPago: { type: String, required: true },
  estado: { type: String, default: 'pagado' }
}, { timestamps: true });

module.exports = mongoose.models.Pago || mongoose.model('Pago', pagoSchema);
