// ========================================================================
// PRÉSTAMOS VR — FRONTEND (consume /api/*, ya no usa localStorage)
// ========================================================================

// ==================== ESTADO LOCAL (caché de lectura, no se escribe directo) ====================
let S = {
  cfg: { capitalBase: 0, ganancias: 0, interes: 10, gracia: 5, minimo: 50000, moratoria: 3, frec: 'quincenal' },
  clientes: [],
  prestamos: [],
  pagos: [],
  fuentesExternas: [],
  auditoria: []
};

// ==================== FUNCIONES AUXILIARES ====================
if (typeof Swal === 'undefined') {
  window.Swal = {
    fire: (options) => {
      if (typeof options === 'string') { alert(options); } else {
        let msg = options.title || '';
        if (options.html) msg += '\n' + options.html.replace(/<[^>]*>/g, '');
        if (options.text) msg += '\n' + options.text;
        alert(msg);
      }
      return Promise.resolve({ isConfirmed: true, isDenied: false, isDismissed: false });
    }
  };
}

const roundM = x => Math.round(x / 1000) * 1000;
const fmt = n => isNaN(+n) || n == null ? '0.00' : (+n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtF = f => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-CO') : '—';
const hoy = () => new Date().toISOString().split('T')[0];
const difD = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

function tasaP(intMes, frec) {
  const t = intMes / 100;
  if (frec === 'diario') return t / 30;
  if (frec === 'semanal') return t / 4;
  if (frec === 'quincenal') return t / 2;
  return t;
}

const id = s => document.getElementById(s);
const V = s => (id(s) || {}).value || '';
const setT = (s, t) => { const el = id(s); if (el) el.textContent = t; };

function openM(mid) { id(mid)?.classList.add('open'); }
function closeM(mid) { id(mid)?.classList.remove('open'); }
function closeAll() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); }

function mostrarToast(msg) {
  Swal.fire({ title: msg, icon: 'success', timer: 1500, showConfirmButton: false, position: 'bottom-end', toast: true });
}

function errMsg(err) { return (err && err.message) || 'Ocurrió un error inesperado'; }

// ==================== CÁLCULOS DE SOLO-PRESENTACIÓN (el backend es la fuente autoritativa) ====================
// Estas funciones son las mismas que corrían en el HTML original. Se mantienen en el
// cliente porque solo se usan para vistas previas (simulador, resumen antes de enviar) o
// para derivar cifras a partir de datos ya recibidos del backend (dashboard, cobranzas).
// La creación/edición real de créditos y pagos siempre se valida y calcula en el servidor.

function calcularCapital() {
  const base = S.cfg.capitalBase || 0;
  const ganancias = S.cfg.ganancias || 0;
  const activos = S.prestamos.filter(p => p.estado !== 'pagado');
  // Todo crédito que no esté fondeado por un tercero sale de capital propio.
  const saldoPropioEnCalle = activos.filter(p => !p.fuenteExternaId).reduce((a, p) => a + p.saldo, 0);
  const capitalPropio = base + ganancias + saldoPropioEnCalle;
  const capitalExterno = S.fuentesExternas.filter(f => f.estado === 'activo').reduce((a, f) => a + f.saldo, 0);
  const capitalTotal = capitalPropio + capitalExterno;
  const saldoActivo = activos.reduce((a, p) => a + p.saldo, 0);
  // A diferencia de las demás cifras, esta no se calcula: la establece el usuario
  // directamente (Configuración > Parámetros) y si no la define queda en 0.
  const capitalDisponible = S.cfg.capitalDisponible || 0;
  return { base, ganancias, capitalPropio, capitalExterno, capitalTotal, capitalDisponible, saldoActivo };
}

function checkMora() {
  const h = hoy();
  S.prestamos.forEach(p => {
    if (p.estado === 'pagado') return;
    if (p.tipo === 'amortizable' && p.cuotas) {
      const pend = p.cuotas.filter(c => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
      if (!pend.length && (p.interesesPendientes || 0) <= 0) { p.estado = 'pagado'; p.diasMora = 0; return; }
      if (!pend.length) { p.estado = 'activo'; p.diasMora = 0; return; }
      const dias = difD(pend[0].fechaVence, h);
      if (dias > (S.cfg.gracia || 5)) { p.estado = 'moroso'; p.diasMora = dias; } else { p.estado = 'activo'; p.diasMora = 0; }
    } else if (p.tipo === 'rotativo') {
      if (!p.proximoPago) return;
      const dias = difD(p.proximoPago, h);
      if (dias > (S.cfg.gracia || 5)) { p.estado = 'moroso'; p.diasMora = dias; } else { p.estado = 'activo'; p.diasMora = 0; }
    }
  });
}

function calcularPeriodosPrestamo(prestamo) {
  if (!prestamo) return [];
  const hoyDate = new Date();
  hoyDate.setHours(0, 0, 0, 0);
  const fechaInicio = new Date(prestamo.fechaInicio + 'T12:00:00');
  if (prestamo.tipo === 'amortizable' && prestamo.cuotas && prestamo.cuotas.length) {
    return prestamo.cuotas.map(c => ({
      fecha: c.fechaVence,
      descripcion: c.etiqueta || `Cuota #${c.numero}`,
      total: c.total,
      capital: c.capital,
      interes: c.interes,
      estado: c.estado,
      pagado: c.estado === 'pagado'
    }));
  }
  const frecuencia = prestamo.frecuencia;
  let currentDate = new Date(fechaInicio);
  if (frecuencia === 'diario') currentDate.setDate(currentDate.getDate() + 1);
  else if (frecuencia === 'semanal') currentDate.setDate(currentDate.getDate() + 7);
  else if (frecuencia === 'quincenal') currentDate.setDate(currentDate.getDate() + 15);
  else currentDate.setMonth(currentDate.getMonth() + 1);
  const endDate = new Date(hoyDate);
  endDate.setMonth(endDate.getMonth() + 1);
  const periodos = [];
  let saldoActual = prestamo.saldo;
  const pagosOrdenados = S.pagos.filter(pg => pg.prestamoId === prestamo.id).sort((a, b) => new Date(a.fechaPago) - new Date(b.fechaPago));
  let pagosIdx = 0;
  let periodIndex = 1;
  while (currentDate <= endDate) {
    const fechaStr = currentDate.toISOString().split('T')[0];
    const interesPeriodo = roundM(saldoActual * tasaP(prestamo.interes, frecuencia));
    let pagado = false;
    const tolerancia = frecuencia === 'diario' ? 1 : frecuencia === 'semanal' ? 3 : frecuencia === 'quincenal' ? 5 : 10;
    for (let i = pagosIdx; i < pagosOrdenados.length; i++) {
      const pg = pagosOrdenados[i];
      const diff = Math.abs(new Date(pg.fechaPago) - currentDate);
      if (diff <= tolerancia * 86400000) { pagado = true; pagosIdx = i + 1; break; }
    }
    let abonoAplicado = 0;
    if (frecuencia === 'quincenal' && prestamo.abonoCapital > 0 && periodIndex % 2 === 0) {
      abonoAplicado = roundM(Math.min(prestamo.abonoCapital, saldoActual));
      saldoActual = Math.max(0, saldoActual - abonoAplicado);
    }
    const estado = pagado ? 'pagado' : (currentDate < hoyDate ? 'vencido' : 'pendiente');
    periodos.push({ fecha: fechaStr, descripcion: `Período #${periodIndex} (${frecuencia})`, total: interesPeriodo, capital: 0, interes: interesPeriodo, estado, pagado });
    if (frecuencia === 'diario') currentDate.setDate(currentDate.getDate() + 1);
    else if (frecuencia === 'semanal') currentDate.setDate(currentDate.getDate() + 7);
    else if (frecuencia === 'quincenal') currentDate.setDate(currentDate.getDate() + 15);
    else currentDate.setMonth(currentDate.getMonth() + 1);
    periodIndex++;
  }
  return periodos;
}

// ==================== RENDER FUNCTIONS (sin cambios respecto al original: solo leen S) ====================
function renderContadores() {
  const act = S.prestamos.filter(p => p.estado !== 'pagado');
  id('cnt-cli').textContent = S.clientes.length;
  id('cnt-pre').textContent = act.length;
  const cp = S.prestamos.filter(p => p.tipo === 'amortizable' && p.estado !== 'pagado')
    .reduce((a, p) => a + (p.cuotas || []).filter(c => c.estado === 'pendiente').length, 0);
  id('cnt-cob').textContent = cp;
  id('cnt-fon').textContent = S.fuentesExternas.length;
  const mora = act.filter(p => p.estado === 'moroso').length;
  id('notif-dot').style.display = (cp > 0 || mora > 0) ? 'block' : 'none';
}

function updDL() {
  ['dl-clis', 'dl-clis-emb'].forEach(did => {
    const dl = id(did);
    if (!dl) return;
    dl.innerHTML = S.clientes.map(c =>
      `<option value="${c.nombre} (${c.cedula})" data-id="${c.id}">${c.nombre} (${c.cedula})</option>`
    ).join('');
  });
}

function renderDash() {
  const activos = S.prestamos.filter(p => p.estado !== 'pagado');
  const saldoT = activos.reduce((a, p) => a + p.saldo, 0);
  const totalP = activos.reduce((a, p) => a + p.monto, 0);
  const cap = calcularCapital();
  const totalIntPend = activos.reduce((a, p) => a + (p.interesesPendientes || 0), 0);

  setT('d-cappropio', '$' + fmt(cap.capitalPropio));
  setT('d-capext', '$' + fmt(cap.capitalExterno));
  setT('d-ganancia_neta', '$' + fmt(S.cfg.ganancias || 0));
  setT('d-captotal', '$' + fmt(cap.capitalTotal));
  setT('d-capdisp', '$' + fmt(cap.capitalDisponible));
  setT('d-calle', '$' + fmt(saldoT));
  setT('d-prestado', '$' + fmt(totalP));
  setT('d-intpend', '$' + fmt(totalIntPend));
  setT('d-act', activos.filter(p => p.estado === 'activo').length);

  const h = hoy(), h7 = new Date();
  h7.setDate(h7.getDate() + 7);
  const venc = [];
  S.prestamos.filter(p => p.tipo === 'amortizable' && p.cuotas).forEach(p => {
    p.cuotas.filter(c => c.estado === 'pendiente').forEach(c => {
      const f = new Date(c.fechaVence + 'T12:00:00');
      if (f >= new Date(h) && f <= h7) venc.push({ ...c, cliNom: p.clienteNombre });
    });
  });
  venc.sort((a, b) => new Date(a.fechaVence) - new Date(b.fechaVence));
  const tbv = id('tbl-venc').querySelector('tbody');
  tbv.innerHTML = venc.slice(0, 8).map(v =>
    `<tr><td>${v.cliNom}</td><td>${fmtF(v.fechaVence)}</td><td class="mono">$${fmt(v.total)}</td>`
  ).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:18px">Sin vencimientos</td></tr>';

  const mora = S.prestamos.filter(p => p.estado === 'moroso');
  let al = '';
  if (mora.length) al += `<div class="alert al-r"><i class="fas fa-exclamation-triangle"></i> <b>${mora.length} crédito(s) en mora.</b> Revise Cobranzas.</div>`;
  const hoyV = venc.filter(v => v.fechaVence === h).length;
  if (hoyV) al += `<div class="alert al-w"><i class="fas fa-clock"></i> <b>${hoyV} cuota(s) vencen HOY.</b></div>`;
  if (totalIntPend > 0) al += `<div class="alert al-w"><i class="fas fa-exclamation-circle"></i> <b>$${fmt(totalIntPend)}</b> en intereses pendientes acumulados en cartera activa.</div>`;
  if (cap.capitalDisponible < 0) al += `<div class="alert al-r"><i class="fas fa-exclamation-triangle"></i> <b>Capital disponible negativo:</b> revisa el valor que cargaste en Configuración.</div>`;
  if (!al) al = '<p class="text-m" style="padding:6px 0">Sin alertas activas ✓</p>';
  id('alertas').innerHTML = al;
  updChart();
}

function updChart() {
  if (typeof Chart === 'undefined') return;
  const ctx = id('chart-gar');
  if (!ctx) return;
  const cnt = { tarjeta: 0, letra: 0, hipoteca: 0, prendario: 0, personal: 0 };
  S.prestamos.forEach(p => (p.garantias || []).forEach(g => { if (cnt[g] !== undefined) cnt[g]++; }));
  const data = Object.values(cnt);
  const labels = ['Tarjeta Nómina', 'Letra de Cambio', 'Hipoteca', 'Prendario', 'Personal'];
  const colors = ['#2563EB', '#D97706', '#7C3AED', '#DC2626', '#059669'];
  if (window._chart) { window._chart.data.datasets[0].data = data; window._chart.update(); return; }
  window._chart = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '60%' }
  });
}

