/* INFRAMEN - utilidades compartidas, barra de navegación por rol y arranque de cada página.
   Los datos viven en MySQL y se leen/guardan mediante el servidor (server.js). */

/* ================== Utilidades ================== */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fmtF = f => f.slice(8) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4);
const pad = (n, l = 3) => String(n).padStart(l, '0');
const horasTxt = n => Number(n).toLocaleString('es-SV', { maximumFractionDigits: 1 }) + ' h';
// "Nombre Nombre Apellido Apellido" -> "Apellido Apellido, Nombre Nombre" (para ordenar y mostrar listas)
const apellidosPrimero = n => { const p = String(n).trim().split(/\s+/); if (p.length < 2) return n; const k = p.length >= 3 ? 2 : 1; return p.slice(-k).join(' ') + ', ' + p.slice(0, -k).join(' '); };
const porApellido = (x, y) => apellidosPrimero(x.nombre).localeCompare(apellidosPrimero(y.nombre), 'es');

async function api(url, datos, metodo) {
  const o = {};
  if (datos !== undefined || metodo) {
    o.method = metodo || 'POST';
    if (datos !== undefined) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(datos); }
  }
  const r = await fetch(url, o);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || (r.status === 404 ? 'Función no disponible: reinicia el servidor con la versión más reciente' : 'Error del servidor (' + r.status + ')')); e.status = r.status; throw e; }
  return j;
}

/* Iconos (trazo, estilo línea) */
const I = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  rotate: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  ok: '<polyline points="20 6 9 17 4 12"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
};
const ico = (n, c = '') => `<svg class="ico ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const poner = (r = document) => $$('[data-ico]', r).forEach(e => { if (!e.dataset.ok) { e.insertAdjacentHTML('afterbegin', ico(e.dataset.ico) + (e.textContent.trim() ? ' ' : '')); e.dataset.ok = 1; } });

function toast(t) {
  let e = $('.toast') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast' }));
  e.textContent = t; e.classList.add('on'); clearTimeout(e.t); e.t = setTimeout(() => e.classList.remove('on'), 3200);
}

function bajar(n, t) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + t], { type: 'text/csv' })); a.download = n; a.click();
}

function pdf(titulo, cols, filas, nombre) {
  if (!window.jspdf) return toast('No se pudo cargar la librería de PDF');
  const doc = new jspdf.jsPDF(); doc.setFontSize(16); doc.text(titulo, 14, 18); doc.setFontSize(10);
  doc.text('INFRAMEN · ' + new Date().toLocaleDateString('es-SV'), 14, 25);
  doc.autoTable({ startY: 30, head: [cols], body: filas, headStyles: { fillColor: [123, 18, 48] } }); doc.save(nombre);
}

function modal(titulo, html, ancho) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="modal-box${ancho ? ' ancho' : ''}"><div class="modal-h"><h3>${esc(titulo)}</h3><button class="icon-x" data-x type="button">${ico('x')}</button></div><div class="modal-b">${html}</div></div>`;
  const k = e => { if (e.key === 'Escape') cerrar(); };
  const cerrar = () => { m.remove(); document.removeEventListener('keydown', k); };
  m.onclick = e => { if (e.target === m || e.target.closest('[data-x]')) cerrar(); };
  document.addEventListener('keydown', k); document.body.appendChild(m); m.cerrar = cerrar; poner(m);
  return m;
}

function paginador(el, info, total, pag, por, ir) {
  const n = Math.max(1, Math.ceil(total / por));
  info.textContent = `Mostrando ${total ? (pag - 1) * por + 1 : 0} - ${Math.min(total, pag * por)} de ${total}`;
  let h = `<button ${pag <= 1 ? 'disabled' : ''} data-p="${pag - 1}">‹</button>`;
  for (let i = 1; i <= n; i++) {
    if (i === 1 || i === n || Math.abs(i - pag) <= 1) h += `<button class="${i === pag ? 'on' : ''}" data-p="${i}">${i}</button>`;
    else if (Math.abs(i - pag) === 2) h += '<span>…</span>';
  }
  el.innerHTML = h + `<button ${pag >= n ? 'disabled' : ''} data-p="${pag + 1}">›</button>`;
  el.onclick = e => { const b = e.target.closest('[data-p]'); if (b && !b.disabled) ir(+b.dataset.p); };
}

