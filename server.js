// Entry point para desarrollo local: la misma app Express de backend/app.js, más el
// servido estático de /public (en Vercel esto último lo hace la plataforma directamente).
require('dotenv').config();
const path = require('path');
const express = require('express');
const app = require('./backend/app');

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ PRÉSTAMOS VR corriendo en http://localhost:${PORT}`);
});
