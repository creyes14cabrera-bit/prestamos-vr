const express = require('express');
const Cliente = require('../models/Cliente');
const Prestamo = require('../models/Prestamo');
const Pago = require('../models/Pago');
const FuenteExterna = require('../models/FuenteExterna');
const Config = require('../models/Config');
const { nextId } = require('../models/Counter');
const { roundM, hoy, tasaP, genCuotas, redistribuirCuotasPendientes } = require('../lib/calc');
const { audit } = require('../lib/audit');
const serialize = require('../lib/serialize');

const router = express.Router();

const REQUIRED_FIELDS = {
  tarjeta: ['numero', 'banco'],
  letra: ['descripcion'],
  hipoteca: ['direccion'],
  prendario: ['bien'],
  personal: ['codeudor', 'cedula']
};

// `fuente.saldo` representa el monto que el negocio aún le debe al prestamista externo
// (solo baja cuando se le paga con pagarFuente/confirmarPagoFuente). La capacidad que
// todavía se puede asignar a créditos NUEVOS es ese saldo menos lo que ya está
// comprometido en créditos activos fondeados por esa misma fuente.
async function capacidadFuenteDisponible(fuente, excluirPrestamoId = null) {
  const filtro = { fuenteExternaId: fuente.idNum, estado: { $ne: 'pagado' } };
  if (excluirPrestamoId) filtro.idNum = { $ne: excluirPrestamoId };
  const activos = await Prestamo.find(filtro);
  const asignado = activos.reduce((a, p) => a + p.saldo, 0);
  return fuente.saldo - asignado;
}