const stat = (i, t, v) => `<div class="card stat"><div class="caja">${ico(i)}</div><div><small>${esc(t)}</small><b>${esc(v)}</b></div></div>`;
const confirmar = t => confirm(t);

// Barra de progreso de horas: validadas sobre la meta
const barra = h => `<div class="prog${h >= CFG.meta_horas ? ' ok' : ''}"><div class="pista"><i style="width:${Math.min(100, h / CFG.meta_horas * 100)}%"></i></div><small>${Number(h).toLocaleString('es-SV', { maximumFractionDigits: 1 })} / ${CFG.meta_horas}</small></div>`;
const estadoHoras = h => h >= CFG.meta_horas ? 'Completado' : h > 0 ? 'En curso' : 'Sin horas';
const pillEstadoHoras = h => `<span class="pill ${h >= CFG.meta_horas ? 'st-c' : h > 0 ? 'st-e' : 'st-s'}">${estadoHoras(h)}</span>`;
// Estado de un registro de horas. Con largo=true usa los textos del estudiante (Pendiente de validación / Validada / Rechazada)
const pillRegistro = (e, largo) => {
  const t = { validado: ['p-valid', 'Validado', 'Validada'], rechazado: ['p-rech', 'Rechazado', 'Rechazada'], pendiente: ['p-pend', 'Pendiente', 'Pendiente de validación'] }[e] || ['p-pend', e, e];
  return `<span class="pill ${t[0]}">${largo ? t[2] : t[1]}</span>`;
};
// Anillo (gráfico circular) de progreso
const anillo = (pct, grande) => `<div class="donut${grande ? ' grande' : ''}" style="background:conic-gradient(var(--vino) 0deg ${Math.min(100, pct) * 3.6}deg,#eee 0)"><i><b>${Math.round(pct)}%</b><small>de la meta</small></i></div>`;

// Lista de avance de horas por sección (tablero del administrador y del docente)
const filasAvance = avance => avance.length
  ? `<div class="avance">${avance.map(g => `<div class="avance-fila"><b title="${esc(g.grupo)}">${esc(g.grupo)}</b>
      <div class="prog${g.pct >= 100 ? ' ok' : ''}"><div class="pista"><i style="width:${g.pct}%"></i></div><small>${g.pct}%</small></div>
      <small>${g.completaron} de ${g.alumnos} completaron</small></div>`).join('')}</div>`
  : '<p class="vacio">Aún no hay estudiantes inscritos.</p>';

/* ================== Roles, accesos y barra superior ================== */
const ROL = { administrador: 'Administrador', docente: 'Docente', alumno: 'Estudiante' };
const PAGINAS = {};   // cada archivo (admin.js, docente.js, alumno.js) registra aquí la lógica de sus páginas
let CFG = { meta_horas: 150, max_horas_semana: 2, institucion: 'Instituto Nacional Francisco Menéndez' };

