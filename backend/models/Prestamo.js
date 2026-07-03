const mongoose = require('mongoose');

const cuotaSchema = new mongoose.Schema({
  numero: Number,
  fechaVence: String,
  capital: { type: Number, default: 0 },
  interes: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  saldoAntes: Number,
  estado: { type: String, default: 'pendiente' }, // pendiente | pagado
  etiqueta: String
}, { _id: false });

const disbursementSchema = new mongoose.Schema({
  fecha: String,
  monto: Number,
  concepto: String,
  saldoAnterior: Number,
  saldoNuevo: Number
}, { _id: false });

const prestamoSchema = new mongoose.Schema({
  idNum: { type: Number, required: true, unique: true, index: true },
  clienteId: { type: Number, required: true, index: true }, // idNum de Cliente
  clienteNombre: { type: String, required: true },
  monto: { type: Number, required: true },
  saldo: { type: Number, required: true },
  garantias: { type: [String], default: [] },
  requisitos: { type: mongoose.Schema.Types.Mixed, default: {} },
  interes: { type: Number, required: true },
  frecuencia: { type: String, required: true }, // diario | semanal | quincenal | mensual
  fechaInicio: { type: String, required: true },
  estado: { type: String, default: 'activo' }, // activo | moroso | pagado
  diasMora: { type: Number, default: 0 },
  numCuota: { type: Number, default: 0 }, // contador de cuotas pagadas para tipo rotativo
  notas: { type: String, default: '' },
  tipo: { type: String, required: true }, // rotativo | amortizable
  abonoCapital: { type: Number, default: 0 },
  interesesPendientes: { type: Number, default: 0 },
  fuenteExternaId: { type: Number, default: null }, // idNum de FuenteExterna
  gananciaNetaAcumulada: { type: Number, default: 0 },
  numCuotas: { type: Number, default: null },
  plazoMeses: { type: Number, default: null },
  cuotaMonto: { type: Number, default: null }, // solo rotativo
  proximoPago: { type: String, default: null },
  cuotas: { type: [cuotaSchema], default: [] },
  extraDisbursements: { type: [disbursementSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.models.Prestamo || mongoose.model('Prestamo', prestamoSchema);