// POST /api/prestamos — equivalente a savePre().
router.post('/', async (req, res) => {
  const cfg = await Config.findById('config');
  const { clienteId, monto: montoRaw, garantias, requisitos, interes, frecuencia, fechaInicio, tipo, notas, tieneAbono, abono, fuenteId, plazo, ncuotas } = req.body || {};

  const cli = await Cliente.findOne({ idNum: +clienteId });
  if (!cli) return res.status(400).json({ error: 'Seleccione un cliente válido' });

  let monto = +montoRaw;
  if (!monto || monto < (cfg.minimo || 0)) {
    return res.status(400).json({ error: `Monto mínimo: $${cfg.minimo}` });
  }
  monto = roundM(monto);

  // No se bloquea la creación por falta de capital propio: el negocio puede empezar a
  // prestar sin haber configurado un capital base, y el Dashboard ya avisa con la alerta
  // de "Capital disponible negativo" cuando lo prestado supera el capital cargado. Lo
  // único que sigue siendo un límite duro es no exceder lo que una fuente externa
  // específica tiene realmente disponible (eso sí es una restricción real del prestamista).
  let fuente = null;
  if (fuenteId) {
    fuente = await FuenteExterna.findOne({ idNum: +fuenteId });
    if (!fuente || fuente.estado !== 'activo') return res.status(400).json({ error: 'Fuente externa no válida o inactiva' });
    const disponible = await capacidadFuenteDisponible(fuente);
    if (monto > disponible) return res.status(400).json({ error: `La fuente solo tiene $${disponible} disponibles sin asignar` });
  }

  const gars = Array.isArray(garantias) ? garantias : [];
  if (!gars.length) return res.status(400).json({ error: 'Seleccione al menos una garantía' });
  for (const g of gars) {
    const req_ = REQUIRED_FIELDS[g] || [];
    const datos = (requisitos && requisitos[g]) || {};
    for (const f of req_) {
      if (!datos[f] || !String(datos[f]).trim()) return res.status(400).json({ error: `Complete datos de garantía: ${g}` });
    }
  }

  const int = +interes;
  const frec = frecuencia;
  const fecha = fechaInicio;
  const abonoCapital = frec === 'quincenal' && tieneAbono ? roundM(+abono || 0) : 0;

  const idNum = await nextId('prestamo');
  const pre = {
    idNum,
    clienteId: cli.idNum,
    clienteNombre: cli.nombre,
    monto,
    saldo: monto,
    garantias: gars,
    requisitos: requisitos || {},
    interes: int,
    frecuencia: frec,
    fechaInicio: fecha,
    estado: 'activo',
    diasMora: 0,
    numCuota: 0,
    notas: notas || '',
    tipo,
    abonoCapital,
    interesesPendientes: 0,
    fuenteExternaId: fuente ? fuente.idNum : null,
    gananciaNetaAcumulada: 0
  };

  if (tipo === 'rotativo') {
    const fp = new Date(fecha + 'T12:00:00');
    if (frec === 'diario') fp.setDate(fp.getDate() + 1);
    else if (frec === 'semanal') fp.setDate(fp.getDate() + 7);
    else if (frec === 'quincenal') fp.setDate(fp.getDate() + 15);
    else fp.setMonth(fp.getMonth() + 1);
    pre.proximoPago = fp.toISOString().split('T')[0];
    pre.cuotaMonto = roundM(pre.monto * tasaP(int, frec));
    pre.numCuotas = null;
  } else {
    const nc = +ncuotas;
    if (!nc) return res.status(400).json({ error: 'Ingrese número de cuotas' });
    if (frec === 'quincenal' && nc % 2 !== 0) {
      return res.status(400).json({ error: 'Para quincenal el número de cuotas debe ser par (2 por mes)' });
    }
    pre.numCuotas = nc;
    const fcMeses = frec === 'diario' ? 30 : frec === 'semanal' ? 4 : frec === 'quincenal' ? 2 : 1;
    pre.plazoMeses = plazo > 0 ? +plazo : nc / fcMeses;
    const { cuotas, proximoPago } = genCuotas(pre);
    pre.cuotas = cuotas;
    pre.proximoPago = proximoPago;
  }

  const doc = await Prestamo.create(pre);

  // Nota: `fuente.saldo` ya no se descuenta aquí — representa lo que se le debe al
  // prestamista externo, no lo "disponible para prestar" (eso se valida arriba con
  // capacidadFuenteDisponible). Descontar aquí Y sumar el crédito a saldoActivo hacía
  // que "Capital Disponible" restara el mismo monto dos veces.

  await audit(
    'credito',
    `Crédito #${doc.idNum} — ${cli.nombre} — $${monto} — ${frec}${abonoCapital > 0 ? ' — abono $' + abonoCapital : ''}${fuente ? ' — Fondeado externamente' : ''}`,
    'credito'
  );
  res.status(201).json(serialize.prestamo(doc));
});

// PUT /api/prestamos/:id — equivalente a editLoan()/btn-sv-editpre.
router.put('/:id', async (req, res) => {
  const p = await Prestamo.findOne({ idNum: +req.params.id });
  if (!p) return res.status(404).json({ error: 'Crédito no encontrado' });

  const { monto, interes, frecuencia, plazo, abono } = req.body || {};
  const newMonto = +monto;
  if (!newMonto || newMonto <= 0) return res.status(400).json({ error: 'Monto inválido' });

  p.monto = newMonto;
  p.interes = +interes;
  p.frecuencia = frecuencia;
  p.abonoCapital = +abono || 0;

  if (p.tipo === 'amortizable') {
    const fcMeses = frecuencia === 'diario' ? 30 : frecuencia === 'semanal' ? 4 : frecuencia === 'quincenal' ? 2 : 1;
    const newPlazo = +plazo;
    p.plazoMeses = newPlazo;
    p.numCuotas = Math.round(newPlazo * fcMeses);
    const pagadas = (p.cuotas || []).filter((c) => c.estado === 'pagado');
    const pagadasCapital = pagadas.reduce((a, c) => a + (c.capital || 0), 0);
    p.saldo = Math.max(0, p.monto - pagadasCapital);
    const { cuotas, proximoPago } = genCuotas(p.toObject());
    cuotas.forEach((nc) => {
      if (nc.numero <= pagadas.length) nc.estado = 'pagado';
    });
    p.cuotas = cuotas;
    const pend = cuotas.filter((c) => c.estado === 'pendiente');
    p.proximoPago = pend.length ? pend[0].fechaVence : proximoPago;
  } else {
    const fp = new Date(p.fechaInicio + 'T12:00:00');
    if (frecuencia === 'diario') fp.setDate(fp.getDate() + 1);
    else if (frecuencia === 'semanal') fp.setDate(fp.getDate() + 7);
    else if (frecuencia === 'quincenal') fp.setDate(fp.getDate() + 15);
    else fp.setMonth(fp.getMonth() + 1);
    p.proximoPago = fp.toISOString().split('T')[0];
  }

  await p.save();
  await audit('credito', `Crédito #${p.idNum} EDITADO`, 'config');
  res.json(serialize.prestamo(p));
});

