// Único punto de entrada serverless en Vercel. Todas las rutas /api/* llegan aquí
// gracias al rewrite definido en vercel.json, y las maneja la app Express completa.
require('dotenv').config();
module.exports = require('../backend/app');
