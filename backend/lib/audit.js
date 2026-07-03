const Auditoria = require('../models/Auditoria');

// Equivalente a audit() del original: inserta un registro y mantiene como máximo 500
// (los más antiguos se recortan) para no crecer indefinidamente.
async function audit(accion, detalle, tipo = 'info') {
  await Auditoria.create({
    fecha: new Date().toLocaleString('es-CO'),
    accion,
    detalle,
    tipo
  });
  const count = await Auditoria.countDocuments();
  if (count > 500) {
    const excedente = count - 500;
    const viejos = await Auditoria.find().sort({ createdAt: 1 }).limit(excedente).select('_id');
    await Auditoria.deleteMany({ _id: { $in: viejos.map((v) => v._id) } });
  }
}

module.exports = { audit };