// DELETE /api/prestamos/:id — equivalente a deleteLoan().
router.delete('/:id', async (req, res) => {
  const idNum = +req.params.id;
  const p = await Prestamo.findOneAndDelete({ idNum });
  if (!p) return res.status(404).json({ error: 'Crédito no encontrado' });
  await Pago.deleteMany({ prestamoId: idNum });
  await audit('credito', `Crédito #${idNum} eliminado`, 'sistema');
  res.json({ ok: true });
});

// PUT /api/prestamos/:id/cuotas/:numero — equivalente a edición manual de cuota.
router.put('/:id/cuotas/:numero', async (req, res) => {
  const p = await Prestamo.findOne({ idNum: +req.params.id });
  if (!p || !p.cuotas) return res.status(404).json({ error: 'Crédito no encontrado' });
  const cuota = p.cuotas.find((c) => c.numero === +req.params.numero);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });

  const { fecha, capital, interes } = req.body || {};
  const newCap = +capital;
  const newInt = +interes;
  if (!fecha || isNaN(newCap) || isNaN(newInt)) return res.status(400).json({ error: 'Datos inválidos' });

  cuota.fechaVence = fecha;
  cuota.capital = newCap;
  cuota.interes = newInt;
  cuota.total = newCap + newInt;

  p.saldo = p.cuotas.filter((c) => c.estado !== 'pagado').reduce((a, c) => a + c.capital, 0);
  p.estado = p.saldo <= 0 && (p.interesesPendientes || 0) <= 0 ? 'pagado' : 'activo';
  p.cuotas.sort((a, b) => a.numero - b.numero);
  const pend = p.cuotas.filter((c) => c.estado === 'pendiente');
  p.proximoPago = pend.length ? pend[0].fechaVence : null;

  await p.save();
  await audit('credito', `Cuota #${cuota.numero} crédito #${p.idNum} editada`, 'config');
  res.json(serialize.prestamo(p));
});

// POST /api/prestamos/:id/desembolso — equivalente a confirmDisbursement().
router.post('/:id/desembolso', async (req, res) => {
  const p = await Prestamo.findOne({ idNum: +req.params.id });
  if (!p) return res.status(404).json({ error: 'Crédito no encontrado' });

  let extra = +(req.body && req.body.monto);
  if (isNaN(extra) || extra <= 0) return res.status(400).json({ error: 'Monto válido requerido' });
  extra = roundM(extra);

  // Igual que en la creación de créditos: no se bloquea por falta de capital propio.

  const concepto = (req.body.concepto || '').trim() || 'Desembolso adicional';
  const fechaDes = req.body.fecha || hoy();
  p.extraDisbursements = p.extraDisbursements || [];
  p.extraDisbursements.push({ fecha: fechaDes, monto: extra, concepto, saldoAnterior: p.saldo, saldoNuevo: p.saldo + extra });
  p.monto += extra;
  p.saldo += extra;

  redistribuirCuotasPendientes(p);

  await p.save();
  await audit('credito', `Sobre crédito $${extra} a #${p.idNum} (${concepto}) - Nuevo saldo $${p.saldo}`, 'credito');
  res.json(serialize.prestamo(p));
});

