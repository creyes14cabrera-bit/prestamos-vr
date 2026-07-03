const mongoose = require('mongoose');

// En serverless (Vercel) cada invocación puede reusar el mismo proceso Node, así que
// cacheamos la conexión/promesa en `global` para no reconectar en cada request.
let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('Falta la variable de entorno MONGO_URI');

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, { bufferCommands: false })
      .then((m) => m)
      .catch((err) => {
        // Si la conexión falla, no dejamos la promesa rota cacheada — si no, esta
        // instancia serverless reintentaría el mismo error para siempre.
        cached.promise = null;
        throw err;
      });
  }
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}

module.exports = connectDB;
