const { COOKIE_NAME, verifySession } = require('../lib/authUtil');

// Protege todas las rutas /api/* excepto /api/auth/login (montada antes de este middleware).
module.exports = function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = verifySession(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};