function renderClientes() {
  const src = (V('src-cli') || '').toLowerCase();
  const flt = V('flt-cli');
  const lista = S.clientes.filter(c => {
    const ms = !src || c.nombre.toLowerCase().includes(src) || (c.cedula || '').includes(src);
    const mf = !flt || c.estado === flt;
    return ms && mf;
  });
  const tb = id('tbl-clientes').querySelector('tbody');
  if (!lista.length) { tb.innerHTML = `<tr><td colspan="8"><div class="empty"><i class="fas fa-users"></i><p>Sin clientes</p></div></td>`; return; }
  tb.innerHTML = lista.map(c => {
    const ps = S.prestamos.filter(p => p.clienteId === c.id && p.estado !== 'pagado');
    const saldo = ps.reduce((a, p) => a + p.saldo, 0);
    const intPend = ps.reduce((a, p) => a + (p.interesesPendientes || 0), 0);
    const gars = [...new Set(ps.flatMap(p => p.garantias || []))];
    const be = c.estado === 'moroso' ? 'bg-r' : c.estado === 'inactivo' ? 'bg-gray' : 'bg-g';
    const le = c.estado === 'moroso' ? 'Moroso' : c.estado === 'inactivo' ? 'Inactivo' : 'Activo';
    return `<tr>
      <td><b>${c.nombre}</b><br><small class="text-m">${c.cedula}</small></td>
      <td>${c.telefono}<br><small class="text-m">${c.email||''}</small></td>
      <td>${ps.length} activo(s)</td>
      <td>${gars.map(g=>`<span class="gb gb-${g}">${g}</span>`).join('')||'<span class="text-m">—</span>'}</td>
      <td class="mono">$${fmt(saldo)}</td>
      <td class="mono ${intPend>0?'text-w':'text-m'}">${intPend>0?'$'+fmt(intPend):'—'}</td>
      <td><span class="badge ${be}">${le}</span></td>
      <td><div class="action-menu"><button class="dots" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu"><a onclick="verCli(${c.id})"><i class="fas fa-eye"></i> Ver</a><a onclick="editCli(${c.id})"><i class="fas fa-edit"></i> Editar</a><a onclick="pagoDesde(${c.id})"><i class="fas fa-money-check-alt"></i> Pagar</a></div></div></td>
    </tr>`;
  }).join('');
}

function renderPrestamos() {
  const todos = S.prestamos, act = todos.filter(p => p.estado === 'activo'), mora = todos.filter(p => p.estado === 'moroso'), pag = todos.filter(p => p.estado === 'pagado');
  [['todos', todos], ['act', act], ['mora', mora], ['pag', pag]].forEach(([k, lista]) => {
    const tb = id(`tbl-pre-${k}`)?.querySelector('tbody');
    if (!tb) return;
    tb.innerHTML = lista.length ? lista.map(filaPre).join('') : `<tr><td colspan="11"><div class="empty"><i class="fas fa-file-invoice"></i><p>Sin créditos</p></div></td>`;
  });
  setT('p-total', '$' + fmt(todos.reduce((a, p) => a + p.monto, 0)));
  setT('p-saldo', '$' + fmt(todos.filter(p => p.estado !== 'pagado').reduce((a, p) => a + p.saldo, 0)));
  setT('p-mora', '$' + fmt(mora.reduce((a, p) => a + p.saldo, 0)));
  setT('p-prom', (todos.length ? todos.reduce((a, p) => a + p.interes, 0) / todos.length : 0).toFixed(1) + '%');
}

function filaPre(p) {
  const be = p.estado === 'pagado' ? 'bg-gray' : p.estado === 'moroso' ? 'bg-r' : 'bg-g';
  const le = p.estado === 'pagado' ? 'Pagado' : p.estado === 'moroso' ? 'Moroso' : 'Activo';
  const gH = (p.garantias || []).map(g => `<span class="gb gb-${g}">${g}</span>`).join('');
  const meses = p.tipo === 'amortizable' ? Math.ceil((p.numCuotas || 0) / (p.frecuencia === 'quincenal' ? 2 : p.frecuencia === 'mensual' ? 1 : p.frecuencia === 'semanal' ? 4 : 30)) : '—';
  const ip = p.interesesPendientes || 0;
  const ipHtml = ip > 0 ? `<span class="badge bg-w" title="Intereses Pendientes">$${fmt(ip)}</span>` : '<span class="text-m">—</span>';
  return `<tr>
    <td><b>#${p.id}</b></td>
    <td>${p.clienteNombre}<br><small class="text-m">${p.tipo}</small></td>
    <td class="mono">$${fmt(p.monto)}</td>
    <td>${gH || '—'}</td>
    <td>${p.interes}%</td>
    <td>${p.frecuencia}</td>
    <td>${meses}</td>
    <td class="mono">$${fmt(p.saldo)}</td>
    <td>${ipHtml}</td>
    <td><span class="badge ${be}">${le}</span></td>
    <td><div class="action-menu"><button class="dots" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu"><a onclick="verPre(${p.id})"><i class="fas fa-eye"></i> Ver</a><a onclick="abrirPago(${p.id})"><i class="fas fa-money-check-alt"></i> Pagar</a><a onclick="editLoan(${p.id})"><i class="fas fa-edit"></i> Editar</a><a onclick="deleteLoan(${p.id})"><i class="fas fa-trash"></i> Eliminar</a><a onclick="addDisbursement(${p.id})"><i class="fas fa-plus-circle"></i> Desemb.</a></div></div></td>
  </tr>`;
}

function renderGars() {
  const cnt = { tarjeta: 0, letra: 0, hipoteca: 0, prendario: 0, personal: 0 };
  S.prestamos.forEach(p => (p.garantias || []).forEach(g => { if (cnt[g] !== undefined) cnt[g]++; }));
  Object.keys(cnt).forEach(k => { const el = id('gs-' + k); if (el) el.textContent = cnt[k]; });
  const tb = id('tbl-gars')?.querySelector('tbody');
  if (!tb) return;
  if (!S.prestamos.length) { tb.innerHTML = `<tr><td colspan="7"><div class="empty"><i class="fas fa-shield-alt"></i><p>Sin garantías</p></div></td></tr>`; return; }
  tb.innerHTML = S.prestamos.map(p => {
    const gH = (p.garantias || []).map(g => `<span class="gb gb-${g}">${g}</span>`).join('');
    let detalles = [];
    if (p.requisitos && typeof p.requisitos === 'object') {
      for (const [tipo, datos] of Object.entries(p.requisitos)) {
        if (datos && typeof datos === 'object') {
          const items = Object.entries(datos).filter(([k, v]) => v && k !== 'pass').map(([k, v]) => `<b>${k}:</b> ${v}`);
          if (items.length) detalles.push(items.join(', '));
        }
      }
    }
    const det = detalles.length ? detalles.join(' | ') : '—';
    const be = p.estado === 'pagado' ? 'bg-gray' : p.estado === 'moroso' ? 'bg-r' : 'bg-g';
    return `<tr>
      <td><b>#${p.id}</b></td>
      <td>${p.clienteNombre}</td>
      <td>${gH}</td>
      <td style="font-size:.78rem;max-width:200px;word-break:break-word">${det}</td>
      <td class="mono">$${fmt(p.monto)}</td>
      <td><span class="badge ${be}">${p.estado}</span></td>
      <td><div class="action-menu"><button class="dots" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu"><a onclick="verPre(${p.id})"><i class="fas fa-eye"></i> Ver</a></div></div></td>
    </tr>`;
  }).join('');
}

