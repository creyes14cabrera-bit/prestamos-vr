// Motor de cálculo financiero — puerto 1:1 de las funciones homónimas que vivían en el
// <script> inline de index.html (roundM, tasaP, genCuotas, checkMora, calcularCapital).
// Se mantiene la misma aritmética para no cambiar el comportamiento de los créditos existentes.

const roundM = (x) => Math.round(x / 1000) * 1000;

const hoy = () => new Date().toISOString().split('T')[0];

const difD = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

function tasaP(intMes, frec) {
  const t = intMes / 100;
  if (frec === 'diario') return t / 30;
  if (frec === 'semanal') return t / 4;
  if (frec === 'quincenal') return t / 2;
  return t;
}

// pre: { tipo, fechaInicio, monto, numCuotas, interes, abonoCapital, frecuencia, plazoMeses }
// Devuelve { cuotas, proximoPago } — no muta `pre`.
function genCuotas(pre) {
  if (pre.tipo !== 'amortizable') return { cuotas: [], proximoPago: null };
  const fi = new Date(pre.fechaInicio + 'T12:00:00');
  const monto = pre.monto;
  const numCuotas = pre.numCuotas;
  const tasa = pre.interes / 100;
  const abono = pre.abonoCapital || 0;
  let cuotas = [];

  if (pre.frecuencia === 'quincenal') {
    const numMeses = Math.ceil(numCuotas / 2);
    let saldo = monto;
    for (let m = 0; m < numMeses; m++) {
      const intMes = saldo * tasa;
      const intQ = roundM(intMes / 2);
      const abonoEf = roundM(Math.min(abono, saldo));
      const fQ1 = new Date(fi);
      fQ1.setDate(fQ1.getDate() + m * 30);
      cuotas.push({
        numero: m * 2 + 1,
        fechaVence: fQ1.toISOString().split('T')[0],
        capital: 0,
        interes: intQ,
        total: intQ,
        saldoAntes: saldo,
        estado: 'pendiente',
        etiqueta: `Mes ${m + 1} — 1ª quincena (solo interés)`
      });
      const fQ2 = new Date(fi);
      fQ2.setDate(fQ2.getDate() + m * 30 + 15);
      cuotas.push({
        numero: m * 2 + 2,
        fechaVence: fQ2.toISOString().split('T')[0],
        capital: abonoEf,
        interes: intQ,
        total: intQ + abonoEf,
        saldoAntes: saldo,
        estado: 'pendiente',
        etiqueta: `Mes ${m + 1} — 2ª quincena${abonoEf > 0 ? ' (interés + abono $' + abonoEf + ')' : ' (interés)'}`
      });
      saldo = Math.max(0, saldo - abonoEf);
      if (saldo <= 0) break;
    }
    cuotas = cuotas.slice(0, numCuotas);
  } else {
    const fcMeses = pre.frecuencia === 'diario' ? 30 : pre.frecuencia === 'semanal' ? 4 : pre.frecuencia === 'quincenal' ? 2 : 1;
    const plazoMeses = pre.plazoMeses || numCuotas / fcMeses;
    const intTotal = monto * (pre.interes / 100) * plazoMeses;
    const totalPagar = monto + intTotal;
    const cuotaExacta = totalPagar / numCuotas;
    const capCuota = monto / numCuotas;
    const intCuota = intTotal / numCuotas;
    for (let i = 1; i <= numCuotas; i++) {
      const fv = new Date(fi);
      if (pre.frecuencia === 'diario') fv.setDate(fv.getDate() + i);
      else if (pre.frecuencia === 'semanal') fv.setDate(fv.getDate() + i * 7);
      else fv.setMonth(fv.getMonth() + i);
      cuotas.push({
        numero: i,
        fechaVence: fv.toISOString().split('T')[0],
        capital: capCuota,
        interes: intCuota,
        total: cuotaExacta,
        estado: 'pendiente'
      });
    }
  }
  return { cuotas, proximoPago: cuotas[0]?.fechaVence || null };
}

