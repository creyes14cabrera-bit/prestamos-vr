const bcrypt = require('bcryptjs');
const Config = require('../models/Config');

// Crea el documento singleton de Config la primera vez que arranca el sistema, sembrando
// el usuario/clave admin desde variables de entorno (equivalente al S.creds inicial).
async function ensureConfig() {
  let cfg = await Config.findById('config');
  if (cfg) return cfg;

  const user = process.env.ADMIN_USER || 'admi';
  const pass = process.env.ADMIN_PASS || '12345';
  const passHash = await bcrypt.hash(pass, 10);

  cfg = await Config.create({
    _id: 'config',
    capitalBase: 0,
    ganancias: 0,
    interes: 10,
    gracia: 5,
    minimo: 50000,
    moratoria: 3,
    frec: 'quincenal',
    auth: { user, passHash }
  });
  return cfg;
}

module.exports = ensureConfig;