function renderCobr() {
  const h = hoy();
  const pAmort = S.prestamos.filter(p => p.tipo === 'amortizable' && p.estado !== 'pagado');
  let todas = [];
  pAmort.forEach(p => {
    if (p.cuotas) p.cuotas.filter(c => c.estado === 'pendiente').forEach(c => todas.push({ ...c, pid: p.id, cliNom: p.clienteNombre, intPend: p.interesesPendientes || 0 }));
  });
  const venc = todas.filter(c => c.fechaVence < h);
  const pags = S.pagos.filter(p => p.estado === 'pagado');

  setT('c-hoy', '$' + fmt(todas.filter(c => c.fechaVence === h).reduce((a, c) => a + c.total, 0)));
  setT('c-phoy', '$' + fmt(pags.filter(p => p.fechaPago === h).reduce((a, p) => a + p.monto, 0)));
  setT('c-pend', todas.length);
  setT('c-mora', venc.length);
  let totalImpagos = 0;
  S.prestamos.forEach(p => {
    if (p.estado === 'pagado') return;
    const periodos = calcularPeriodosPrestamo(p);
    totalImpagos += periodos.filter(per => !per.pagado && new Date(per.fecha) < new Date()).length;
  });
  setT('c-impagos', totalImpagos);

  const grps = {};
  todas.forEach(c => { if (!grps[c.pid]) grps[c.pid] = []; grps[c.pid].push(c); });
  const tbPend = id('tbl-cob-pend').querySelector('tbody');
  if (!Object.keys(grps).length) {
    tbPend.innerHTML = `<tr><td colspan="9"><div class="empty"><i class="fas fa-check-circle"></i><p>Sin cuotas pendientes</p></div></td>`;
  } else {
    tbPend.innerHTML = Object.entries(grps).map(([pid, cuotas]) => {
      const pre = S.prestamos.find(x => x.id === +pid);
      if (!pre) return '';
      const prox = cuotas.sort((a, b) => a.numero - b.numero)[0];
      const mv = cuotas.filter(c => c.fechaVence < h).length;
      const ip = pre.interesesPendientes || 0;
      const et = prox.etiqueta ? `<div style="font-size:.73rem;color:var(--p);margin-top:2px">${prox.etiqueta}</div>` : '';
      return `<tr>
        <td><b>${pre.clienteNombre}</b></td>
        <td>#${pre.id}</td>
        <td><span class="badge bg-b">${cuotas.length} pend.</span>${mv>0?`<span class="badge bg-r" style="margin-left:4px">${mv} venc.</span>`:''} ${et}</td>
        <td>${fmtF(prox.fechaVence)}</td>
        <td class="mono fw7" style="color:var(--p)">$${fmt(prox.total)}</td>
        <td class="mono text-g">$${fmt(prox.capital)}</td>
        <td class="mono text-w">$${fmt(prox.interes)}</td>
        <td class="mono ${ip>0?'text-w':''}">${ip>0?'<span class="badge bg-w">$'+fmt(ip)+'</span>':'—'}</td>
        <td><div class="action-menu"><button class="dots" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu"><a onclick="abrirPago(${pre.id})"><i class="fas fa-check"></i> Pagar</a><a onclick="verTodasCuotas(${pre.id})"><i class="fas fa-list"></i> Ver todas</a></div></div></td>
      </tr>`;
    }).join('');
  }

  const tbVenc = id('tbl-cob-venc').querySelector('tbody');
  tbVenc.innerHTML = venc.length ? venc.map(c => {
    const dias = difD(c.fechaVence, h);
    const mora = c.total * (S.cfg.moratoria / 100) * Math.ceil(dias / 30);
    const pre = S.prestamos.find(x => x.id === c.pid);
    const ip = pre ? pre.interesesPendientes || 0 : 0;
    return `<tr>
      <td><b>${c.cliNom}</b></td>
      <td>#${c.pid}</td>
      <td>${c.numero}</td>
      <td>${fmtF(c.fechaVence)}</td>
      <td class="mono">$${fmt(c.total)}</td>
      <td><span class="badge bg-r">${dias}d</span></td>
      <td class="mono text-r">$${fmt(mora)}</td>
      <td class="mono ${ip>0?'text-w':''}">${ip>0?'$'+fmt(ip):'—'}</td>
      <td><div class="action-menu"><button class="dots" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu"><a onclick="abrirPago(${c.pid})"><i class="fas fa-money-check-alt"></i> Pagar</a></div></div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="9"><div class="empty"><i class="fas fa-smile"></i><p>Sin mora</p></div></tr>`;

  const tbH = id('tbl-cob-hist').querySelector('tbody');
  tbH.innerHTML = pags.length ? [...pags].reverse().map(pg => `
    <tr>
      <td>${pg.clienteNombre}</td>
      <td>#${pg.prestamoId}</td>
      <td>${pg.numCuota}</td>
      <td>${fmtF(pg.fechaPago)}</td>
      <td class="mono">$${fmt(pg.monto)}</td>
      <td class="mono text-g">$${fmt(pg.capital || 0)}</td>
      <td class="mono text-w">$${fmt(pg.intereses || 0)}</td>
      <td class="mono ${(pg.intPendienteQuedo || 0) > 0 ? 'text-w' : 'text-m'}">${(pg.intPendienteQuedo || 0) > 0 ? '$' + fmt(pg.intPendienteQuedo) : '—'}</td>
      <td>${pg.metodo || '—'}</td>
      <td><span class="badge bg-p">${pg.tipoPago || '—'}</span></td>
      <td><div class="action-menu"><button class="dots" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu"><a onclick="editPayment(${pg.id})"><i class="fas fa-edit"></i> Editar</a></div></div></td>
    </tr>`).join('') : '<tr><td colspan="11"><div class="empty"><i class="fas fa-history"></i><p>Sin historial</p></div></tr>';
}

function renderFondeo() {
  const total = S.fuentesExternas.length;
  const saldo = S.fuentesExternas.filter(f => f.estado === 'activo').reduce((a, f) => a + f.saldo, 0);
  const intPag = S.fuentesExternas.reduce((a, f) => a + (f.interesesPagados || 0), 0);
  const ganancia = S.cfg.ganancias || 0;
  setT('f-total', total);
  setT('f-saldo', '$' + fmt(saldo));
  setT('f-intpag', '$' + fmt(intPag));
  setT('f-ganancia', '$' + fmt(ganancia));
  id('cnt-fon').textContent = total;

  const tb = id('tbl-fuentes').querySelector('tbody');
  if (!total) { tb.innerHTML = `<tr><td colspan="9"><div class="empty"><i class="fas fa-handshake"></i><p>Sin fuentes externas</p></div></td></tr>`; return; }
  tb.innerHTML = S.fuentesExternas.map(f => `
    <tr>
      <td><b>${f.prestamista}</b></td>
      <td class="mono">$${fmt(f.monto)}</td>
      <td>${f.tasaInteres}%</td>
      <td>${f.frecuencia}</td>
      <td>${fmtF(f.fechaInicio)}</td>
      <td class="mono">$${fmt(f.saldo)}</td>
      <td class="mono text-w">$${fmt(f.interesesPagados||0)}</td>
      <td><span class="badge ${f.estado==='activo'?'bg-g':f.estado==='pagado'?'bg-gray':'bg-r'}">${f.estado}</span></td>
      <td><div class="action-menu"><button class="dots" onclick="toggleMenu(this)"><i class="fas fa-ellipsis-v"></i></button><div class="dropdown-menu"><a onclick="pagarFuente(${f.id})"><i class="fas fa-money-check-alt"></i> Pagar</a><a onclick="editarFuente(${f.id})"><i class="fas fa-edit"></i> Editar</a><a onclick="eliminarFuente(${f.id})"><i class="fas fa-trash"></i> Eliminar</a></div></div></td>
    </tr>
  `).join('');
}

function renderAudit() {
  const cont = id('audit-log');
  if (!S.auditoria.length) { cont.innerHTML = '<div class="empty"><i class="fas fa-clipboard-list"></i><p>Sin registros</p></div>'; return; }
  const ico = { credito: 'fa-file-invoice', pago: 'fa-money-check-alt', cliente: 'fa-user', embargo: 'fa-gavel', config: 'fa-cog', sistema: 'fa-server', fondeo: 'fa-handshake', ganancia: 'fa-chart-line' };
  const col = { credito: 'ico-p', pago: 'ico-g', cliente: 'ico-b', embargo: 'ico-r', config: 'ico-w', sistema: 'ico-p', fondeo: 'ico-b', ganancia: 'ico-g' };
  cont.innerHTML = S.auditoria.slice(0, 100).map(a =>
    `<div class="audit-item"><div class="audit-ico ${col[a.tipo]||'ico-p'} stat-ico"><i class="fas ${ico[a.tipo]||'fa-circle'}"></i></div><div class="audit-body"><div class="audit-action">${a.accion}</div><div class="audit-detail">${a.detalle}</div></div><div class="audit-time">${a.fecha}</div></div>`
  ).join('');
}

function updCfgUI() {
  const cap = calcularCapital();
  id('cfg-cap').value = S.cfg.capitalBase || 0;
  id('cfg-capdisp-input').value = S.cfg.capitalDisponible || 0;
  id('cfg-int').value = S.cfg.interes || 10;
  id('cfg-gracia').value = S.cfg.gracia || 5;
  id('cfg-min').value = S.cfg.minimo || 50000;
  id('cfg-mora').value = S.cfg.moratoria || 3;
  id('cfg-frec').value = S.cfg.frec || 'quincenal';
  id('cfg-capbase').textContent = '$' + fmt(cap.capitalPropio);
  id('cfg-ganancias').textContent = '$' + fmt(cap.ganancias);
  id('cfg-captotal').textContent = '$' + fmt(cap.capitalTotal);
}

function actualizarListaFuentes() {
  const sel = id('pre-fuente');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Ninguna (capital propio)</option>';
  S.fuentesExternas.filter(f => f.estado === 'activo').forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `${f.prestamista} — $${fmt(f.monto)} (${f.tasaInteres}%)`;
    sel.appendChild(opt);
  });
  if (current && sel.querySelector(`option[value="${current}"]`)) sel.value = current;
}

// ==================== ACTUALIZAR TODO ====================
function upd() {
  checkMora();
  renderDash();
  renderClientes();
  renderPrestamos();
  renderGars();
  renderCobr();
  renderFondeo();
  renderAudit();
  renderContadores();
  updDL();
  updCfgUI();
  actualizarListaFuentes();
}

async function bootstrap() {
  S = await api.get('/state');
  upd();
}

// ==================== EXPORTACIÓN / IMPORTACIÓN (stubs, igual que en el original) ====================
function exportToExcel() { Swal.fire('Info', 'Exportar Excel: función disponible', 'info'); }
function abrirCapital() { id('cap-val').value = S.cfg.capitalBase || ''; openM('m-capital'); }

// ==================== MENÚS ====================
function toggleMenu(btn) {
  const menu = btn.nextElementSibling;
  document.querySelectorAll('.action-menu .dropdown-menu').forEach(m => { if (m !== menu) m.classList.remove('open'); });
  menu.classList.toggle('open');
}
document.addEventListener('click', function (e) {
  if (!e.target.closest('.action-menu')) {
    document.querySelectorAll('.action-menu .dropdown-menu').forEach(m => m.classList.remove('open'));
  }
});

