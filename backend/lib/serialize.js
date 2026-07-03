// Convierte documentos Mongoose a la misma forma plana que usaba el frontend original
// (campo `id` numérico corto, en vez de `idNum`/`_id` de Mongo).

function cliente(c) {
  return {
    id: c.idNum,
    nombre: c.nombre,
    cedula: c.cedula,
    telefono: c.telefono,
    email: c.email,
    direccion: c.direccion,
    empresa: c.empresa,
    ingresos: c.ingresos,
    estado: c.estado,
    fechaReg: c.fechaReg
  };
}

function prestamo(p) {
  return {
    id: p.idNum,
    clienteId: p.clienteId,
    clienteNombre: p.clienteNombre,
    monto: p.monto,
    saldo: p.saldo,
    garantias: p.garantias,
    requisitos: p.requisitos,
    interes: p.interes,
    frecuencia: p.frecuencia,
    fechaInicio: p.fechaInicio,
    estado: p.estado,
    diasMora: p.diasMora,
    numCuota: p.numCuota,
    notas: p.notas,
    tipo: p.tipo,
    abonoCapital: p.abonoCapital,
    interesesPendientes: p.interesesPendientes,
    fuenteExternaId: p.fuenteExternaId,
    gananciaNetaAcumulada: p.gananciaNetaAcumulada,
    numCuotas: p.numCuotas,
    plazoMeses: p.plazoMeses,
    cuotaMonto: p.cuotaMonto,
    proximoPago: p.proximoPago,
    cuotas: p.cuotas,
    extraDisbursements: p.extraDisbursements
  };
}

function pago(pg) {
  return {
    id: pg.idNum,
    prestamoId: pg.prestamoId,
    clienteId: pg.clienteId,
    clienteNombre: pg.clienteNombre,
    numCuota: pg.numCuota,
    monto: pg.monto,
    capital: pg.capital,
    intereses: pg.intereses,
    intPendienteAntes: pg.intPendienteAntes,
    intPendienteQuedo: pg.intPendienteQuedo,
    tipoPago: pg.tipoPago,
    metodo: pg.metodo,
    referencia: pg.referencia,
    fechaPago: pg.fechaPago,
    estado: pg.estado
  };
}

function fuente(f) {
  return {
    id: f.idNum,
    prestamista: f.prestamista,
    monto: f.monto,
    tasaInteres: f.tasaInteres,
    frecuencia: f.frecuencia,
    fechaInicio: f.fechaInicio,
    estado: f.estado,
    notas: f.notas,
    saldo: f.saldo,
    interesesPagados: f.interesesPagados
  };
}

function auditoria(a) {
  return {
    id: String(a._id),
    fecha: a.fecha,
    accion: a.accion,
    detalle: a.detalle,
    tipo: a.tipo
  };
}

function cfg(c) {
  return {
    capitalBase: c.capitalBase,
    ganancias: c.ganancias,
    interes: c.interes,
    gracia: c.gracia,
    minimo: c.minimo,
    moratoria: c.moratoria,
    frec: c.frec,
    user: c.auth.user
  };
}

module.exports = { cliente, prestamo, pago, fuente, auditoria, cfg };
