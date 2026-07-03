const mongoose = require('mongoose');

// Genera IDs numéricos cortos y legibles (#1, #2…) equivalentes a los contadores
// `S.ids.c/p/pg/f` del localStorage original, en vez de exponer ObjectIds de Mongo.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // nombre del contador: 'cliente' | 'prestamo' | 'pago' | 'fuente'
  seq: { type: Number, default: 0 }
});

const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

async function nextId(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

module.exports = { Counter, nextId };