// ==================== CLIENTES ====================
async function saveCli() {
  const eid = V('cli-id');
  const d = {
    nombre: V('cli-nombre').trim(),
    cedula: V('cli-cedula').trim(),
    telefono: V('cli-tel').trim(),
    email: V('cli-email').trim(),
    direccion: V('cli-dir').trim(),
    empresa: V('cli-emp').trim(),
    ingresos: +V('cli-ing') || 0
  };
  if (!d.nombre || !d.cedula || !d.telefono) return Swal.fire('Error', 'Complete campos obligatorios', 'error');
  try {
    if (eid) await api.put(`/clientes/${eid}`, d);
    else await api.post('/clientes', d);
    await bootstrap();
    closeM('m-cliente');
    Swal.fire({ icon: 'success', title: 'Cliente guardado', timer: 1400, showConfirmButton: false });
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

function verCli(cid) {
  const c = S.clientes.find(x => x.id === cid);
  if (!c) return Swal.fire('Info', `Cliente ${cid} no encontrado`, 'info');
  const ps = S.prestamos.filter(p => p.clienteId === cid);
  const intPendTotal = ps.filter(p => p.estado !== 'pagado').reduce((a, p) => a + (p.interesesPendientes || 0), 0);
  document.getElementById('m-det-title').textContent = `Cliente: ${c.nombre}`;
  document.getElementById('m-det-body').innerHTML = `
    <div class="frow">
      <div class="card"><div class="card-hdr"><span class="card-title">Datos</span></div><table>${[['Nombre', c.nombre], ['Cédula', c.cedula], ['Teléfono', c.telefono], ['Email', c.email || '—'], ['Empresa', c.empresa || '—'], ['Ingresos', '$' + fmt(c.ingresos)], ['Estado', c.estado]].map(r => `<tr><td style="padding:6px 10px;color:var(--muted)">${r[0]}</td><td style="padding:6px 10px"><b>${r[1]}</b></td></tr>`).join('')}</table></div>
      <div class="card"><div class="card-hdr"><span class="card-title">Financiero</span></div><table>${[['Total créditos', ps.length], ['Activos', ps.filter(p => p.estado !== 'pagado').length], ['Saldo pend.', '$' + fmt(ps.filter(p=>p.estado!=='pagado').reduce((a, p) => a + p.saldo, 0))], ['Int. Pendientes', intPendTotal>0?'<span class="badge bg-w">$'+fmt(intPendTotal)+'</span>':'—']].map(r => `<tr><td style="padding:6px 10px;color:var(--muted)">${r[0]}</td><td style="padding:6px 10px"><b>${r[1]}</b></td></tr>`).join('')}</table></div>
    </div>
    <div class="card"><div class="card-hdr"><span class="card-title">Créditos</span></div><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Monto</th><th>Saldo</th><th>Int.Pend.</th><th>Estado</th></tr></thead><tbody>${ps.map(p => `<tr><td>#${p.id}</td><td class="mono">$${fmt(p.monto)}</td><td class="mono">$${fmt(p.saldo)}</td><td class="mono ${(p.interesesPendientes||0)>0?'text-w':''}">${(p.interesesPendientes||0)>0?'$'+fmt(p.interesesPendientes):'—'}</td><td><span class="badge ${p.estado==='pagado'?'bg-gray':p.estado==='moroso'?'bg-r':'bg-g'}">${p.estado}</span></td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--muted)">Sin créditos</td></tr>'}</tbody></table></div></div>
  `;
  document.getElementById('btn-det-pdf').onclick = () => pdfCli(cid);
  openM('m-detalle');
}

function editCli(cid) {
  const c = S.clientes.find(x => x.id === cid);
  if (!c) return;
  document.getElementById('m-cli-title').textContent = 'Editar Cliente';
  document.getElementById('cli-id').value = c.id;
  document.getElementById('cli-nombre').value = c.nombre;
  document.getElementById('cli-cedula').value = c.cedula;
  document.getElementById('cli-tel').value = c.telefono;
  document.getElementById('cli-email').value = c.email || '';
  document.getElementById('cli-dir').value = c.direccion || '';
  document.getElementById('cli-emp').value = c.empresa || '';
  document.getElementById('cli-ing').value = c.ingresos || '';
  openM('m-cliente');
}

function pagoDesde(cid) {
  const ps = S.prestamos.filter(p => p.clienteId === cid && p.estado !== 'pagado');
  if (!ps.length) return Swal.fire('Info', 'Sin créditos activos', 'info');
  if (ps.length === 1) return abrirPago(ps[0].id);
  Swal.fire({
    title: 'Seleccionar Crédito',
    input: 'select',
    inputOptions: Object.fromEntries(ps.map(p => [p.id, `#${p.id} — $${fmt(p.saldo)} (${p.frecuencia})`])),
    showCancelButton: true
  }).then(r => { if (r.isConfirmed && r.value) abrirPago(+r.value); });
}

// ==================== PRÉSTAMOS ====================
function abrirNuevoPre() {
  document.getElementById('f-prestamo').reset();
  document.getElementById('pre-cli-id').value = '';
  document.getElementById('pre-cli-info').textContent = '';
  document.getElementById('pre-fecha').value = hoy();
  document.getElementById('pre-int').value = S.cfg.interes || 10;
  document.getElementById('pre-frec').value = S.cfg.frec || 'quincenal';
  document.getElementById('pre-tipo').value = 'rotativo';
  document.getElementById('div-amort').style.display = 'none';
  document.getElementById('pre-tiene-abono').checked = false;
  document.getElementById('abono-detail').classList.remove('show');
  document.getElementById('pre-abono').value = '0';
  document.getElementById('qprev').style.display = 'none';
  document.getElementById('abono-box').style.display = (S.cfg.frec || 'quincenal') === 'quincenal' ? 'block' : 'none';
  document.querySelectorAll('.gar-ck').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('.gar-det').forEach(d => d.classList.remove('show'));
  calcResumen();
  actualizarListaFuentes();
  openM('m-prestamo');
}

// Vista previa en el modal de creación de crédito. Es solo informativa — el backend
// recalcula todo de forma autoritativa al crear el crédito — pero debe reflejar de forma
// razonablemente fiel lo que se va a generar, para ambos tipos (rotativo/amortizable).
function calcResumen() {
  const monto = +V('pre-monto') || 0;
  const int = +V('pre-int') || 0;
  const frec = V('pre-frec');
  const tipo = V('pre-tipo');
  const tieneAbono = id('pre-tiene-abono').checked;
  const abono = tieneAbono ? (+V('pre-abono') || 0) : 0;
  const qprevEl = document.getElementById('qprev');

  if (!monto || !int) {
    setT('res-tipo', tipo === 'rotativo' ? 'Rotativo' : 'Amortizable');
    setT('res-cuota', '$0');
    setT('res-total', '$0');
    setT('res-ncuotas', '—');
    qprevEl.style.display = 'none';
    return;
  }

  if (tipo === 'rotativo') {
    const cuotaPeriodo = roundM(monto * tasaP(int, frec));
    setT('res-tipo', 'Rotativo (solo intereses, renovable)');
    setT('res-cuota', '$' + fmt(cuotaPeriodo) + ' / período');
    setT('res-total', 'Renovable — sin plazo fijo');
    setT('res-ncuotas', 'Indefinido (hasta cancelar)');
  } else {
    const plazo = +V('pre-plazo') || 0;
    const ncuotas = +V('pre-ncuotas') || 0;
    if (!ncuotas) {
      setT('res-tipo', 'Amortizable (plazo fijo)');
      setT('res-cuota', '$0');
      setT('res-total', '$0');
      setT('res-ncuotas', 'Ingrese N° de cuotas');
      qprevEl.style.display = 'none';
      return;
    }
    let totalPagar;
    if (frec === 'quincenal') {
      // misma lógica que genCuotas() en el backend: interés + abono declinante por quincena.
      const numMeses = Math.ceil(ncuotas / 2);
      let saldo = monto, totInt = 0;
      for (let m = 0; m < numMeses; m++) {
        const intQ = roundM(saldo * (int / 100) / 2);
        const abonoEf = roundM(Math.min(abono, saldo));
        totInt += intQ * 2;
        saldo = Math.max(0, saldo - abonoEf);
        if (saldo <= 0) break;
      }
      totalPagar = monto + totInt;
    } else {
      const fcMeses = frec === 'diario' ? 30 : frec === 'semanal' ? 4 : 1;
      const plazoMeses = plazo > 0 ? plazo : ncuotas / fcMeses;
      totalPagar = monto + monto * (int / 100) * plazoMeses;
    }
    setT('res-tipo', 'Amortizable (plazo fijo)');
    setT('res-cuota', '$' + fmt(totalPagar / ncuotas));
    setT('res-total', '$' + fmt(totalPagar));
    setT('res-ncuotas', ncuotas);
  }

  if (frec === 'quincenal') {
    const q1 = roundM(monto * int / 100 / 2);
    setT('qp-1', '$' + fmt(q1));
    setT('qp-2i', '$' + fmt(q1));
    const abonoRow = document.getElementById('qp-abono-row');
    if (abono > 0) {
      abonoRow.style.display = 'flex';
      setT('qp-2c', '$' + fmt(abono));
      setT('qp-2t', '$' + fmt(q1 + abono));
      setT('qp-saldo', '$' + fmt(Math.max(0, monto - abono)));
    } else {
      abonoRow.style.display = 'none';
      setT('qp-2t', '$' + fmt(q1));
      setT('qp-saldo', '$' + fmt(monto));
    }
    qprevEl.style.display = 'block';
  } else {
    qprevEl.style.display = 'none';
  }
}