// POST /api/prestamos/:id/pagos — equivalente a confPago(), con las 7 opciones de pago
// del modal ya implementadas: cuota, cancelar, sumar_int_capital, abono, vencidas,
// periodos, personalizado, intpendientes.
router.post('/:id/pagos', async (req, res) => {
  const p = await Prestamo.findOne({ idNum: +req.params.id });
  if (!p) return res.status(404).json({ error: 'Crédito no encontrado' });

  const { tipoPago: tp, fecha, metodo, referencia: ref, sumarConfirm, montoExtra, cuotas: cuotasSeleccionadas, interesPagado, capitalPagado, montoIntPend } = req.body || {};
  if (!tp) return res.status(400).json({ error: 'Seleccione opción de pago' });

  const intPendAntesDelPago = p.interesesPendientes || 0;
  let intPendQuedo = intPendAntesDelPago;

  if (tp === 'sumar_int_capital') {
    if (!sumarConfirm) return res.status(400).json({ error: 'Debe marcar la casilla de confirmación' });
    if (intPendAntesDelPago <= 0) return res.status(400).json({ error: 'No hay intereses pendientes para sumar' });

    p.saldo += intPendAntesDelPago;
    p.monto += intPendAntesDelPago;
    p.interesesPendientes = 0;

    if (p.tipo === 'amortizable') {
      const pagadas = (p.cuotas || []).filter((c) => c.estado === 'pagado');
      const { cuotas } = genCuotas(p.toObject());
      cuotas.forEach((nc) => {
        const original = pagadas.find((pg) => pg.numero === nc.numero);
        if (original) nc.estado = 'pagado';
      });
      p.cuotas = cuotas;
      p.saldo = cuotas.filter((c) => c.estado !== 'pagado').reduce((a, c) => a + c.capital, 0);
    }

    await p.save();
    await audit('credito', `Intereses pendientes $${intPendAntesDelPago} sumados al capital del crédito #${p.idNum}. Nuevo saldo: $${p.saldo}`, 'credito');
    return res.json({ prestamo: serialize.prestamo(p) });
  }

  let monto = 0, cap = 0, int = 0, numC = 0, desc = '';

  if (tp === 'cuota') {
    if (p.tipo === 'rotativo') {
      const cuotaNum = (p.numCuota || 0) + 1;
      const esQ2 = p.frecuencia === 'quincenal' && cuotaNum % 2 === 0;
      const intPeriodo = roundM(p.saldo * tasaP(p.interes, p.frecuencia));
      const abQ = esQ2 && p.abonoCapital > 0 ? roundM(Math.min(p.abonoCapital, p.saldo)) : 0;
      int = intPeriodo;
      cap = abQ;
      monto = intPeriodo + abQ;
      p.saldo = Math.max(0, p.saldo - abQ);
      p.numCuota = cuotaNum;
      const fp = new Date(fecha + 'T12:00:00');
      if (p.frecuencia === 'diario') fp.setDate(fp.getDate() + 1);
      else if (p.frecuencia === 'semanal') fp.setDate(fp.getDate() + 7);
      else if (p.frecuencia === 'quincenal') fp.setDate(fp.getDate() + 15);
      else fp.setMonth(fp.getMonth() + 1);
      p.proximoPago = fp.toISOString().split('T')[0];
      desc = `${esQ2 ? '2ª' : '1ª'} quincena — Int $${intPeriodo}${abQ > 0 ? ' + Cap $' + abQ : ''}`;
    } else {
      const pend = (p.cuotas || []).filter((c) => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
      if (!pend.length) return res.status(400).json({ error: 'Sin cuotas pendientes' });
      const prox = pend[0];
      numC = prox.numero;
      monto = prox.total;
      int = prox.interes;
      cap = prox.capital;
      prox.estado = 'pagado';
      p.saldo = Math.max(0, p.saldo - cap);
      desc = prox.etiqueta || `Cuota #${prox.numero}`;
      const pendRest = p.cuotas.filter((c) => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
      p.proximoPago = pendRest.length ? pendRest[0].fechaVence : null;
    }
  } else if (tp === 'cancelar') {
    if (p.tipo === 'rotativo') {
      const intPeriodo = roundM(p.saldo * tasaP(p.interes, p.frecuencia));
      int = intPeriodo;
      cap = p.saldo;
      monto = intPeriodo + p.saldo;
      p.saldo = 0;
      p.estado = 'pagado';
      p.interesesPendientes = 0;
      intPendQuedo = 0;
      desc = 'Cancelación total';
    } else {
      const pend = (p.cuotas || []).filter((c) => c.estado === 'pendiente');
      if (!pend.length) return res.status(400).json({ error: 'Sin cuotas pendientes' });
      monto = pend.reduce((a, c) => a + c.total, 0);
      int = pend.reduce((a, c) => a + c.interes, 0);
      cap = pend.reduce((a, c) => a + c.capital, 0);
      pend.forEach((c) => (c.estado = 'pagado'));
      p.saldo = 0;
      p.estado = 'pagado';
      p.interesesPendientes = 0;
      intPendQuedo = 0;
      desc = 'Cancelación total';
    }
  } else if (tp === 'abono') {
    let extra = +montoExtra;
    if (isNaN(extra) || extra <= 0) return res.status(400).json({ error: 'Ingrese un monto de abono válido' });
    extra = roundM(Math.min(extra, p.saldo));
    if (extra <= 0) return res.status(400).json({ error: 'El crédito no tiene saldo de capital pendiente' });
    cap = extra;
    int = 0;
    monto = extra;
    p.saldo = Math.max(0, p.saldo - extra);
    desc = 'Abono extra a capital';
    redistribuirCuotasPendientes(p);
  } else if (tp === 'vencidas' || tp === 'periodos') {
    if (p.tipo !== 'amortizable' || !p.cuotas || !p.cuotas.length) {
      return res.status(400).json({ error: 'Esta opción solo aplica a créditos amortizables' });
    }
    let sel;
    if (tp === 'vencidas') {
      const h = hoy();
      sel = p.cuotas.filter((c) => c.estado === 'pendiente' && c.fechaVence < h);
      if (!sel.length) return res.status(400).json({ error: 'No hay cuotas vencidas' });
    } else {
      const numeros = (Array.isArray(cuotasSeleccionadas) ? cuotasSeleccionadas : []).map(Number);
      if (!numeros.length) return res.status(400).json({ error: 'Seleccione al menos una cuota' });
      sel = p.cuotas.filter((c) => c.estado === 'pendiente' && numeros.includes(c.numero));
      if (!sel.length) return res.status(400).json({ error: 'Ninguna cuota seleccionada es válida' });
    }
    monto = sel.reduce((a, c) => a + c.total, 0);
    int = sel.reduce((a, c) => a + c.interes, 0);
    cap = sel.reduce((a, c) => a + c.capital, 0);
    sel.forEach((c) => (c.estado = 'pagado'));
    p.saldo = Math.max(0, p.saldo - cap);
    desc = tp === 'vencidas' ? `Pago de ${sel.length} cuota(s) vencida(s)` : `Pago de ${sel.length} cuota(s) seleccionada(s)`;
    const pendRest = p.cuotas.filter((c) => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
    p.proximoPago = pendRest.length ? pendRest[0].fechaVence : null;
  } else if (tp === 'personalizado') {
    const intInput = Math.max(0, +interesPagado || 0);
    const capInput = Math.max(0, +capitalPagado || 0);
    if (intInput <= 0 && capInput <= 0) return res.status(400).json({ error: 'Ingrese al menos un valor de interés o capital' });

    let intRequerido;
    if (p.tipo === 'rotativo') {
      intRequerido = roundM(p.saldo * tasaP(p.interes, p.frecuencia));
    } else {
      const pend = (p.cuotas || []).filter((c) => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
      intRequerido = pend.length ? pend[0].interes : 0;
    }
    const totalIntDue = intRequerido + intPendAntesDelPago;
    int = intInput;
    intPendQuedo = Math.max(0, totalIntDue - intInput);
    cap = roundM(Math.min(capInput, p.saldo));
    monto = intInput + cap;
    p.saldo = Math.max(0, p.saldo - cap);
    p.interesesPendientes = intPendQuedo;
    desc = 'Pago personalizado';

    if (p.tipo === 'rotativo') {
      const cuotaNum = (p.numCuota || 0) + 1;
      p.numCuota = cuotaNum;
      const fp = new Date(fecha + 'T12:00:00');
      if (p.frecuencia === 'diario') fp.setDate(fp.getDate() + 1);
      else if (p.frecuencia === 'semanal') fp.setDate(fp.getDate() + 7);
      else if (p.frecuencia === 'quincenal') fp.setDate(fp.getDate() + 15);
      else fp.setMonth(fp.getMonth() + 1);
      p.proximoPago = fp.toISOString().split('T')[0];
    } else {
      redistribuirCuotasPendientes(p);
    }
  } else if (tp === 'intpendientes') {
    const montoPagado = Math.max(0, +montoIntPend || 0);
    if (montoPagado <= 0) return res.status(400).json({ error: 'Ingrese un monto válido' });
    if (montoPagado > intPendAntesDelPago) return res.status(400).json({ error: `El máximo a pagar es $${intPendAntesDelPago}` });
    monto = montoPagado;
    int = montoPagado;
    cap = 0;
    intPendQuedo = intPendAntesDelPago - montoPagado;
    p.interesesPendientes = intPendQuedo;
    desc = 'Pago de intereses pendientes';
  } else {
    return res.status(400).json({ error: 'Opción de pago no reconocida' });
  }

  if (p.saldo <= 0 && (p.interesesPendientes || 0) <= 0) p.estado = 'pagado';

  // Ganancia neta: para créditos con capital propio, todo el interés cobrado es ganancia
  // (no hay costo externo que descontar). Para créditos fondeados por un tercero, se
  // descuenta el interés que le corresponde a ese prestamista. Antes esto solo se
  // calculaba para créditos fondeados externamente, dejando fuera el 100% de la
  // ganancia de todos los clientes con capital propio.
  let gananciaNeta = int;
  let detalleGanancia = `int cobrado $${int} (capital propio)`;
  if (p.fuenteExternaId) {
    const f = await FuenteExterna.findOne({ idNum: p.fuenteExternaId });
    if (f) {
      const saldoParaInteres = p.saldo + cap;
      const interesExterno = roundM(saldoParaInteres * tasaP(f.tasaInteres, p.frecuencia));
      gananciaNeta = int - interesExterno;
      detalleGanancia = `int cobrado $${int} - int externo $${interesExterno}`;
    }
  }
  if (gananciaNeta > 0) {
    const cfg = await Config.findById('config');
    cfg.ganancias = (cfg.ganancias || 0) + gananciaNeta;
    await cfg.save();
    p.gananciaNetaAcumulada = (p.gananciaNetaAcumulada || 0) + gananciaNeta;
    await audit('ganancia', `Ganancia neta por crédito #${p.idNum}: $${gananciaNeta} (${detalleGanancia})`, 'credito');
  }

  const idNum = await nextId('pago');
  const pg = await Pago.create({
    idNum,
    prestamoId: p.idNum,
    clienteId: p.clienteId,
    clienteNombre: p.clienteNombre,
    numCuota: numC,
    monto,
    capital: cap,
    intereses: int,
    intPendienteAntes: intPendAntesDelPago,
    intPendienteQuedo: intPendQuedo,
    tipoPago: tp,
    metodo,
    referencia: ref,
    fechaPago: fecha,
    estado: 'pagado'
  });

  await p.save();
  await audit('pago', `Pago: ${desc} — $${monto} — ${p.clienteNombre}${intPendQuedo > 0 ? ' — Int.Pend quedó $' + intPendQuedo : ''}`, 'pago');

  res.json({ pago: serialize.pago(pg), prestamo: serialize.prestamo(p), desc });
});

module.exports = router;