// Recalcula estado ('activo'|'moroso'|'pagado') y diasMora de un préstamo en memoria,
// igual que hacía checkMora() sobre S.prestamos en cada upd(). No persiste — el llamador
// decide si guarda los cambios.
function checkMoraUno(p, gracia, h = hoy()) {
  if (p.estado === 'pagado') return p;
  if (p.tipo === 'amortizable' && p.cuotas) {
    const pend = p.cuotas.filter((c) => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
    if (!pend.length && (p.interesesPendientes || 0) <= 0) {
      p.estado = 'pagado';
      p.diasMora = 0;
      return p;
    }
    if (!pend.length) {
      p.estado = 'activo';
      p.diasMora = 0;
      return p;
    }
    const dias = difD(pend[0].fechaVence, h);
    if (dias > (gracia || 5)) {
      p.estado = 'moroso';
      p.diasMora = dias;
    } else {
      p.estado = 'activo';
      p.diasMora = 0;
    }
  } else if (p.tipo === 'rotativo') {
    if (!p.proximoPago) return p;
    const dias = difD(p.proximoPago, h);
    if (dias > (gracia || 5)) {
      p.estado = 'moroso';
      p.diasMora = dias;
    } else {
      p.estado = 'activo';
      p.diasMora = 0;
    }
  }
  return p;
}

function checkMora(prestamos, gracia, h = hoy()) {
  prestamos.forEach((p) => checkMoraUno(p, gracia, h));
  return prestamos;
}

function calcularCapital(cfg, fuentesExternas, prestamos) {
  const base = cfg.capitalBase || 0;
  const ganancias = cfg.ganancias || 0;
  const activos = prestamos.filter((p) => p.estado !== 'pagado');
  // Todo crédito que no esté fondeado por un tercero sale de capital propio.
  const saldoPropioEnCalle = activos.filter((p) => !p.fuenteExternaId).reduce((a, p) => a + p.saldo, 0);
  const capitalPropio = base + ganancias + saldoPropioEnCalle;
  const capitalExterno = fuentesExternas.filter((f) => f.estado === 'activo').reduce((a, f) => a + f.saldo, 0);
  const capitalTotal = capitalPropio + capitalExterno;
  const saldoActivo = activos.reduce((a, p) => a + p.saldo, 0);
  // A diferencia de las demás cifras, esta no se calcula: la establece el usuario
  // directamente (Configuración > Parámetros) y si no la define queda en 0.
  const capitalDisponible = cfg.capitalDisponible || 0;
  return { base, ganancias, capitalPropio, capitalExterno, capitalTotal, capitalDisponible, saldoActivo };
}

// Recalcula interés/capital/total de las cuotas pendientes de un préstamo amortizable a
// partir de su `saldo` actual (ya modificado por quien llama). Misma lógica que usaba
// confirmDisbursement() para reacomodar el plan de pagos tras un desembolso extra; se
// reutiliza aquí para cualquier operación que cambie el saldo fuera del ciclo normal de
// cuota-por-cuota (abono extra, pago personalizado, sumar intereses al capital).
function redistribuirCuotasPendientes(p) {
  if (p.tipo !== 'amortizable' || !p.cuotas || !p.cuotas.length) return;
  const pend = p.cuotas.filter((c) => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
  if (!pend.length) return;
  const tasa = p.interes / 100;
  if (p.frecuencia === 'quincenal') {
    let saldoTemp = p.saldo;
    for (let i = 0; i < pend.length; i++) {
      const esSegunda = pend[i].numero % 2 === 0;
      const intQ = roundM((saldoTemp * tasa) / 2);
      const ab = esSegunda && p.abonoCapital > 0 ? roundM(Math.min(p.abonoCapital, saldoTemp)) : 0;
      pend[i].interes = intQ;
      pend[i].capital = ab;
      pend[i].total = intQ + ab;
      saldoTemp = Math.max(0, saldoTemp - ab);
    }
  } else {
    const fcMeses = p.frecuencia === 'diario' ? 30 : p.frecuencia === 'semanal' ? 4 : p.frecuencia === 'quincenal' ? 2 : 1;
    const mesesRest = pend.length / fcMeses;
    const intTotal = p.saldo * tasa * mesesRest;
    const cuotaEx = (p.saldo + intTotal) / pend.length;
    const capCuota = p.saldo / pend.length;
    const intCuota = intTotal / pend.length;
    for (const c of pend) {
      c.capital = capCuota;
      c.interes = intCuota;
      c.total = cuotaEx;
    }
  }
}

module.exports = { roundM, hoy, difD, tasaP, genCuotas, checkMora, checkMoraUno, calcularCapital, redistribuirCuotasPendientes };