async function savePre() {
  if (!V('pre-cli-id')) return Swal.fire('Error', 'Seleccione un cliente', 'error');

  const gars = Array.from(document.querySelectorAll('.gar-ck:checked')).map(cb => cb.value);
  if (!gars.length) return Swal.fire('Error', 'Seleccione al menos una garantía', 'error');
  for (const g of gars) {
    const reqs = document.querySelectorAll(`#gd-${g} .rq`);
    for (const r of reqs) { if (!r.value.trim()) return Swal.fire('Error', `Complete datos de garantía: ${g}`, 'error'); }
  }
  const requisitos = {};
  if (gars.includes('tarjeta')) requisitos.tarjeta = { numero: V('gt-num'), banco: V('gt-banco'), pass: id('gt-pass').value, tipo: V('gt-tipo') };
  if (gars.includes('letra')) requisitos.letra = { numero: V('gl-num'), valor: V('gl-val'), descripcion: V('gl-desc') };
  if (gars.includes('hipoteca')) requisitos.hipoteca = { direccion: V('gh-dir'), matricula: V('gh-mat'), avaluo: V('gh-aval') };
  if (gars.includes('prendario')) requisitos.prendario = { bien: V('gp-bien'), placa: V('gp-placa'), valor: V('gp-val') };
  if (gars.includes('personal')) requisitos.personal = { codeudor: V('gpe-nom'), cedula: V('gpe-ced'), telefono: V('gpe-tel') };

  const payload = {
    clienteId: +V('pre-cli-id'),
    monto: +V('pre-monto'),
    fuenteId: +V('pre-fuente') || null,
    garantias: gars,
    requisitos,
    interes: +V('pre-int'),
    frecuencia: V('pre-frec'),
    fechaInicio: V('pre-fecha'),
    tipo: V('pre-tipo'),
    notas: V('pre-notas'),
    tieneAbono: id('pre-tiene-abono').checked,
    abono: +V('pre-abono') || 0,
    plazo: +V('pre-plazo') || 0,
    ncuotas: +V('pre-ncuotas') || 0
  };

  try {
    const pre = await api.post('/prestamos', payload);
    await bootstrap();
    closeM('m-prestamo');
    const q1 = roundM(pre.monto * pre.interes / 100 / 2);
    Swal.fire({
      icon: 'success',
      title: 'Crédito creado',
      html: `<b>${pre.clienteNombre}</b><br>$${fmt(pre.monto)} | ${pre.interes}% mensual<br>${pre.frecuencia==='quincenal'?`<small>1ª quincena: $${fmt(q1)}<br>2ª quincena: $${fmt(q1+(pre.abonoCapital||0))}${pre.abonoCapital>0?`<br><span style="color:var(--g)">Abono cap: $${fmt(pre.abonoCapital)}</span>`:''}.</small>`:''}`
    });
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

function abrirPago(pid) {
  const p = S.prestamos.find(x => x.id === pid);
  if (!p) return;
  document.getElementById('pago-pid').value = pid;
  document.getElementById('pago-cli').value = p.clienteNombre;
  document.getElementById('pago-num').value = '#' + p.id;
  document.getElementById('pb-saldo').textContent = '$' + fmt(p.saldo);
  const ip = p.interesesPendientes || 0;
  let monto = 0, det = '';
  if (p.tipo === 'rotativo') {
    const cuotaNum = (p.numCuota || 0) + 1;
    const esQ2 = p.frecuencia === 'quincenal' && cuotaNum % 2 === 0;
    const intPeriodo = roundM(p.saldo * tasaP(p.interes, p.frecuencia));
    const abQ = esQ2 && p.abonoCapital > 0 ? roundM(Math.min(p.abonoCapital, p.saldo)) : 0;
    monto = intPeriodo + abQ;
    det = `Int $${fmt(intPeriodo)}${abQ>0?' + Cap $'+fmt(abQ):''}${ip>0?' (Int.pend. aparte)':''}`;
    document.getElementById('pago-max-int').textContent = '$' + fmt(intPeriodo + ip);
    document.getElementById('pago-max-cap').textContent = '$' + fmt(p.saldo);
  } else {
    const pend = (p.cuotas || []).filter(c => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
    if (pend.length) {
      monto = pend[0].total;
      det = pend[0].etiqueta || `Cuota #${pend[0].numero}`;
      const totInt = pend.reduce((a, c) => a + c.interes, 0);
      const totCap = pend.reduce((a, c) => a + c.capital, 0);
      document.getElementById('pago-max-int').textContent = '$' + fmt(totInt + ip);
      document.getElementById('pago-max-cap').textContent = '$' + fmt(totCap);
    } else if (ip > 0) { det = 'Solo intereses pendientes'; monto = 0; }
  }
  document.getElementById('pb-monto').textContent = '$' + fmt(monto);
  document.getElementById('pb-det').textContent = det;
  document.getElementById('pago-fecha').value = hoy();
  document.getElementById('pago-met').value = 'efectivo';
  document.getElementById('pago-ref').value = '';
  document.getElementById('div-abono-extra').style.display = 'none';
  document.getElementById('div-personalizado').style.display = 'none';
  document.getElementById('div-intpendientes').style.display = 'none';
  document.getElementById('div-sumar-int').style.display = 'none';
  document.getElementById('div-periodos').style.display = 'none';
  document.getElementById('tp-cuota').checked = true;
  const ipBox = document.getElementById('pb-intpend-box');
  if (ip > 0) { ipBox.style.display = 'flex'; document.getElementById('pb-intpend-val').textContent = '$' + fmt(ip); }
  else { ipBox.style.display = 'none'; }
  document.getElementById('pago-max-intpend').textContent = '$' + fmt(ip);
  openM('m-pago');
}

// Muestra el sub-formulario correspondiente a la opción de pago elegida y, para
// "Seleccionar cuotas/meses", arma la lista de cuotas pendientes marcables.
function refreshPagoOpcion() {
  const tp = document.querySelector('input[name="tp"]:checked')?.value;
  id('div-abono-extra').style.display = tp === 'abono' ? 'block' : 'none';
  id('div-periodos').style.display = tp === 'periodos' ? 'block' : 'none';
  id('div-personalizado').style.display = tp === 'personalizado' ? 'block' : 'none';
  id('div-intpendientes').style.display = tp === 'intpendientes' ? 'block' : 'none';
  id('div-sumar-int').style.display = tp === 'sumar_int_capital' ? 'block' : 'none';
  if (tp === 'periodos') poblarPeriodosChecklist();
}

function poblarPeriodosChecklist() {
  const pid = +V('pago-pid');
  const p = S.prestamos.find(x => x.id === pid);
  const cont = document.getElementById('periodos-checklist');
  if (!p || p.tipo !== 'amortizable' || !p.cuotas) {
    cont.innerHTML = '<p class="text-m">Esta opción solo aplica a créditos amortizables.</p>';
    setT('periodos-total', '$0');
    return;
  }
  const pend = [...p.cuotas].filter(c => c.estado === 'pendiente').sort((a, b) => a.numero - b.numero);
  if (!pend.length) {
    cont.innerHTML = '<p class="text-m">Sin cuotas pendientes.</p>';
    setT('periodos-total', '$0');
    return;
  }
  cont.innerHTML = pend.map(c => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:.85rem;border-bottom:1px solid var(--border)">
      <input type="checkbox" class="periodo-ck" value="${c.numero}" data-total="${c.total}" />
      <span style="flex:1">${c.etiqueta || 'Cuota #' + c.numero} — ${fmtF(c.fechaVence)}</span>
      <b class="mono">$${fmt(c.total)}</b>
    </label>`).join('');
  cont.querySelectorAll('.periodo-ck').forEach(cb => cb.addEventListener('change', actualizarPeriodosTotal));
  actualizarPeriodosTotal();
}

function actualizarPeriodosTotal() {
  const total = Array.from(document.querySelectorAll('.periodo-ck:checked')).reduce((a, cb) => a + (+cb.dataset.total), 0);
  setT('periodos-total', '$' + fmt(total));
}

async function confPago() {
  const pid = +V('pago-pid');
  const tp = document.querySelector('input[name="tp"]:checked')?.value;
  if (!tp) return Swal.fire('Error', 'Seleccione opción de pago', 'error');

  const payload = {
    tipoPago: tp,
    fecha: V('pago-fecha'),
    metodo: V('pago-met'),
    referencia: V('pago-ref')
  };
  if (tp === 'sumar_int_capital') payload.sumarConfirm = id('chk-sumar-confirm') ? id('chk-sumar-confirm').checked : false;
  if (tp === 'abono') payload.montoExtra = +V('pago-extra') || 0;
  if (tp === 'periodos') payload.cuotas = Array.from(document.querySelectorAll('.periodo-ck:checked')).map(cb => +cb.value);
  if (tp === 'personalizado') { payload.interesPagado = +V('pago-int') || 0; payload.capitalPagado = +V('pago-cap') || 0; }
  if (tp === 'intpendientes') payload.montoIntPend = +V('pago-intpend-monto') || 0;

  try {
    const result = await api.post(`/prestamos/${pid}/pagos`, payload);
    await bootstrap();
    closeM('m-pago');
    if (result.pago) {
      const pg = result.pago;
      Swal.fire({
        icon: 'success',
        title: '¡Pago registrado!',
        html: `$${fmt(pg.monto)}<br><small>${result.desc||''}</small>${pg.intPendienteQuedo>0?`<br><span style="color:var(--w);font-weight:700">⚠ Int. pendientes quedan: $${fmt(pg.intPendienteQuedo)}</span>`:''}`,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-receipt"></i> Comprobante',
        cancelButtonText: 'Cerrar'
      }).then(r => { if (r.isConfirmed) printComp(pg.id); });
    } else if (result.prestamo) {
      Swal.fire('Éxito', `Intereses pendientes sumados al capital. Nuevo saldo: $${fmt(result.prestamo.saldo)}`, 'success');
    }
  } catch (err) {
    if (err.status === 501) Swal.fire('Info', errMsg(err), 'info');
    else if (err.status === 400 && /confirmaci/i.test(errMsg(err))) Swal.fire('Confirmación', errMsg(err), 'warning');
    else Swal.fire('Error', errMsg(err), 'error');
  }
}

function verPre(pid) {
  const p = S.prestamos.find(x => x.id === pid);
  if (!p) return;
  document.getElementById('m-det-title').textContent = `Crédito #${p.id} — ${p.clienteNombre}`;
  const pags = S.pagos.filter(pg => pg.prestamoId === pid && pg.estado === 'pagado');
  const tPag = pags.reduce((a, pg) => a + pg.monto, 0);
  const ip = p.interesesPendientes || 0;
  const gH = (p.garantias || []).map(g => `<span class="gb gb-${g}">${g}</span>`).join(' ');
  let html = `
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
      <div class="stat"><div><div class="stat-lbl">Monto</div><div class="stat-val" style="font-size:1.1rem">$${fmt(p.monto)}</div></div></div>
      <div class="stat"><div><div class="stat-lbl">Saldo</div><div class="stat-val" style="font-size:1.1rem;color:var(--r)">$${fmt(p.saldo)}</div></div></div>
      <div class="stat"><div><div class="stat-lbl">Int. Pend.</div><div class="stat-val" style="font-size:1.1rem;color:var(--w)">$${fmt(ip)}</div></div></div>
      <div class="stat"><div><div class="stat-lbl">Total Pagado</div><div class="stat-val" style="font-size:1.1rem;color:var(--g)">$${fmt(tPag)}</div></div></div>
    </div>
    <div class="frow">
      <div class="card"><div class="card-hdr"><span class="card-title">Información</span></div><table>${[['Cliente',p.clienteNombre],['Inicio',fmtF(p.fechaInicio)],['Próximo pago',fmtF(p.proximoPago)],['Interés',p.interes+'%'],['Frecuencia',p.frecuencia],['Tipo',p.tipo],['Estado',`<span class="badge ${p.estado==='pagado'?'bg-gray':p.estado==='moroso'?'bg-r':'bg-g'}">${p.estado}</span>`],['Garantías',gH],['Notas',p.notas||'—']].map(r=>`<tr><td style="padding:5px 9px;color:var(--muted)">${r[0]}</td><td style="padding:5px 9px">${r[1]}</td>`).join('')}</table></div>
      <div class="card"><div class="card-hdr"><span class="card-title">Resumen Pagos</span></div><table>${[['Cuotas pagadas',pags.length],['Total pagado','$'+fmt(tPag)],['Intereses cobrados','$'+fmt(pags.reduce((a,pg)=>a+(pg.intereses||0),0))],['Capital amortizado','$'+fmt(pags.reduce((a,pg)=>a+(pg.capital||0),0))],['Saldo capital','$'+fmt(p.saldo)],['Int. Pendientes',ip>0?`<span style="color:var(--w);font-weight:700">$${fmt(ip)}</span>`:'—']].map(r=>`<tr><td style="padding:5px 9px;color:var(--muted)">${r[0]}</td><td style="padding:5px 9px;font-weight:700;font-family:'JetBrains Mono',monospace">${r[1]}</td>`).join('')}</table></div>
    </div>
  `;
  if (p.cuotas) {
    html += `<div class="card"><div class="card-hdr"><span class="card-title">Cuotas</span></div><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Vence</th><th>Capital</th><th>Interés</th><th>Total</th><th>Estado</th></tr></thead><tbody>${p.cuotas.slice(0,10).map(c=>`<tr><td>${c.numero}</td><td>${fmtF(c.fechaVence)}</td><td class="mono">$${fmt(c.capital)}</td><td class="mono">$${fmt(c.interes)}</td><td class="mono fw7">$${fmt(c.total)}</td><td><span class="badge ${c.estado==='pagado'?'bg-g':'bg-b'}">${c.estado}</span></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  document.getElementById('m-det-body').innerHTML = html;
  document.getElementById('btn-det-pdf').onclick = () => pdfPre(pid);
  openM('m-detalle');
}

function editLoan(pid) {
  const p = S.prestamos.find(x => x.id === pid);
  if (!p) return;
  document.getElementById('edit-pid').value = pid;
  document.getElementById('edit-monto').value = p.monto;
  document.getElementById('edit-int').value = p.interes;
  document.getElementById('edit-frec').value = p.frecuencia;
  document.getElementById('edit-plazo').value = p.plazoMeses || (p.numCuotas ? (p.numCuotas / (p.frecuencia === 'quincenal' ? 2 : p.frecuencia === 'mensual' ? 1 : p.frecuencia === 'semanal' ? 4 : 30)) : 0);
  document.getElementById('edit-abono').value = p.abonoCapital || 0;
  document.getElementById('edit-warning').style.display = S.pagos.some(pg => pg.prestamoId === pid) ? 'block' : 'none';
  openM('m-editprestamo');
}

async function deleteLoan(pid) {
  const r = await Swal.fire({ title: '¿Eliminar crédito?', text: 'Se eliminará el crédito y sus pagos asociados.', icon: 'warning', showCancelButton: true });
  if (!r.isConfirmed) return;
  try {
    await api.del(`/prestamos/${pid}`);
    await bootstrap();
    Swal.fire('Eliminado', '', 'success');
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

function addDisbursement(pid) {
  const p = S.prestamos.find(x => x.id === pid);
  if (!p) return;
  document.getElementById('des-cred-info').innerHTML = `<div class="alert al-b">Cliente: ${p.clienteNombre} | Saldo actual: $${fmt(p.saldo)}</div>`;
  document.getElementById('des-monto').value = '';
  document.getElementById('des-concepto').value = '';
  document.getElementById('des-fecha').value = hoy();
  window._disbursePid = pid;
  openM('m-desembolso');
}

async function confirmDisbursement() {
  const pid = window._disbursePid;
  let extra = +document.getElementById('des-monto').value;
  if (isNaN(extra) || extra <= 0) return Swal.fire('Error', 'Monto válido requerido', 'error');
  const concepto = document.getElementById('des-concepto').value.trim();
  const fecha = document.getElementById('des-fecha').value || hoy();
  try {
    const p = await api.post(`/prestamos/${pid}/desembolso`, { monto: extra, concepto, fecha });
    await bootstrap();
    closeM('m-desembolso');
    Swal.fire({ icon: 'success', title: 'Sobre crédito agregado', text: `Nuevo saldo: $${fmt(p.saldo)}` });
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

function editPayment(pgid) {
  const pg = S.pagos.find(x => x.id === pgid);
  if (!pg) return;
  document.getElementById('edit-pay-id').value = pg.id;
  document.getElementById('edit-pay-monto').value = pg.monto;
  document.getElementById('edit-pay-capital').value = pg.capital || 0;
  document.getElementById('edit-pay-interes').value = pg.intereses || 0;
  document.getElementById('edit-pay-fecha').value = pg.fechaPago;
  document.getElementById('edit-pay-metodo').value = pg.metodo || 'efectivo';
  document.getElementById('edit-pay-ref').value = pg.referencia || '';
  openM('m-editpago');
}

async function saveEditPayment() {
  const pgid = +document.getElementById('edit-pay-id').value;
  const payload = {
    monto: +document.getElementById('edit-pay-monto').value,
    capital: +document.getElementById('edit-pay-capital').value,
    interes: +document.getElementById('edit-pay-interes').value,
    fecha: document.getElementById('edit-pay-fecha').value,
    metodo: document.getElementById('edit-pay-metodo').value,
    referencia: document.getElementById('edit-pay-ref').value
  };
  try {
    await api.put(`/pagos/${pgid}`, payload);
    await bootstrap();
    closeM('m-editpago');
    Swal.fire('Actualizado', 'El pago ha sido modificado', 'success');
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

function verTodasCuotas(pid) {
  const p = S.prestamos.find(x => x.id === pid);
  if (!p || !p.cuotas) return;
  const h = hoy();
  const filas = [...p.cuotas].sort((a, b) => a.numero - b.numero).map(c => {
    const est = c.estado === 'pagado' ? '<span style="color:var(--g);font-weight:700">✓ Pagada</span>' : c.fechaVence < h ? '<span style="color:var(--r);font-weight:700">⚠ Vencida</span>' : '<span style="color:var(--b)">Pendiente</span>';
    return `<tr style="font-size:.81rem"><td style="padding:5px 8px">#${c.numero}</td><td style="padding:5px 8px">${fmtF(c.fechaVence)}<div style="font-size:.7rem;color:var(--p)">${c.etiqueta||''}</div></td><td style="padding:5px 8px;font-family:monospace;font-weight:700;color:var(--p)">$${fmt(c.total)}</td><td style="padding:5px 8px;font-family:monospace;color:var(--g)">$${fmt(c.capital)}</td><td style="padding:5px 8px;font-family:monospace;color:var(--w)">$${fmt(c.interes)}</td><td style="padding:5px 8px">${est}</td></tr>`;
  }).join('');
  Swal.fire({
    title: `Cuotas — Crédito #${p.id} (${p.clienteNombre})`,
    width: 680,
    html: `<div style="max-height:400px;overflow-y:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f0edf8;font-size:.73rem;text-transform:uppercase;color:var(--p)"><th style="padding:7px">N°</th><th style="padding:7px">Vence</th><th style="padding:7px">Total</th><th style="padding:7px">Capital</th><th style="padding:7px">Interés</th><th style="padding:7px">Estado</th></tr></thead><tbody>${filas}</tbody></table></div>`,
    showCancelButton: true,
    showConfirmButton: false,
    cancelButtonText: 'Cerrar'
  });
}

function printComp(pgid) {
  const pg = S.pagos.find(x => x.id === pgid);
  if (!pg) return;
  Swal.fire({
    icon: 'info',
    title: 'Comprobante',
    text: `Pago #${pg.id} — $${fmt(pg.monto)} — ${pg.clienteNombre}`,
    confirmButtonText: 'Imprimir',
    showCancelButton: true
  }).then(r => {
    if (r.isConfirmed) {
      const w = window.open('', '_blank', 'width=400,height=600');
      w.document.write(`<html><head><title>Comprobante</title><style>body{font-family:monospace;padding:20px}</style></head><body>
        <h2>PRÉSTAMOS VR</h2>
        <p><b>Comprobante #${pg.id}</b></p>
        <p>Cliente: ${pg.clienteNombre}</p>
        <p>Monto: $${fmt(pg.monto)}</p>
        <p>Capital: $${fmt(pg.capital||0)}</p>
        <p>Intereses: $${fmt(pg.intereses||0)}</p>
        <p>Fecha: ${fmtF(pg.fechaPago)}</p>
        <p>Método: ${pg.metodo||'efectivo'}</p>
        <p>${new Date().toLocaleString('es-CO')}</p>
        <button onclick="window.print()">Imprimir</button>
      </body></html>`);
      w.document.close();
    }
  });
}

function pdfCli(cid) { Swal.fire('Info', `PDF ${cid ? 'cliente ' + cid : 'todos los clientes'}`, 'info'); }
function pdfPre(pid) { Swal.fire('Info', `PDF crédito ${pid}`, 'info'); }

// ==================== FONDEO ====================
function abrirNuevaFuente() {
  id('fuente-id').value = '';
  id('m-fuente-title').textContent = 'Nueva Fuente Externa';
  id('f-prestamista').value = '';
  id('f-monto').value = '';
  id('f-tasa').value = '';
  id('f-frec').value = 'quincenal';
  id('f-fecha').value = hoy();
  id('f-estado').value = 'activo';
  id('f-notas').value = '';
  openM('m-fuente');
}

async function guardarFuente() {
  const eid = V('fuente-id');
  const data = {
    prestamista: V('f-prestamista').trim(),
    monto: +V('f-monto') || 0,
    tasaInteres: +V('f-tasa') || 0,
    frecuencia: V('f-frec'),
    fechaInicio: V('f-fecha'),
    estado: V('f-estado'),
    notas: V('f-notas')
  };
  if (!data.prestamista || !data.monto || !data.tasaInteres || !data.fechaInicio) return Swal.fire('Error', 'Complete todos los campos obligatorios', 'error');
  try {
    if (eid) await api.put(`/fondeo/${eid}`, data);
    else await api.post('/fondeo', data);
    await bootstrap();
    closeM('m-fuente');
    Swal.fire({ icon: 'success', title: 'Fuente guardada', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

function editarFuente(fid) {
  const f = S.fuentesExternas.find(x => x.id === fid);
  if (!f) return;
  id('fuente-id').value = f.id;
  id('m-fuente-title').textContent = 'Editar Fuente Externa';
  id('f-prestamista').value = f.prestamista;
  id('f-monto').value = f.monto;
  id('f-tasa').value = f.tasaInteres;
  id('f-frec').value = f.frecuencia;
  id('f-fecha').value = f.fechaInicio;
  id('f-estado').value = f.estado;
  id('f-notas').value = f.notas || '';
  openM('m-fuente');
}

async function eliminarFuente(fid) {
  const r = await Swal.fire({ title: '¿Eliminar fuente?', text: 'Se eliminará la fuente de fondeo y sus registros asociados.', icon: 'warning', showCancelButton: true });
  if (!r.isConfirmed) return;
  try {
    await api.del(`/fondeo/${fid}`);
    await bootstrap();
    Swal.fire('Eliminada', '', 'success');
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

function pagarFuente(fid) {
  const f = S.fuentesExternas.find(x => x.id === fid);
  if (!f) return;
  id('pf-info').innerHTML = `<div class="alert al-b"><b>${f.prestamista}</b> — Saldo: $${fmt(f.saldo)} — Interés: ${f.tasaInteres}%</div>`;
  id('pf-monto').value = '';
  id('pf-fecha').value = hoy();
  id('btn-pf-confirm').dataset.fid = fid;
  openM('m-pago-fuente');
}

async function confirmarPagoFuente() {
  const fid = +id('btn-pf-confirm').dataset.fid;
  const monto = +id('pf-monto').value || 0;
  const fecha = id('pf-fecha').value || hoy();
  try {
    await api.post(`/fondeo/${fid}/pago`, { monto, fecha });
    await bootstrap();
    closeM('m-pago-fuente');
    Swal.fire({ icon: 'success', title: 'Pago registrado', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire('Error', errMsg(err), 'error');
  }
}

// ==================== BÚSQUEDA GLOBAL ====================
function buscarGlobal(query) {
  if (!query) return;
  const q = query.toLowerCase().trim();
  const resultados = {
    clientes: S.clientes.filter(c => c.nombre.toLowerCase().includes(q) || (c.cedula || '').includes(q)),
    prestamos: S.prestamos.filter(p => p.clienteNombre.toLowerCase().includes(q) || (p.id + '').includes(q)),
    pagos: S.pagos.filter(pg => pg.clienteNombre.toLowerCase().includes(q) || (pg.prestamoId + '').includes(q))
  };
  let html = '';
  if (resultados.clientes.length) {
    html += `<h4 style="margin:8px 0 4px;font-size:.9rem">Clientes (${resultados.clientes.length})</h4><ul style="list-style:none;padding:0">`;
    resultados.clientes.slice(0, 5).forEach(c => html += `<li style="padding:4px 0;border-bottom:1px solid #f3f4f6"><a onclick="verCli(${c.id});closeM('m-busqueda')" style="cursor:pointer;color:var(--p);font-weight:600">${c.nombre} (${c.cedula})</a></li>`);
    html += `</ul>`;
  }
  if (resultados.prestamos.length) {
    html += `<h4 style="margin:8px 0 4px;font-size:.9rem">Préstamos (${resultados.prestamos.length})</h4><ul style="list-style:none;padding:0">`;
    resultados.prestamos.slice(0, 5).forEach(p => html += `<li style="padding:4px 0;border-bottom:1px solid #f3f4f6"><a onclick="verPre(${p.id});closeM('m-busqueda')" style="cursor:pointer;color:var(--p);font-weight:600">#${p.id} - ${p.clienteNombre} - $${fmt(p.monto)}</a></li>`);
    html += `</ul>`;
  }
  if (resultados.pagos.length) {
    html += `<h4 style="margin:8px 0 4px;font-size:.9rem">Pagos (${resultados.pagos.length})</h4><ul style="list-style:none;padding:0">`;
    resultados.pagos.slice(0, 5).forEach(pg => html += `<li style="padding:4px 0;border-bottom:1px solid #f3f4f6">${pg.clienteNombre} - $${fmt(pg.monto)} (${fmtF(pg.fechaPago)})</li>`);
    html += `</ul>`;
  }
  if (!html) html = '<p class="text-m">Sin resultados</p>';

  let modal = id('m-busqueda');
  if (!modal) {
    const div = document.createElement('div');
    div.id = 'm-busqueda';
    div.className = 'modal';
    div.innerHTML = `<div class="mbox" style="max-width:600px"><div class="mhdr"><h2><i class="fas fa-search"></i> Resultados</h2><button class="mclose" data-m="m-busqueda">&times;</button></div><div class="mbody" id="busqueda-body"></div><div class="mfoot"><button class="btn btn-outline btn-sm" data-m="m-busqueda">Cerrar</button></div></div>`;
    document.body.appendChild(div);
    div.querySelector('.mclose').addEventListener('click', () => closeM('m-busqueda'));
    div.querySelector('[data-m]').addEventListener('click', () => closeM('m-busqueda'));
  }
  id('busqueda-body').innerHTML = html;
  openM('m-busqueda');
}

// ==================== ALERTAS AL INICIAR ====================
function checkAlertas() {
  const h = hoy();
  const hoyVenc = [];
  const mora = [];
  let intPendAlta = false;
  S.prestamos.forEach(p => {
    if (p.estado === 'pagado') return;
    if (p.estado === 'moroso') mora.push(p);
    if (p.interesesPendientes > 100000) intPendAlta = true;
    if (p.tipo === 'amortizable' && p.cuotas) {
      p.cuotas.filter(c => c.estado === 'pendiente' && c.fechaVence === h).forEach(c => hoyVenc.push({ cliente: p.clienteNombre, monto: c.total }));
    }
  });
  let msg = '';
  if (hoyVenc.length) msg += `📅 ${hoyVenc.length} cuota(s) vencen hoy.\n`;
  if (mora.length) msg += `⚠️ ${mora.length} crédito(s) en mora.\n`;
  if (intPendAlta) msg += `💰 Hay intereses pendientes acumulados altos (>= $100k).\n`;
  if (msg) Swal.fire({ title: '📢 Alertas del sistema', text: msg, icon: 'warning', confirmButtonText: 'Ver' });
}

// ==================== SETUP EVENTOS ====================
function setupEvents() {
  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      await api.post('/auth/login', { user: V('u-user'), pass: V('u-pass') });
      await mostrarApp();
    } catch (err) {
      Swal.fire('Error', errMsg(err) || 'Credenciales incorrectas', 'error');
    }
  });

  document.getElementById('btn-logout').addEventListener('click', async function () {
    try { await api.post('/auth/logout'); } catch (e) { /* ignorar */ }
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-wrap').style.display = 'flex';
  });

  document.querySelectorAll('.sb-nav a').forEach(a => {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
      const modId = 'mod-' + this.dataset.mod;
      document.getElementById(modId)?.classList.add('active');
      document.querySelectorAll('.sb-nav a').forEach(x => x.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('pg-title').textContent = this.textContent.trim();
      if (window.innerWidth <= 1024) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('open');
      }
    });
  });

  document.getElementById('menu-tog').addEventListener('click', function () {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('open');
  });
  document.getElementById('overlay').addEventListener('click', function () {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('open');
  });

  // Pestañas (Préstamos / Cobranzas / Configuración) — genérico para cualquier .tabs.
  document.querySelectorAll('.tabs').forEach(tabsEl => {
    tabsEl.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', function () {
        tabsEl.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const parent = tabsEl.parentElement;
        parent.querySelectorAll(':scope > .tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(this.dataset.tab)?.classList.add('active');
      });
    });
  });

  document.getElementById('btn-sv-cap').addEventListener('click', async function () {
    const v = +document.getElementById('cap-val').value;
    if (isNaN(v) || v < 0) return;
    try {
      await api.put('/config', { capitalBase: v });
      await bootstrap();
      closeM('m-capital');
      Swal.fire({ icon: 'success', title: 'Capital guardado', timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Error', errMsg(err), 'error');
    }
  });

  document.getElementById('btn-add-cli').addEventListener('click', function () {
    document.getElementById('m-cli-title').textContent = 'Nuevo Cliente';
    document.getElementById('cli-id').value = '';
    document.getElementById('f-cliente').reset();
    openM('m-cliente');
  });
  document.getElementById('btn-sv-cli').addEventListener('click', saveCli);
  document.getElementById('src-cli').addEventListener('input', renderClientes);
  document.getElementById('flt-cli').addEventListener('change', renderClientes);
  document.getElementById('btn-export-cli').addEventListener('click', function () { pdfCli(null); });

  document.getElementById('btn-cli-rap').addEventListener('click', function () {
    document.getElementById('cr-nom').value = '';
    document.getElementById('cr-ced').value = '';
    document.getElementById('cr-tel').value = '';
    openM('m-cli-rap');
  });
  document.getElementById('btn-sv-cr').addEventListener('click', async function () {
    const nom = document.getElementById('cr-nom').value.trim(), ced = document.getElementById('cr-ced').value.trim(), tel = document.getElementById('cr-tel').value.trim();
    if (!nom || !ced || !tel) return Swal.fire('Error', 'Complete todos los campos', 'error');
    try {
      const n = await api.post('/clientes', { nombre: nom, cedula: ced, telefono: tel });
      await bootstrap();
      closeM('m-cli-rap');
      document.getElementById('pre-cli-src').value = `${n.nombre} (${n.cedula})`;
      document.getElementById('pre-cli-id').value = n.id;
      document.getElementById('pre-cli-info').textContent = `📞 ${n.telefono}`;
    } catch (err) {
      Swal.fire('Error', errMsg(err), 'error');
    }
  });

  document.getElementById('btn-add-pre').addEventListener('click', function () {
    actualizarListaFuentes();
    abrirNuevoPre();
  });
  document.getElementById('btn-sv-pre').addEventListener('click', savePre);

  // Muestra/oculta el panel de detalles de cada garantía al marcar/desmarcar su checkbox.
  document.querySelectorAll('.gar-ck').forEach(cb => {
    cb.addEventListener('change', function () {
      document.getElementById('gd-' + this.value)?.classList.toggle('show', this.checked);
    });
  });

  // Conecta el buscador de cliente (datalist) con el id oculto que usa savePre().
  document.getElementById('pre-cli-src').addEventListener('input', function () {
    const match = S.clientes.find(c => `${c.nombre} (${c.cedula})` === this.value);
    if (match) {
      id('pre-cli-id').value = match.id;
      id('pre-cli-info').textContent = `📞 ${match.telefono}`;
    } else {
      id('pre-cli-id').value = '';
      id('pre-cli-info').textContent = '';
    }
  });

  // Muestra los campos de Plazo/N° Cuotas solo para crédito amortizable, y mantiene el
  // "Resumen del Crédito" actualizado con cualquier cambio relevante del formulario.
  document.getElementById('pre-tipo').addEventListener('change', function () {
    document.getElementById('div-amort').style.display = this.value === 'amortizable' ? 'block' : 'none';
    calcResumen();
  });
  document.getElementById('pre-frec').addEventListener('change', function () {
    document.getElementById('abono-box').style.display = this.value === 'quincenal' ? 'block' : 'none';
    calcResumen();
  });
  document.getElementById('pre-tiene-abono').addEventListener('change', function () {
    document.getElementById('abono-detail').classList.toggle('show', this.checked);
    calcResumen();
  });
  ['pre-monto', 'pre-int', 'pre-plazo', 'pre-ncuotas', 'pre-abono'].forEach(fid => {
    document.getElementById(fid).addEventListener('input', calcResumen);
  });

  document.getElementById('btn-simular').addEventListener('click', function () {
    Swal.fire({
      title: 'Simulador Quincenal',
      width: 520,
      html: `<div style="text-align:left;padding:4px">
        ${[['sim-m','Monto ($)','5000000','number'],['sim-i','Interés mensual (%)','10','number'],['sim-a','Abono capital 2ª quincena ($)','0','number'],['sim-ms','Meses','1','number']].map(([sid,lbl,ph,t])=>`<div style="margin-bottom:10px"><label style="font-weight:600;font-size:.88rem;display:block;margin-bottom:5px">${lbl}</label><input type="${t}" id="${sid}" value="${ph}" class="swal2-input" style="margin:0"></div>`).join('')}
        <div id="sim-res" style="background:#f9fafb;padding:12px;border-radius:8px;margin-top:10px;display:none;font-size:.86rem"></div>
      </div>`,
      showCancelButton: true,
      cancelButtonText: 'Cerrar',
      confirmButtonText: 'Calcular',
      didOpen: () => {
        document.querySelector('.swal2-confirm').addEventListener('click', (e) => {
          e.stopPropagation();
          const mo = +document.getElementById('sim-m').value || 0, ti = +document.getElementById('sim-i').value || 0, ab = +document.getElementById('sim-a').value || 0, ms = +document.getElementById('sim-ms').value || 1;
          if (!mo || !ti) return;
          let saldo = mo, totInt = 0, rows = '', tasa = ti / 100;
          for (let m = 1; m <= ms; m++) {
            const intQ = roundM(saldo * tasa / 2), ab2 = roundM(Math.min(ab, saldo));
            const q2 = intQ + ab2;
            totInt += intQ * 2;
            rows += `<tr style="font-size:.8rem"><td style="padding:3px 7px">${m}</td><td style="padding:3px 7px;font-family:monospace">$${fmt(intQ)}</td><td style="padding:3px 7px;font-family:monospace">$${fmt(q2)}</td><td style="padding:3px 7px;font-family:monospace;color:#059669">$${fmt(ab2)}</td><td style="padding:3px 7px;font-family:monospace;color:var(--p)">$${fmt(Math.max(0,saldo-ab2))}</td></tr>`;
            saldo = Math.max(0, saldo - ab2);
            if (saldo <= 0) break;
          }
          const res = document.getElementById('sim-res');
          if (!res) return;
          res.style.display = 'block';
          res.innerHTML = `<div style="font-weight:700;color:#111827;margin-bottom:8px">Simulación — ${ms} mes(es)</div>
            <table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f1f5f9;font-size:.74rem;text-transform:uppercase"><th style="padding:5px 7px">Mes</th><th style="padding:5px 7px">1ª Quin.</th><th style="padding:5px 7px">2ª Quin.</th><th style="padding:5px 7px">Abono</th><th style="padding:5px 7px">Saldo</th></tr></thead><tbody>${rows}</tbody></table>
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb"><b>Total intereses:</b> $${fmt(roundM(totInt))} &nbsp;|&nbsp; <b>Total a pagar:</b> $${fmt(roundM(mo+totInt))}</div>`;
        });
      },
      preConfirm: () => false
    });
  });

  document.getElementById('btn-add-pago').addEventListener('click', function () {
    const act = S.prestamos.filter(p => p.estado !== 'pagado');
    if (!act.length) return Swal.fire('Info', 'Sin créditos activos', 'info');
    Swal.fire({
      title: 'Registrar Pago',
      input: 'select',
      inputOptions: Object.fromEntries(act.map(p => [p.id, `${p.clienteNombre} — #${p.id} — $${fmt(p.saldo)}`])),
      inputPlaceholder: 'Seleccione...',
      showCancelButton: true,
      confirmButtonText: 'Continuar'
    }).then(r => { if (r.isConfirmed && r.value) abrirPago(+r.value); });
  });
  document.getElementById('btn-conf-pago').addEventListener('click', confPago);
  document.querySelectorAll('input[name="tp"]').forEach(r => r.addEventListener('change', refreshPagoOpcion));

  document.getElementById('btn-add-fuente').addEventListener('click', abrirNuevaFuente);
  document.getElementById('btn-sv-fuente').addEventListener('click', guardarFuente);
  document.getElementById('btn-pf-confirm').addEventListener('click', confirmarPagoFuente);

  document.getElementById('btn-gen-rep').addEventListener('click', function () {
    const de = V('rep-desde'), ha = V('rep-hasta'), ti = V('rep-tipo'), cont = document.getElementById('rep-resultado');
    cont.innerHTML = `<div class="card"><div class="card-hdr"><span class="card-title">Reporte ${ti}</span></div><p class="text-m">Generado desde ${de||'inicio'} hasta ${ha||'hoy'}</p></div>`;
  });

  document.getElementById('btn-clr-audit').addEventListener('click', function () {
    Swal.fire({ title: '¿Limpiar auditoría?', showCancelButton: true }).then(async r => {
      if (r.isConfirmed) {
        try { await api.del('/auditoria'); await bootstrap(); } catch (err) { Swal.fire('Error', errMsg(err), 'error'); }
      }
    });
  });

  document.getElementById('btn-save-cfg').addEventListener('click', async function () {
    try {
      await api.put('/config', {
        capitalBase: +V('cfg-cap') || 0,
        capitalDisponible: +V('cfg-capdisp-input') || 0,
        interes: +V('cfg-int') || 10,
        gracia: +V('cfg-gracia') || 5,
        minimo: +V('cfg-min') || 0,
        moratoria: +V('cfg-mora') || 3,
        frec: V('cfg-frec')
      });
      await bootstrap();
      Swal.fire({ icon: 'success', title: 'Guardado', timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Error', errMsg(err), 'error');
    }
  });
  document.getElementById('btn-ch-pass').addEventListener('click', async function () {
    const p1 = V('cfg-p1'), p2 = V('cfg-p2');
    if (!p1) return Swal.fire('Error', 'Ingrese contraseña', 'error');
    if (p1 !== p2) return Swal.fire('Error', 'Las contraseñas no coinciden', 'error');
    try {
      await api.post('/auth/change-password', { pass: p1 });
      Swal.fire({ icon: 'success', title: 'Contraseña cambiada', timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Error', errMsg(err), 'error');
    }
  });
  document.getElementById('btn-reiniciar').addEventListener('click', function () { openM('m-reiniciar'); });
  document.getElementById('r-confirm').addEventListener('input', function () {
    document.getElementById('btn-do-reiniciar').disabled = this.value !== 'REINICIAR';
  });
  document.getElementById('btn-do-reiniciar').addEventListener('click', async function () {
    if (V('r-confirm') !== 'REINICIAR') return;
    if (document.getElementById('r-backup').checked) {
      const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
      Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `backup-${hoy()}.json` }).click();
    }
    try {
      await api.post('/reset', { confirm: 'REINICIAR' });
      await bootstrap();
      closeM('m-reiniciar');
      Swal.fire({ icon: 'warning', title: 'Sistema reiniciado', timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire('Error', errMsg(err), 'error');
    }
  });

  document.getElementById('global-search').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { const q = this.value.trim(); if (q) buscarGlobal(q); }
  });

  document.querySelectorAll('.mclose, [data-m]').forEach(b => {
    b.addEventListener('click', () => {
      const mid = b.dataset.m || b.closest('.modal')?.id;
      if (mid) closeM(mid);
    });
  });
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeM(m.id); });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  const dashMenuBtn = document.getElementById('dash-menu-btn');
  const dashMenu = document.getElementById('dash-menu');
  dashMenuBtn.addEventListener('click', function (e) { e.stopPropagation(); dashMenu.classList.toggle('open'); });
  document.addEventListener('click', function () { dashMenu.classList.remove('open'); });

  const updFecha = () => {
    document.getElementById('hdr-date').textContent = new Date().toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  updFecha();
  setInterval(updFecha, 60000);

  document.getElementById('btn-rep-pdf')?.addEventListener('click', () => Swal.fire('Info', 'Filtre y genere un reporte, luego exporte', 'info'));
  document.getElementById('file-excel')?.addEventListener('change', function (e) { if (e.target.files[0]) Swal.fire('Info', 'Importar Excel: función disponible', 'info'); });
  document.getElementById('file-json')?.addEventListener('change', function (e) { if (e.target.files[0]) Swal.fire('Info', 'Importar JSON: función disponible', 'info'); });

  document.getElementById('btn-conf-des').addEventListener('click', confirmDisbursement);

  document.getElementById('btn-sv-editpre').addEventListener('click', async function () {
    const pid = +document.getElementById('edit-pid').value;
    const payload = {
      monto: +document.getElementById('edit-monto').value,
      interes: +document.getElementById('edit-int').value,
      frecuencia: document.getElementById('edit-frec').value,
      plazo: +document.getElementById('edit-plazo').value,
      abono: +document.getElementById('edit-abono').value
    };
    try {
      await api.put(`/prestamos/${pid}`, payload);
      await bootstrap();
      closeM('m-editprestamo');
      Swal.fire('Actualizado', 'Los cambios se aplicaron', 'success');
    } catch (err) {
      Swal.fire('Error', errMsg(err), 'error');
    }
  });

  document.getElementById('btn-save-editpay').addEventListener('click', saveEditPayment);

  document.getElementById('btn-save-editcuota').addEventListener('click', async function () {
    const pid = +document.getElementById('edit-cuota-pid').value;
    const num = +document.getElementById('edit-cuota-num').value;
    const payload = {
      fecha: document.getElementById('edit-cuota-fecha').value,
      capital: +document.getElementById('edit-cuota-cap').value,
      interes: +document.getElementById('edit-cuota-int').value
    };
    try {
      await api.put(`/prestamos/${pid}/cuotas/${num}`, payload);
      await bootstrap();
      closeM('m-editcuota');
      Swal.fire('Éxito', 'Cuota actualizada', 'success');
    } catch (err) {
      Swal.fire('Error', errMsg(err), 'error');
    }
  });
}

// ==================== ARRANQUE DE LA APP (tras login o sesión ya activa) ====================
async function mostrarApp() {
  document.getElementById('login-wrap').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  await bootstrap();
  Swal.fire({ icon: 'success', title: '¡Bienvenido!', timer: 1200, showConfirmButton: false });
  if (!S.cfg.capitalBase && !S.cfg.ganancias) setTimeout(() => { id('cap-val').value = ''; openM('m-capital'); }, 800);
  checkAlertas();
}

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async function () {
  setupEvents();
  try {
    await api.get('/auth/me');
    // Ya hay una sesión activa (cookie httpOnly válida): entrar directo, sin re-pedir login.
    document.getElementById('login-wrap').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    await bootstrap();
    checkAlertas();
  } catch (e) {
    // Sin sesión: se queda en la pantalla de login.
  }
});

// ==================== EXPONER FUNCIONES GLOBALES (usadas desde onclick="" en el HTML) ====================
window.verCli = verCli;
window.editCli = editCli;
window.pagoDesde = pagoDesde;
window.verPre = verPre;
window.editLoan = editLoan;
window.deleteLoan = deleteLoan;
window.addDisbursement = addDisbursement;
window.editPayment = editPayment;
window.verTodasCuotas = verTodasCuotas;
window.printComp = printComp;
window.pdfCli = pdfCli;
window.pdfPre = pdfPre;
window.abrirPago = abrirPago;
window.exportToExcel = exportToExcel;
window.abrirCapital = abrirCapital;
window.upd = upd;
window.toggleMenu = toggleMenu;
window.buscarGlobal = buscarGlobal;
window.pagarFuente = pagarFuente;
window.editarFuente = editarFuente;
window.eliminarFuente = eliminarFuente;
window.confPago = confPago;
window.savePre = savePre;
window.confirmDisbursement = confirmDisbursement;
window.closeM = closeM;

console.log('✅ PRÉSTAMOS VR (frontend) cargado — consumiendo API en /api');