// Opciones de la barra superior según el rol: [archivo, texto]
const NAV = {
  administrador: [['index', 'Inicio'], ['usuarios', 'Usuarios'], ['secciones', 'Secciones'], ['asignar', 'Asignación'], ['institucion', 'Institución'],
    ['asistencia', 'Asistencia'], ['resumen', 'Resumen'], ['reportes', 'Reportes'], ['perfil', 'Mi Perfil']],
  docente: [['index', 'Inicio'], ['mis-secciones', 'Mis Secciones'], ['estudiantes', 'Estudiantes'], ['horas', 'Registro de Horas'],
    ['asistencia', 'Asistencia'], ['resumen', 'Resumen'], ['reportes', 'Reportes'], ['publicaciones', 'Avisos'], ['perfil', 'Mi Perfil']],
  alumno: [['index', 'Inicio'], ['jornadas', 'Mis jornadas'], ['calendario', 'Calendario'], ['avisos', 'Avisos'], ['perfil', 'Mi perfil']],
};
// Quién puede abrir cada página (el servidor además valida cada petición a la API)
const ACCESO = {
  index: ['administrador', 'docente', 'alumno'], perfil: ['administrador', 'docente', 'alumno'],
  usuarios: ['administrador'], secciones: ['administrador'], asignar: ['administrador'], institucion: ['administrador'],
  'mis-secciones': ['docente'],
  estudiantes: ['administrador', 'docente'], estudiante: ['administrador', 'docente'], horas: ['administrador', 'docente'],
  asistencia: ['administrador', 'docente'], resumen: ['administrador', 'docente'], reportes: ['administrador', 'docente'],
  publicaciones: ['docente'],
  jornadas: ['alumno'], calendario: ['alumno'], avisos: ['alumno'],
};
// Páginas que cuelgan de otra opción del menú
const PADRE = { estudiante: 'estudiantes' };

const LOGO = '<img src="logo/logo.png" alt="Logo">';

function barraSuperior(yo) {
  const pg = document.body.dataset.page, activa = PADRE[pg] || pg;
  const ini = yo.nombre.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  $('#nav').innerHTML = `<header class="navbar" id="navbar">
    <a class="brand" href="index.html">${LOGO}<div><b>INFRAMEN</b><small>${esc(CFG.institucion)}</small></div></a>
    <nav class="menu" id="menu">
      <div class="menu-user"><div class="avatar">${esc(ini)}</div><div><b>${esc(yo.nombre)}</b><small>${ROL[yo.rol]}</small></div></div>
      ${NAV[yo.rol].map(([f, t]) => `<a href="${f}.html"${f === activa ? ' class="activo"' : ''}>${t}</a>`).join('')}
      <a href="#" class="menu-salir" id="salir2">${ico('logout')} Cerrar sesión</a></nav>
    <div class="usuario"><div class="avatar">${esc(ini)}</div><span>${ROL[yo.rol]}</span></div>
    <button class="icon-btn hamb" id="hamb" type="button" aria-label="Abrir menú" aria-expanded="false">${ico('menu')}</button>
    <button class="icon-btn" id="salir" type="button" title="Cerrar sesión">${ico('logout')}</button></header>`;
  const salir = async e => { if (e) e.preventDefault(); await api('/api/logout', {}).catch(() => {}); location.replace('login.html'); };
  $('#salir').onclick = salir; $('#salir2').onclick = salir;

  // Menú desplegable en pantallas pequeñas: opciones + cerrar sesión
  const barra = $('#navbar'), btn = $('#hamb');
  const abrir = on => {
    barra.classList.toggle('abierto', on);
    btn.setAttribute('aria-expanded', on); btn.setAttribute('aria-label', on ? 'Cerrar menú' : 'Abrir menú');
    btn.innerHTML = ico(on ? 'x' : 'menu');
  };
  btn.onclick = e => { e.stopPropagation(); abrir(!barra.classList.contains('abierto')); };
  document.addEventListener('click', e => { if (barra.classList.contains('abierto') && !e.target.closest('#menu')) abrir(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') abrir(false); });
  // El menú pasa a desplegable solo cuando las opciones no caben en la barra
  const ajustar = () => {
    barra.classList.remove('compacto');
    const m = $('#menu'), cabe = m.scrollWidth <= m.clientWidth + 2 && innerWidth > 760;
    if (!cabe) barra.classList.add('compacto'); else abrir(false);
  };
  ajustar(); window.addEventListener('resize', ajustar); window.addEventListener('load', ajustar);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustar);

  document.body.insertAdjacentHTML('beforeend', `<footer class="footer">© ${new Date().getFullYear()} INFRAMEN · ${esc(CFG.institucion)}</footer>`);
}

/* ================== Inicio: cada rol ve su propio panel ================== */
PAGINAS.index = yo => ({ administrador: PAGINAS.inicioAdmin, docente: PAGINAS.inicioDocente, alumno: PAGINAS.inicioAlumno }[yo.rol])(yo);

/* ================== Mi Perfil (todos los roles) ================== */
PAGINAS.perfil = async yo => {
  const p = await api('/api/perfil');
  const ini = p.nombre.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  const alu = p.rol === 'alumno';
  { const sub = $('.titulo p'); if (sub) sub.textContent = alu ? 'Consulta tus datos y actualiza tu contacto.' : p.rol === 'docente' ? 'Consulta tus datos de acceso y tus secciones.' : 'Consulta tus datos y cambia tu PIN de acceso.'; }
  $('#datos').innerHTML = `<div class="perfil-cab"><div class="avatar">${esc(ini)}</div><div><h2>${esc(p.nombre)}</h2><small>${ROL[p.rol]}</small></div></div>
    <div class="fila"><span>NIE / código</span><b>${esc(p.nie || '-')}</b></div><div class="fila"><span>Correo</span><b>${esc(p.correo)}</b></div>
    ${alu ? `<div class="fila"><span>Teléfono</span><b>${esc(p.telefono || 'No registrado')}</b></div>
      <div class="fila"><span>Especialidad</span><b>${esc(p.especialidad || '-')}</b></div><div class="fila"><span>Sección</span><b>${esc(p.seccion_numero ?? '-')}</b></div>`
    : `<div class="fila"><span>Rol</span><b>${ROL[p.rol]}</b></div>${p.seccion ? `<div class="fila"><span>Secciones</span><b>${esc(p.seccion)}</b></div>` : ''}`}`;
  if (alu && $('#fcontacto')) {
    $('#fcontacto').style.display = '';
    $('#cc').value = p.correo; $('#ct').value = p.telefono || '';
    $('#fcontacto').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/alumno/perfil', { correo: $('#cc').value, telefono: $('#ct').value }, 'PUT'); toast('Datos de contacto actualizados'); await PAGINAS.perfil(yo); }
      catch (err) { toast(err.message); }
    };
  }
    if (p.rol !== 'administrador') { $('#cpin')?.remove(); return; }
  $('#fpin').onsubmit = async e => {
    e.preventDefault();
    if ($('#pn').value !== $('#pc').value) return toast('El PIN nuevo y su confirmación no coinciden');
    try { await api('/api/perfil/pin', { actual: $('#pa').value, nuevo: $('#pn').value }); e.target.reset(); toast('PIN actualizado'); } catch (err) { toast(err.message); }
  };
  $$('#fpin input').forEach(i => { i.oninput = () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); }; });
};

