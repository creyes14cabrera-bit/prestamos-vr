const mongoose = require('mongoose');

// Documento singleton (siempre _id: 'config') — equivalente a S.cfg + S.creds del original.
const configSchema = new mongoose.Schema({
  _id: { type: String, default: 'config' },
  capitalBase: { type: Number, default: 0 },
  // A diferencia del resto de cifras de capital (que se calculan solas), este campo lo
  // establece el usuario directamente — no se deriva de nada. Si no lo define, queda en 0.
  capitalDisponible: { type: Number, default: 0 },
  ganancias: { type: Number, default: 0 },
  interes: { type: Number, default: 10 },
  gracia: { type: Number, default: 5 },
  minimo: { type: Number, default: 50000 },
  moratoria: { type: Number, default: 3 },
  frec: { type: String, default: 'quincenal' },
  auth: {
    user: { type: String, required: true },
    passHash: { type: String, required: true }
  }
});

module.exports = mongoose.models.Config || mongoose.model('Config', configSchema);