/* ================== Tablas en tarjetas (celular): cada dato lleva el nombre de su columna ================== */
function etiquetarTablas() {
  $$('table.tabla-cards').forEach(t => {
    const ths = $$('thead th', t).map(th => th.textContent.trim());
    $$('tbody tr', t).forEach(tr => $$(':scope > td', tr).forEach((td, i) => { if (!td.dataset.l && ths[i]) td.dataset.l = ths[i]; }));
  });
}
let _etq; new MutationObserver(() => { clearTimeout(_etq); _etq = setTimeout(etiquetarTablas, 30); }).observe(document.documentElement, { childList: true, subtree: true });

/* ================== Arranque ================== */
async function arrancar() {
  const pg = document.body.dataset.page;
  let yo;
  try { yo = await api('/api/yo'); } catch { return location.replace('login.html'); }
  if (ACCESO[pg] && !ACCESO[pg].includes(yo.rol)) return location.replace('index.html');
  try { CFG = await api('/api/config'); } catch (e) { if (e.status === 401) return location.replace('login.html'); }
  barraSuperior(yo); poner();
  try { await PAGINAS[pg]?.(yo); }
  catch (e) { if (e.status === 401) location.replace('login.html'); else toast(e.message || 'No se pudo conectar con el servidor'); }
}
document.addEventListener('DOMContentLoaded', arrancar);
