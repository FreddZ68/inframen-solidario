/* INFRAMEN - páginas del docente (el administrador también puede abrirlas; el servidor limita cada docente a sus secciones). */

// Lunes de la semana de una fecha AAAA-MM-DD (para el límite semanal de horas)
const lunes = f => { const x = new Date(f + 'T00:00:00'); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

// Lista desplegable de actividades agrupadas por proyecto + opción de escribir una libre
const opcionesActividad = ACT => {
  const grupos = {}; ACT.forEach(a => { (grupos[a.proyecto || ''] ??= []).push(a); });
  let h = '<option value="">Selecciona una actividad…</option>';
  for (const [k, l] of Object.entries(grupos)) {
    const o = l.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
    h += k ? `<optgroup label="${esc(k)}">${o}</optgroup>` : o;
  }
  return h + '<option value="otra">Otra actividad (escribir)…</option>';
};
// Lee la actividad elegida: id del catálogo o texto libre
const leerActividad = (sel, txt) => sel.value === 'otra' ? { actividad: txt.value, actividad_id: null } : { actividad_id: sel.value || null, actividad: '' };

/* ================== Inicio del docente ================== */
// Selector de año + selector de sección (cada opción lleva su año). Los dos selects deben existir: #ga (año) y #gs (sección).
function llenarAnioSec(secs) {
  const a0 = $('#ga').value, s0 = $('#gs').value;
  const anios = [...new Set(secs.map(s => String(s.anio)))].sort((x, y) => y - x);
  $('#ga').innerHTML = '<option value="">Todos los años</option>' + anios.map(y => `<option value="${y}">Año ${y}</option>`).join('');
  $('#ga').value = anios.includes(a0) ? a0 : '';
  const lista = secs.filter(s => !$('#ga').value || String(s.anio) === $('#ga').value)
    .sort((x, y) => y.anio - x.anio || (x.especialidad + ' ' + x.seccion).localeCompare(y.especialidad + ' ' + y.seccion, 'es', { numeric: true }));
  $('#gs').innerHTML = '<option value="">Todas las secciones</option>' + lista.map(s => `<option value="${s.id}">${esc(s.especialidad + ' ' + s.seccion)} (${s.anio})</option>`).join('');
  $('#gs').value = lista.some(s => String(s.id) === s0) ? s0 : '';
}
const grupoAnio = a => a.grupo + (a.anio ? ` (${a.anio})` : '');

PAGINAS.inicioDocente = async yo => {
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Panel Docente</h1><p>Bienvenido(a), ${esc(yo.nombre.split(' ')[0])}</p></div></div>
    <div class="kpis" id="kpis"></div>
    <div class="card bloque" style="margin-bottom:18px"><h2>Avance de mis secciones <small style="color:var(--gris);font-weight:400" id="metaTxt"></small></h2><div id="avance"></div></div>
    <div class="card bloque"><h2>Accesos rápidos</h2><div class="accesos" id="accesos"></div></div>`;
  const r = await api('/api/admin/reportes'), rend = r.rendimiento;
  $('#kpis').innerHTML = stat('users', 'Estudiantes', r.estudiantes) + stat('clock', 'Horas validadas', horasTxt(rend.validadas))
    + stat('rotate', 'Pendientes de validar', horasTxt(rend.pendientes)) + stat('award', 'Completaron la meta', `${rend.completaron} de ${r.estudiantes}`);
  $('#metaTxt').textContent = `· meta: ${r.meta} h por estudiante`;
  $('#avance').innerHTML = filasAvance(r.avance);
  const A = [
    ['estudiantes', 'users', 'Mis estudiantes', 'Lista por sección, perfil e historial de horas'],
    ['asignar', 'plus', 'Alta de estudiantes', 'Crea a tus estudiantes, uno por uno o con un CSV'],
    ['horas', 'clock', 'Registro de horas', 'Carga las horas de varios estudiantes a la vez'],
    ['proyectos', 'folder', 'Proyectos', 'Consulta los proyectos, actividades y documentos'],
    ['asistencia', 'calendar', 'Tomar asistencia', 'Marca quién asistió y agrega observaciones'],
    ['resumen', 'chart', 'Resumen de horas', 'Avance, filtros y reportes en PDF'],
  ];
  $('#accesos').innerHTML = A.map(([f, i, t, s]) => `<a class="acceso" href="${f}.html"><span class="i">${ico(i)}</span><div><b>${t}</b><small>${s}</small></div><em>›</em></a>`).join('');
};

/* ================== Mis Secciones ================== */
PAGINAS['mis-secciones'] = async yo => {
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Mis Secciones</h1><p>Consulta tus grupos asignados</p></div></div><div class="secciones" id="grid"></div>`;
  const [secs, al] = await Promise.all([api('/api/admin/secciones'), api('/api/docente/alumnos')]);
  $('#grid').innerHTML = secs.map(s => {
    const g = s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')', x = al.filter(a => a.seccion_id === s.id);
    const h = x.reduce((t, a) => t + a.validadas, 0), ok = x.filter(a => a.validadas >= CFG.meta_horas).length;
    return `<article class="card seccion"><header><div class="badge">${esc(String(s.seccion))}</div><h3>${esc(g)}</h3></header>
      <div class="dato">${ico('users')}<span>Estudiantes:</span><b>${x.length}</b></div>
      <div class="dato">${ico('clock')}<span>Horas:</span><b>${horasTxt(h)} validadas</b></div>
      <div class="dato">${ico('award')}<span>Completaron:</span><b>${ok} de ${x.length}</b></div>
      ${s.activa ? '' : '<div class="dato"><span class="pill e-ina">Sección inactiva</span></div>'}
      <a class="btn" href="estudiantes.html?seccion=${s.id}">Ver estudiantes ›</a></article>`;
  }).join('') || '<p class="vacio">Aún no tienes secciones asignadas. El administrador puede asignártelas.</p>';
};

/* ================== Estudiantes: listado por sección ================== */
PAGINAS.estudiantes = async yo => {
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Estudiantes</h1><p>Elige un estudiante para ver su historial y registrar horas.</p></div><div class="accion"><a class="btn" href="asignar.html">${ico('plus')} Nuevo estudiante</a></div></div>
    <div class="card filtros"><div class="buscar grow">${ico('search')}<input id="q" placeholder="Buscar por nombre o NIE..."></div><select id="ga"></select><select id="gs"></select></div>
    <div class="card bloque"><div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th>Estudiante</th><th>Sección</th><th>Horas validadas</th><th>Pendientes</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="tb"></tbody></table></div>
    <div class="pie-tabla"><span id="info"></span><div class="pag" id="pag"></div></div></div>`;
  let D = [], pag = 1; const POR = 12;
  const pins = new Map();   // PIN visibles en pantalla (id del estudiante -> PIN)
  const secs = await api('/api/admin/secciones');
  llenarAnioSec(secs);
  const sp = new URLSearchParams(location.search).get('seccion');
  if (sp && secs.some(s => String(s.id) === sp)) { $('#ga').value = String(secs.find(s => String(s.id) === sp).anio); llenarAnioSec(secs); $('#gs').value = sp; }
  const vis = () => { const q = $('#q').value.trim().toLowerCase(), g = $('#gs').value, an = $('#ga').value;
    return D.filter(a => (!g || String(a.seccion_id) === g) && (!an || String(a.anio) === an) && (a.nombre + ' ' + a.nie).toLowerCase().includes(q)).sort(porApellido); };
  const pintar = () => {
    const v = vis(), ult = Math.max(1, Math.ceil(v.length / POR)); if (pag > ult) pag = ult;
    $('#tb').innerHTML = v.slice((pag - 1) * POR, pag * POR).map(a => `<tr class="clic" data-id="${a.id}"><td><b>${esc(apellidosPrimero(a.nombre))}</b><small>${esc(a.nie)}${a.limite_propio ? `<span class="tag">límite ${horasTxt(a.limite)}/semana</span>` : ''}</small></td><td>${esc(grupoAnio(a))}</td>
      <td>${barra(a.validadas)}</td><td>${a.pendientes ? `<span class="pill p-pend">${horasTxt(a.pendientes)}</span>` : '-'}</td><td>${pillEstadoHoras(a.validadas)}</td>
      <td><div class="fila-btns nowrap"><a class="btn claro" href="estudiante.html?id=${a.id}">Ver perfil ›</a>
        ${pins.has(a.id) ? `<b class="pinv">${esc(pins.get(a.id))}</b><button class="btn claro" data-ocultar="${a.id}">Ocultar</button>` : `<button class="btn claro" data-verpin="${a.id}">Ver PIN</button>`}
        <button class="btn claro" data-nuevopin="${a.id}">Nuevo PIN</button></div></td></tr>`).join('')
      || '<tr><td colspan="6" class="vacio">No hay estudiantes con esos filtros.</td></tr>';
    paginador($('#pag'), $('#info'), v.length, pag, POR, p => { pag = p; pintar(); });
    $('#info').textContent = $('#info').textContent.replace(/(\d+)$/, '$1 estudiantes');
  };
  $('#q').oninput = $('#gs').onchange = () => { pag = 1; pintar(); };
  $('#ga').onchange = () => { llenarAnioSec(secs); pag = 1; pintar(); };
  $('#tb').onclick = async e => {
    const b = e.target.closest('button');
    if (b) {
      try {
        if (b.dataset.verpin) { pins.set(+b.dataset.verpin, (await api(`/api/docente/alumnos/${b.dataset.verpin}/pin`)).pin); }
        else if (b.dataset.ocultar) { pins.delete(+b.dataset.ocultar); }
        else if (b.dataset.nuevopin) {
          const a = D.find(x => x.id === +b.dataset.nuevopin);
          if (!confirmar(`¿Generar un PIN nuevo para ${a.nombre}? El anterior dejará de funcionar.`)) return;
          pins.set(a.id, (await api(`/api/docente/alumnos/${a.id}/pin`, {})).pin); toast('PIN nuevo generado');
        }
      } catch (err) { toast(err.message); }
      return pintar();
    }
    const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) location.href = 'estudiante.html?id=' + tr.dataset.id;
  };
  D = await api('/api/docente/alumnos'); pintar();
};

/* ================== Perfil del estudiante: historial y "Agregar registro de horas" ================== */
PAGINAS.estudiante = async yo => {
  const id = +new URLSearchParams(location.search).get('id');
  if (!id) return location.replace('estudiantes.html');
  $('#contenido').innerHTML = '<a class="volver" href="estudiantes.html">' + ico('back') + ' Volver a estudiantes</a><div id="perfilAlu"></div>';
  let P, ACT = [], pag = 1; const POR = 10;

  const cargar = async () => { P = await api('/api/docente/alumnos/' + id); };
  const pintar = () => {
    const a = P.alumno, falta = Math.max(0, P.meta - P.validadas), pct = P.validadas / P.meta * 100, as = P.asistencia;
    const ult = Math.max(1, Math.ceil(P.registros.length / POR)); if (pag > ult) pag = ult;
    $('#perfilAlu').innerHTML = `<div class="alu-grid">
      <div class="card bloque hero">${anillo(pct, true)}<div><h2>${esc(a.nombre)}</h2><small style="color:var(--gris)">NIE ${esc(a.nie)} · ${esc(a.grupo)}${a.anio ? ` (${a.anio})` : ''}</small></div>
        ${pillEstadoHoras(P.validadas)}
        <div class="mini-stats"><div class="mini"><small>Validadas</small><b>${horasTxt(P.validadas)}</b></div><div class="mini"><small>Pendientes</small><b>${horasTxt(P.pendientes)}</b></div>
        <div class="mini"><small>Faltan</small><b>${horasTxt(falta)}</b></div><div class="mini"><small>Meta</small><b>${P.meta} h</b></div></div>
        <div class="mini" style="width:100%;text-align:left"><small>Límite semanal en Registro de horas</small><b>${P.max_semana > 0 ? horasTxt(P.max_semana) : 'Sin límite'}</b>
          <small>${P.limite_propio !== null ? 'Personalizado para este estudiante' : 'Límite general de la institución'} · aquí puedes registrar hasta ${CFG.max_horas_registro || 40} h por registro</small></div>
        <div class="mini-stats"><div class="mini"><small>Presentes</small><b>${as.presente}</b></div><div class="mini"><small>Tardanzas</small><b>${as.tarde}</b></div>
        <div class="mini"><small>Ausencias</small><b>${as.falto}</b></div><div class="mini"><small>Permisos</small><b>${as.permiso}</b></div></div></div>
      <div class="card bloque"><h2>Historial de horas <button class="btn" id="agregar" ${a.activo ? '' : 'disabled'}>${ico('plus')} Agregar registro de horas</button></h2>
        <div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th>Fecha</th><th>Actividad</th><th>Horas</th><th>Estado</th><th>Registró</th><th></th></tr></thead><tbody id="tbh">
        ${P.registros.slice((pag - 1) * POR, pag * POR).map(r => `<tr><td>${fmtF(r.fecha)}</td><td>${esc(r.actividad)}${r.descripcion ? `<small>${esc(r.descripcion)}</small>` : ''}${r.observacion ? `<small class="obs-doc">Observación: ${esc(r.observacion)}</small>` : ''}</td>
          <td><b>${horasTxt(r.horas)}</b></td><td>${pillRegistro(r.estado)}</td><td>${esc(r.registrado_por || '-')}</td>
          <td><div class="acc">${r.estado !== 'validado' ? `<button data-val="${r.id}" title="Validar">${ico('ok')}</button>` : ''}${r.estado !== 'rechazado' ? `<button data-rech="${r.id}" title="Rechazar (con observación)">${ico('x')}</button>` : ''}<button data-del="${r.id}" title="Eliminar">${ico('trash')}</button></div></td></tr>`).join('')
          || '<tr><td colspan="6" class="vacio">Aún no hay horas registradas para este estudiante.</td></tr>'}</tbody></table></div>
        <div class="pie-tabla"><span id="info"></span><div class="pag" id="pag"></div></div></div></div>`;
    paginador($('#pag'), $('#info'), P.registros.length, pag, POR, p => { pag = p; pintar(); });
    $('#info').textContent = $('#info').textContent.replace(/(\d+)$/, '$1 registros');
    poner();
    $('#agregar').onclick = formulario;
    $('#tbh').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.val) { await api(`/api/docente/horas/${b.dataset.val}/validar`, {}); toast('Registro validado'); }
        else if (b.dataset.rech) { return rechazar(+b.dataset.rech); }
        else if (b.dataset.del) { if (!confirmar('¿Eliminar este registro de horas? Se descontará del total del estudiante.')) return; await api(`/api/docente/horas/${b.dataset.del}`, undefined, 'DELETE'); toast('Registro eliminado'); }
        else return;
        await cargar(); pintar();
      } catch (err) { toast(err.message); }
    };
  };

  // Rechazar una jornada: el motivo es obligatorio y lo verá el estudiante en "Mis jornadas"
  const rechazar = rid => {
    const m = modal('Rechazar jornada', `<form class="form-modal" id="fr"><div><label>Motivo del rechazo</label><textarea id="ro" maxlength="255" required minlength="3" placeholder="Explica al estudiante qué debe corregir"></textarea>
      <small>Las horas rechazadas no se suman al avance del estudiante.</small></div>
      <div class="acciones-modal"><button type="button" class="btn claro" data-x>Cancelar</button><button class="btn">Rechazar jornada</button></div></form>`);
    $('#fr', m).onsubmit = async e => {
      e.preventDefault();
      try { await api(`/api/docente/horas/${rid}/rechazar`, { observacion: $('#ro', m).value }); m.cerrar(); await cargar(); pintar(); toast('Jornada rechazada'); }
      catch (err) { toast(err.message); }
    };
  };

  // Desde el perfil se puede registrar hasta MAXREG horas por registro, sin el límite semanal; solo se detiene en la meta total
  const MAXREG = CFG.max_horas_registro || 40;
  const cupo = () => {
    const tot = P.registros.filter(r => r.estado !== 'rechazado').reduce((s, r) => s + r.horas, 0);
    return Math.max(0, Math.round(Math.min(P.meta - tot, MAXREG) * 10) / 10);
  };

  const formulario = () => {
    const m = modal('Agregar registro de horas', `<form class="form-modal" id="fh">
      <div><label>Fecha</label><input type="date" id="hf" required max="${hoy()}"></div>
      <div><label>Actividad realizada</label><select id="ha" required>${opcionesActividad(ACT)}</select></div>
      <div id="wotra" style="display:none"><label>Nombre de la actividad</label><input id="ho" maxlength="100" placeholder="Ej.: Apoyo en biblioteca"></div>
      <div><label>Descripción breve</label><textarea id="hd" maxlength="255" placeholder="¿Qué hizo el estudiante?"></textarea></div>
      <div><label>Cantidad de horas</label><input type="number" id="hh" min="0.1" step="0.1" required><small id="hcupo"></small></div>
      <div><label>Estado</label><select id="he"><option value="validado">Validado (suma a la meta)</option><option value="pendiente">Pendiente de validación</option></select></div>
      <div class="acciones-modal"><button type="button" class="btn claro" data-x>Cancelar</button><button class="btn">${ico('save')} Guardar registro</button></div></form>`, true);
    $('#hf', m).value = hoy();
    const pistas = () => {
      const c = cupo($('#hf', m).value || hoy());
      $('#hcupo', m).textContent = c > 0 ? `Puedes registrar hasta ${horasTxt(c)} en este registro (máximo ${MAXREG} h por registro).` : 'Este estudiante ya alcanzó la meta de horas.';
      $('#hh', m).max = c;
    };
    $('#hf', m).onchange = pistas; pistas();
    $('#ha', m).onchange = () => { $('#wotra', m).style.display = $('#ha', m).value === 'otra' ? '' : 'none'; };
    $('#fh', m).onsubmit = async e => {
      e.preventDefault();
      const b = { fecha: $('#hf', m).value, ...leerActividad($('#ha', m), $('#ho', m)), descripcion: $('#hd', m).value, horas: Number($('#hh', m).value), estado: $('#he', m).value };
      try { await api(`/api/docente/alumnos/${id}/horas`, b); m.cerrar(); await cargar(); pintar(); toast('Horas registradas: el total del estudiante ya se actualizó'); }
      catch (err) { toast(err.message); }
    };
  };

  [ACT] = await Promise.all([api('/api/actividades'), cargar()]);
  pintar();
};

/* ================== Registro de horas (carga masiva): la misma actividad para varios estudiantes ================== */
PAGINAS.horas = async yo => {
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Registro de horas</h1><p id="regla"></p></div></div>
    <div class="card bloque" style="margin-bottom:18px"><h2>Datos de la actividad</h2>
      <div class="form-fila"><div><label>Fecha</label><input type="date" id="fecha" max="${hoy()}"></div>
        <div class="doble"><label>Actividad realizada</label><select id="act"></select></div>
        <div><label>Horas por estudiante</label><input type="number" id="hdef" min="0.1" step="0.1"></div></div>
      <div class="form-fila"><div id="wotra" class="doble" style="display:none"><label>Nombre de la actividad</label><input id="otra" maxlength="100" placeholder="Ej.: Apoyo en biblioteca"></div>
        <div class="doble"><label>Descripción breve (opcional)</label><input id="desc" maxlength="255"></div>
        <div><label>Estado</label><input value="Pendiente" disabled><small>Las horas se guardan como Pendientes mientras se realizan. Al finalizar usa «Validar horas».</small></div></div></div>
    <div class="card filtros"><div class="buscar grow">${ico('search')}<input id="q" placeholder="Buscar por nombre o NIE..."></div><select id="ga"></select><select id="gs"></select>
      <button class="btn claro" id="marcar" type="button">Marcar visibles</button><button class="btn claro" id="quitar" type="button">Quitar marcas</button><button class="btn" id="validar" type="button">${ico('ok')} Validar horas</button></div>
    <div id="lista"></div>
    <div class="card pie-guardar"><b id="tot"></b><button class="btn" id="guardar" type="button">${ico('save')} Guardar horas</button></div>`;
  const sel = new Map(); let D = [];
  const [ACT, secs] = await Promise.all([api('/api/actividades'), api('/api/admin/secciones')]);
  $('#act').innerHTML = opcionesActividad(ACT);
  llenarAnioSec(secs);
  $('#fecha').value = hoy(); $('#hdef').value = CFG.max_horas_semana > 0 ? CFG.max_horas_semana : 1;
  $('#regla').textContent = (CFG.max_horas_semana > 0 ? `Máximo ${CFG.max_horas_semana} h por estudiante a la semana ` : 'Sin límite semanal, ') + `hasta completar ${CFG.meta_horas} h.`;
  const cupo = a => Math.max(0, Math.round(Math.min(CFG.meta_horas - a.validadas - a.pendientes, a.limite > 0 ? a.limite - a.semana : Infinity) * 10) / 10);
  // "Horas por estudiante": solo puede bajar; el tope es el máximo semanal que define el administrador (0 = sin tope)
  const topeDef = CFG.max_horas_semana > 0 ? CFG.max_horas_semana : Infinity;
  if (topeDef !== Infinity) $('#hdef').max = topeDef;
  const hdef = () => Math.min(topeDef, Math.max(0.1, Math.round((+$('#hdef').value || 1) * 10) / 10));
  $('#hdef').onchange = () => {
    if (+$('#hdef').value > topeDef) toast(`El máximo por semana definido por el administrador es ${horasTxt(topeDef)}`);
    $('#hdef').value = hdef(); pintar();
  };
  const vis = () => { const q = $('#q').value.trim().toLowerCase(), g = $('#gs').value, an = $('#ga').value;
    return D.filter(a => (!g || String(a.seccion_id) === g) && (!an || String(a.anio) === an) && (a.nombre + ' ' + a.nie).toLowerCase().includes(q)).sort(porApellido); };
  const pintar = () => {
    $('#lista').innerHTML = vis().map(a => {
      const cp = cupo(a); if (cp === 0) sel.delete(a.id);
      const on = sel.has(a.id), v = Math.min(sel.get(a.id) ?? hdef(), cp), dis = cp === 0 ? ' disabled' : '';
      const aviso = a.validadas + a.pendientes >= CFG.meta_horas ? 'meta completada' : cp === 0 ? `límite de ${a.limite} h por semana` : '';
      return `<div class="item${on ? ' on' : ''}" data-id="${a.id}"><input type="checkbox" class="chk"${on ? ' checked' : ''}${dis}>
        <div class="info"><b>${esc(apellidosPrimero(a.nombre))}</b><small>${esc(a.nie)} · ${esc(grupoAnio(a))}${a.semana ? `<span class="tag">ya tiene ${horasTxt(a.semana)} esa semana</span>` : ''}${aviso ? `<span class="tag">${aviso}</span>` : ''}</small></div>
        ${barra(a.validadas)}<input type="number" class="hrs" min="0.1" max="${cp}" step="0.1" value="${v}"${dis}></div>`;
    }).join('') || '<p class="vacio">No hay estudiantes para mostrar.</p>';
    const n = sel.size, t = [...sel.values()].reduce((s, v) => s + v, 0);
    $('#tot').textContent = `${n} estudiante${n === 1 ? '' : 's'} · ${horasTxt(t)} en total`;
  };
  const cargar = async () => { D = await api('/api/docente/alumnos?fecha=' + $('#fecha').value); };
  $('#lista').onchange = e => {
    const it = e.target.closest('.item'); if (!it) return;
    const a = D.find(x => x.id === +it.dataset.id), cp = cupo(a);
    if (e.target.matches('.chk') && !e.target.checked) { sel.delete(a.id); return pintar(); }   // quitar la marca siempre se puede
    let h = Math.max(0.1, Math.round((+$('.hrs', it).value || 0) * 10) / 10);
    if (h > cp) { h = cp; toast(`Máximo ${horasTxt(cp)} para este estudiante en esa semana`); }
    if (e.target.matches('.hrs')) sel.set(a.id, h); else if (e.target.checked) sel.set(a.id, Math.min(hdef(), cp)); else sel.delete(a.id);
    pintar();
  };
  $('#marcar').onclick = () => { let n = 0; vis().forEach(a => { const cp = cupo(a); if (cp > 0) { sel.set(a.id, Math.min(sel.get(a.id) ?? hdef(), cp)); n++; } }); if (!n) toast('Ningún estudiante visible tiene horas disponibles esa semana'); pintar(); };
  $('#quitar').onclick = () => { if (!sel.size) toast('No hay estudiantes marcados'); sel.clear(); pintar(); };
  // Al finalizar la actividad: las horas pendientes de esa fecha pasan a validadas (para los estudiantes que se ven en la lista)
  $('#validar').onclick = async () => {
    // Si hay estudiantes marcados se validan solo ellos; si no hay ninguno marcado, todos los de la lista
    const f = $('#fecha').value, marcados = sel.size > 0, ids = marcados ? [...sel.keys()] : vis().map(a => a.id);
    if (!ids.length) return toast('No hay estudiantes en la lista');
    if (!confirmar(`¿Validar las horas pendientes del ${fmtF(f)} de ${marcados ? 'los ' + ids.length + ' estudiantes marcados' : 'los ' + ids.length + ' estudiantes de la lista'}?`)) return;
    try {
      const r = await api('/api/docente/horas/validar-fecha', { fecha: f, alumno_ids: ids });
      sel.clear(); await cargar(); pintar();
      toast((r.registros ? `Validadas ${horasTxt(r.horas)} de ${r.registros} registro${r.registros === 1 ? '' : 's'}` : 'No había horas pendientes en esa fecha') + (r.omitidos ? `. ${r.omitidos} no se validaron porque pasarían el máximo semanal` : ''));
    } catch (e) { toast(e.message); }
  };
  $('#q').oninput = $('#gs').onchange = pintar;
  $('#ga').onchange = () => { llenarAnioSec(secs); pintar(); };
  $('#act').onchange = () => { $('#wotra').style.display = $('#act').value === 'otra' ? '' : 'none'; };
  $('#fecha').onchange = async () => { if (!$('#fecha').value || $('#fecha').value > hoy()) { $('#fecha').value = hoy(); toast('No se puede elegir una fecha futura'); } await cargar(); pintar(); };
  $('#guardar').onclick = async () => {
    const registros = [...sel].map(([alumno_id, horas]) => ({ alumno_id, horas })).filter(r => r.horas > 0);
    if (!registros.length) return toast('Marca al menos un estudiante con horas mayores a 0');
    try {
      await api('/api/docente/horas', { fecha: $('#fecha').value, ...leerActividad($('#act'), $('#otra')), descripcion: $('#desc').value, estado: 'pendiente', registros });
      sel.clear(); await cargar(); pintar(); toast('Horas registradas como pendientes. Cuando terminen, usa «Validar horas»');
    } catch (e) { toast(e.message); }
  };
  await cargar(); pintar();
};

/* ================== Resumen: avance de cada estudiante, filtros y PDF ================== */
PAGINAS.resumen = async yo => {
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Resumen de horas</h1></div><div class="accion fila-btns"><button class="btn claro" id="pdfr">${ico('download')} Descargar resumen (PDF)</button><button class="btn claro" id="pdfb">${ico('download')} Descargar bitácora (PDF)</button></div></div>
    <p class="sub" id="sub"></p>
    <div class="card filtros"><div class="buscar grow">${ico('search')}<input id="q" placeholder="Nombre o NIE"></div><select id="ga"></select><select id="gs"></select>
      <select id="e"><option value="">Todos los estados</option><option>Completado</option><option>En curso</option><option>Sin horas</option></select>
      <select id="o"><option>Nombre</option><option>Menos horas primero</option><option>Más horas primero</option></select>
      <input type="number" id="mn" min="0" placeholder="Horas desde" style="width:130px"><input type="number" id="mx" min="0" placeholder="Horas hasta" style="width:130px"></div>
    <div class="card bloque"><div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th>Estudiante</th><th>Sección</th><th>Avance (validadas)</th><th>Pendientes</th><th>Faltan</th><th>Estado</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const [D, secs] = await Promise.all([api('/api/docente/alumnos'), api('/api/admin/secciones')]);
  llenarAnioSec(secs);
  const datos = () => {
    const q = $('#q').value.trim().toLowerCase(), g = $('#gs').value, an = $('#ga').value, e = $('#e').value, o = $('#o').value, mn = $('#mn').value, mx = $('#mx').value;
    const r = D.map(a => ({ ...a, carnet: a.nie, h: a.validadas }))
      .filter(a => (!g || String(a.seccion_id) === g) && (!an || String(a.anio) === an) && (a.nombre + ' ' + a.nie).toLowerCase().includes(q) && (!e || estadoHoras(a.h) === e) && (mn === '' || a.h >= +mn) && (mx === '' || a.h <= +mx));
    return r.sort(o === 'Menos horas primero' ? (a, b) => a.h - b.h : o === 'Más horas primero' ? (a, b) => b.h - a.h : porApellido);
  };
  const pintar = () => {
    $('#sub').textContent = `${D.length} estudiantes · ${D.filter(a => a.validadas >= CFG.meta_horas).length} completaron · ${horasTxt(D.reduce((s, a) => s + a.validadas, 0))} validadas · meta de ${CFG.meta_horas} h`;
    $('#tb').innerHTML = datos().map(a => `<tr class="clic" data-id="${a.id}"><td><b>${esc(apellidosPrimero(a.nombre))}</b><small>${esc(a.nie)}</small></td><td>${esc(grupoAnio(a))}</td><td>${barra(a.h)}</td>
      <td>${a.pendientes ? `<span class="pill p-pend">${horasTxt(a.pendientes)}</span>` : '-'}</td><td><b>${horasTxt(Math.max(0, CFG.meta_horas - a.h))}</b></td><td>${pillEstadoHoras(a.h)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="vacio">Sin resultados.</td></tr>';
  };
  $$('.filtros [id]').forEach(el => { el.oninput = pintar; });
  $('#ga').onchange = () => { llenarAnioSec(secs); pintar(); };
  $('#tb').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.href = 'estudiante.html?id=' + tr.dataset.id; };
  $('#pdfr').onclick = () => pdfResumen(datos());
  $('#pdfb').onclick = async () => { try { pdfBitacora(await api('/api/docente/bitacora')); } catch (e) { toast(e.message); } };
  pintar();
};

/* ---- PDF "Resumen de horas" con el diseño institucional (A4 horizontal) ---- */
// Las horas se suman con decimales (0.1 + 0.2...) y salían como 455.7000000001: se redondean a 1 decimal
const r1 = n => Math.round(Number(n) * 10) / 10;

function pdfResumen(rows){
  if(!window.jspdf)return toast('No se pudo cargar la librería de PDF');
  const doc=new jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const seccionDe=g=>(String(g).match(/(\d+)\s*$/)||[,g])[1],espDe=g=>String(g).replace(/\s*\d+\s*$/,'').trim();
  const NAVY=[16,40,79],VINO=[123,18,48],VINO2=[110,18,48],GRIS=[195,201,214],LINEA=[227,230,238],PISTA=[230,232,240],VERDE=[47,178,107];
  const fill=c=>doc.setFillColor(...c),ink=c=>doc.setTextColor(...c),draw=c=>doc.setDrawColor(...c);
  const poly=(p,c)=>{fill(c);doc.lines(p.slice(1).map((q,i)=>[q[0]-p[i][0],q[1]-p[i][1]]),p[0][0],p[0][1],[1,1],'F',true)};
  const [yy,mm,dd]=hoy().split('-'),fecha=`${dd}/${mm}/${yy}`;
  const marco=()=>{
    poly([[200,15.5],[216,15.5],[232,0],[216,0]],GRIS);poly([[217,15.5],[233,15.5],[250,0],[232,0]],VINO2);poly([[238,13],[250,0],[297,0],[297,13]],NAVY);
    doc.setFont('helvetica','bold');doc.setFontSize(38);ink(NAVY);doc.text('INFRAMEN',13,21);
    draw(VINO);doc.setLineWidth(.5);doc.line(97,10,97,21);
    draw(LINEA);doc.setLineWidth(.3);doc.line(0,28.5,297,28.5);doc.line(0,190.6,287.5,190.6);
    poly([[0,196],[37,196],[23,210],[0,210]],VINO2);poly([[37,196],[49.4,196],[35,210],[23,210]],NAVY);poly([[49.4,196],[64,196],[50,210],[35,210]],GRIS);
    doc.setFont('helvetica','normal');doc.setFontSize(9.5);ink(NAVY);doc.text('Reporte de seguimiento académico',287.5,196.5,{align:'right'})};
  const thead=y=>{fill(VINO);doc.roundedRect(10,y,277.5,11.4,1.5,1.5,'F');doc.setFont('helvetica','bold');doc.setFontSize(13);ink([255,255,255]);
    [['Alumno',14],['Carnet',114],['Sección',151.4],['Horas',179],['Faltan',215.5],['Estado',253.6]].forEach(([t,x])=>doc.text(t,x,y+7.6))};
  const icono=(k,cx,cy)=>{draw([255,255,255]);fill([255,255,255]);doc.setLineWidth(.9);
    if(k===0){doc.circle(cx,cy-3,2.8,'F');doc.ellipse(cx,cy+4.6,5.2,3.4,'F')}
    if(k===1){doc.circle(cx,cy,5.6,'S');doc.line(cx,cy,cx,cy-3.2);doc.line(cx,cy,cx+2.4,cy+1.6)}
    if(k===2){doc.circle(cx,cy,5.8,'S');doc.circle(cx,cy,3.3,'S');doc.circle(cx,cy,1.1,'F')}};

  /* Primera página: título y tarjetas */
  marco();fill(VINO);doc.rect(13.5,35,17,1.2,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(30);ink(NAVY);doc.text('Resumen de horas',13.5,53);
  const esp=[...new Set(rows.map(a=>espDe(a.grupo)))].filter(Boolean).join(', ');
  if(esp){const x2=13.5+doc.getTextWidth('Resumen de horas')+8;
    draw(VINO);doc.setLineWidth(.6);doc.line(x2-4,43,x2-4,54);
    ink(VINO);doc.setFontSize(esp.length>28?20:30);doc.text(esp,x2,53)}
  doc.setFont('helvetica','normal');doc.setFontSize(16);ink([60,75,110]);doc.text(`INFRAMEN  ·  ${fecha}`,13.5,61);
  const tot=r1(rows.reduce((s,a)=>s+a.h,0));
  [[10,VINO,rows.length,'alumnos registrados'],[103.6,NAVY,tot,'horas acumuladas'],[197,VINO,rows.length*CFG.meta_horas,'horas requeridas en total']].forEach(([x,c,n,t],k)=>{
    fill([238,243,250]);doc.roundedRect(x,65,90.5,27.5,1.5,1.5,'F');fill(c);doc.circle(x+14.3,78.7,9.2,'F');icono(k,x+14.3,78.7);
    draw(NAVY);doc.setLineWidth(.3);doc.line(x+28.2,70,x+28.2,88);
    doc.setFont('helvetica','bold');let fs=28;doc.setFontSize(fs);while(fs>14&&doc.getTextWidth(String(n))>x+90.5-(x+34.8)-4){fs--;doc.setFontSize(fs)}   // si el número es largo, se achica para caber en la tarjeta
    ink(NAVY);doc.text(String(n),x+34.8,79);
    doc.setFont('helvetica','normal');doc.setFontSize(12);doc.text(t,x+34.8,86)});

  /* Tabla */
  const RH=24,TOPE=188;let y=111.4,y0=y;thead(100);
  const cierra=()=>{draw(LINEA);doc.setLineWidth(.3);doc.rect(10,y0,277.5,Math.max(y-y0,12),'S')};
  if(!rows.length){doc.setFont('helvetica','normal');doc.setFontSize(12);ink([90,100,125]);doc.text('No hay alumnos para mostrar con los filtros actuales.',14,y+8);y+=12}
  rows.forEach(a=>{
    if(y+RH>TOPE){cierra();doc.addPage();marco();thead(38);y=49.4;y0=y}
    const done=a.h>=CFG.meta_horas,col=done?VERDE:a.h>0?VINO:[138,144,166],txt=estadoHoras(a.h);
    doc.setFont('helvetica','bold');doc.setFontSize(13);ink(NAVY);doc.text(doc.splitTextToSize(a.nombre,96)[0],14,y+8.5);
    doc.setFont('helvetica','normal');doc.setFontSize(12);
    doc.text(String(a.carnet),114,y+9);doc.text(String(seccionDe(a.grupo)),151.4,y+9);doc.text(`${r1(Math.max(0,CFG.meta_horas-a.h))} h`,215.5,y+9);
    fill(PISTA);doc.roundedRect(14,y+13.5,159,3,1.5,1.5,'F');
    if(a.h>0){fill(done?VERDE:VINO);doc.roundedRect(14,y+13.5,Math.max(3,159*Math.min(1,a.h/CFG.meta_horas)),3,1.5,1.5,'F')}
    doc.setFontSize(11);ink(NAVY);doc.text(`${r1(a.h)} / ${CFG.meta_horas}`,177.5,y+16.2);
    fill(col);doc.roundedRect(250,y+4,33,9,4.5,4.5,'F');
    draw([255,205,70]);doc.setLineWidth(.5);doc.circle(255.2,y+8.5,2,'S');doc.line(255.2,y+8.5,255.2,y+7.2);doc.line(255.2,y+8.5,256.2,y+9.1);
    doc.setFont('helvetica','bold');doc.setFontSize(11);ink([255,255,255]);doc.text(txt,260,y+9.6);
    y+=RH;draw(LINEA);doc.setLineWidth(.3);doc.line(10,y,287.5,y)});
  cierra();
  const n=doc.getNumberOfPages();for(let i=1;i<=n;i++){doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(9.5);ink(NAVY);doc.text(`Página ${i} de ${n}`,72,196.5)}
  doc.save('resumen-horas.pdf')}

/* ---- PDF "Bitácora de horas" con el diseño institucional (A4 horizontal) ---- */
function pdfBitacora(rows){
  if(!window.jspdf)return toast('No se pudo cargar la librería de PDF');
  const doc=new jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const NAVY=[16,40,79],VINO=[123,18,48],VINO2=[110,18,48],GRIS=[195,201,214],LINEA=[227,230,238],CLARO=[238,243,250],ZEBRA=[247,249,253],BLANCO=[255,255,255];
  const fill=c=>doc.setFillColor(...c),ink=c=>doc.setTextColor(...c),draw=c=>doc.setDrawColor(...c);
  const poly=(p,c)=>{fill(c);doc.lines(p.slice(1).map((q,i)=>[q[0]-p[i][0],q[1]-p[i][1]]),p[0][0],p[0][1],[1,1],'F',true)};
  const [yy,mm,dd]=hoy().split('-'),fecha=`${dd}/${mm}/${yy}`;
  const X0=10,W=277.5,E=[10,58,102,186,250,287.5],RH=14,TOPE=172;

  const ico=(k,cx,cy,c)=>{draw(c);fill(c);doc.setLineWidth(.45);
    if(k==='cal'){doc.roundedRect(cx-3.2,cy-3,6.4,6,.8,.8,'S');doc.rect(cx-3.2,cy-3,6.4,1.6,'F');for(let i=0;i<3;i++)for(let j=0;j<2;j++)doc.rect(cx-2.2+i*1.6,cy-.6+j*1.5,.9,.9,'F')}
    if(k==='id'){doc.roundedRect(cx-3.8,cy-2.6,7.6,5.2,.7,.7,'S');doc.circle(cx-1.7,cy-.6,.8,'F');doc.line(cx+.2,cy-1,cx+2.8,cy-1);doc.line(cx+.2,cy+.6,cx+2.8,cy+.6);doc.line(cx-2.8,cy+1.6,cx-.6,cy+1.6)}
    if(k==='user'){doc.circle(cx,cy-1.5,1.7,'F');doc.ellipse(cx,cy+2.6,3,1.9,'F')}
    if(k==='group'){doc.circle(cx,cy-1.6,1.5,'F');doc.ellipse(cx,cy+2.3,2.6,1.6,'F');doc.circle(cx-3.4,cy-.8,1.1,'F');doc.circle(cx+3.4,cy-.8,1.1,'F')}
    if(k==='clock'){doc.circle(cx,cy,3.6,'S');doc.line(cx,cy,cx,cy-2.2);doc.line(cx,cy,cx+1.6,cy+1.1)}
    if(k==='doc'){doc.roundedRect(cx-3,cy-4,6,8,.8,.8,'S');doc.line(cx-1.6,cy-1.6,cx+1.6,cy-1.6);doc.line(cx-1.6,cy,cx+1.6,cy);doc.line(cx-1.6,cy+1.6,cx+.6,cy+1.6)}
    if(k==='clip'){doc.roundedRect(cx-3.6,cy-3.8,7.2,8.4,.8,.8,'S');doc.rect(cx-1.5,cy-4.9,3,1.8,'F');doc.line(cx-2,cy-.8,cx+2,cy-.8);doc.line(cx-2,cy+.8,cx+2,cy+.8);doc.line(cx-2,cy+2.4,cx+.6,cy+2.4)}};

  const marco=()=>{
    /* logo */
    poly([[12,13.5],[24,8],[36,13.5],[24,19]],NAVY);
    poly([[17,17.5],[24,20.7],[31,17.5],[31,23.8],[24,27],[17,23.8]],[37,84,150]);
    draw(VINO);doc.setLineWidth(.8);doc.line(13.2,14.2,13.2,23.5);fill(VINO);doc.circle(13.2,24.6,1.1,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(34);ink(NAVY);doc.text('INFRAMEN',40,19);const wl=doc.getTextWidth('INFRAMEN');
    const sub=String(CFG.institucion).toUpperCase();doc.setFont('helvetica','normal');doc.setFontSize(7);const ws=doc.getTextWidth(sub);
    doc.setFontSize(7*wl/ws);ink([60,75,110]);doc.text(sub,40,25);
    draw(VINO);doc.setLineWidth(.6);doc.line(40+wl+7,8,40+wl+7,19);
    /* banda superior derecha */
    poly([[173,26],[184,26],[207,0],[196,0]],GRIS);poly([[187,26],[196,26],[220,0],[209,0]],VINO2);poly([[199,26],[297,26],[297,0],[223,0]],NAVY);
    doc.setFont('helvetica','normal');doc.setFontSize(11.5);ink(BLANCO);doc.text('Formación que construye',288,11,{align:'right'});doc.text('el futuro',288,17.5,{align:'right'});
    draw([214,120,140]);doc.setLineWidth(.6);doc.line(268,21,288,21);
    /* banda inferior */
    fill(CLARO);doc.roundedRect(X0,176,W,28,2,2,'F');
    poly([[190,202],[202,202],[223,176],[211,176]],GRIS);poly([[206,202],[215,202],[236,176],[227,176]],VINO2);poly([[220,202],[297,202],[297,176],[241,176]],NAVY);
    doc.setFont('helvetica','bold');doc.setFontSize(13);ink(BLANCO);doc.text('—  INFRAMEN',289,188,{align:'right'});
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text('Disciplina  ·  Compromiso  ·  Éxito',289,195.5,{align:'right'});
    fill([215,226,243]);doc.circle(26,190,10,'F');ico('clip',26,190,NAVY);
    draw(NAVY);doc.setLineWidth(.3);doc.line(40,181,40,199);
    doc.setFont('helvetica','bold');doc.setFontSize(14);ink(NAVY);doc.text('Total de registros',46,186);
    doc.setFontSize(30);ink(VINO);doc.text(String(rows.length),46,199);const wn=doc.getTextWidth(String(rows.length));
    doc.setFont('helvetica','normal');doc.setFontSize(12);ink([90,100,125]);doc.text('movimientos',46+wn+3,198)};

  const thead=y=>{fill(VINO);doc.roundedRect(X0,y,W,13,2,2,'F');
    [['cal','Fecha'],['id','Carnet'],['user','Alumno'],['user','Grupo'],['clock','Horas']].forEach(([k,t],i)=>{
      ico(k,E[i]+7.5,y+6.5,BLANCO);doc.setFont('helvetica','bold');doc.setFontSize(13);ink(BLANCO);doc.text(t,E[i]+14,y+8.4)})};

  /* Primera página: tarjeta de título */
  marco();
  fill(CLARO);doc.roundedRect(X0,33,W,31,2.5,2.5,'F');
  poly([[205,64],[214,64],[236,33],[227,33]],VINO2);
  fill(VINO);doc.circle(28,48.5,9.5,'F');ico('clock',28,48.5,BLANCO);doc.setLineWidth(.9);
  draw(NAVY);doc.setLineWidth(.3);doc.line(41,39,41,58);
  doc.setFont('helvetica','bold');doc.setFontSize(26);ink(NAVY);doc.text('Bitácora de horas',46,48);
  doc.setFont('helvetica','normal');doc.setFontSize(14);ink([60,75,110]);doc.text(`INFRAMEN  ·  ${fecha}`,46,58);
  fill([225,233,246]);doc.circle(247,48.5,8,'F');ico('doc',247,48.5,NAVY);
  draw(NAVY);doc.setLineWidth(.3);doc.line(257,41,257,56);
  doc.setFont('helvetica','normal');doc.setFontSize(7.5);ink(NAVY);['Cada hora cuenta','para tu desarrollo','profesional.'].forEach((t,i)=>doc.text(t,260,44.5+i*4.6));

  /* Tabla */
  let y=84,y0=y;thead(71);
  const cierra=()=>{draw(LINEA);doc.setLineWidth(.3);doc.rect(X0,y0,W,Math.max(y-y0,12),'S');for(let i=1;i<E.length-1;i++)doc.line(E[i],y0,E[i],Math.max(y,y0+12))};
  if(!rows.length){doc.setFont('helvetica','normal');doc.setFontSize(12);ink([90,100,125]);doc.text('Aún no hay horas registradas.',X0+6,y+8);y+=12}
  rows.forEach((b,n)=>{
    if(y+RH>TOPE){cierra();doc.addPage();marco();thead(34);y=47;y0=y}
    fill(n%2?CLARO:ZEBRA);doc.rect(X0+.2,y,W-.4,RH,'F');
    const cy=y+RH/2;
    ico('cal',E[0]+7.5,cy,NAVY);ico('id',E[1]+7.5,cy,NAVY);ico('user',E[2]+7.5,cy,NAVY);
    doc.setFont('helvetica','normal');doc.setFontSize(11.5);ink(NAVY);
    doc.text(String(b.fecha),E[0]+14,cy+1.5);doc.text(String(b.carnet),E[1]+14,cy+1.5);
    const cabe=(t,w)=>{let f=11.5;doc.setFontSize(f);while(f>7&&doc.getTextWidth(t)>w){f-=.5;doc.setFontSize(f)}return t};
    doc.text(cabe(b.nombre||'',E[3]-E[2]-18),E[2]+14,cy+1.5);doc.setFontSize(11.5);
    doc.text(cabe(String(b.grupo),E[4]-E[3]-18),E[3]+14,cy+1.5);doc.setFontSize(11.5);doc.text(String(r1(b.horas)),E[4]+14,cy+1.5);
    y+=RH});
  cierra();
  const np=doc.getNumberOfPages();for(let i=1;i<=np;i++){doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(8);ink([90,100,125]);doc.text(`Página ${i} de ${np}`,X0,208.5)}
  doc.save('bitacora-horas.pdf')}



/* ================== Avisos y eventos: lo que verán los estudiantes (docente y administrador) ================== */
PAGINAS.publicaciones = async yo => {
  const admin = yo.rol === 'administrador';
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Avisos y eventos</h1><p>Lo que publiques aparece en los apartados Avisos y Calendario de los estudiantes${admin ? '' : ' de tus secciones'}.</p></div></div>
    <div class="tabs"><button class="tab on" data-t="a">Avisos</button><button class="tab" data-t="e">Calendario</button></div>
    <div class="dos-col"><div class="card bloque"><h2 id="tl"></h2><div id="lista"></div></div><div class="card bloque detalle" id="form"></div></div>`;
  const secs = (await api('/api/admin/secciones')).filter(s => s.activa);
  const destino = `<div><label>Dirigido a</label><select id="pd" required>${admin ? '<option value="">Todos los estudiantes</option>' : '<option value="" disabled selected>Elige una sección…</option>'}
    ${secs.map(s => `<option value="${s.id}">${esc(s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')')}</option>`).join('')}</select></div>`;
  let tab = 'a';
  const FORM = {
    a: `<h2>Nuevo aviso</h2><form class="form-modal" id="fp"><div><label>Título</label><input id="pt" maxlength="120" required></div>
      <div><label>Contenido</label><textarea id="pc" maxlength="2000" required style="min-height:110px"></textarea></div>
      <div><label>Fecha de la actividad (opcional)</label><input type="date" id="pf" min="${hoy()}"></div>${destino}<button class="btn">${ico('save')} Publicar aviso</button></form>`,
    e: `<h2>Nueva actividad</h2><form class="form-modal" id="fp"><div><label>Nombre de la actividad</label><input id="pt" maxlength="120" required></div>
      <div><label>Fecha</label><input type="date" id="pf" required min="${hoy()}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label>Hora de inicio</label><input type="time" id="hi"></div><div><label>Hora de fin</label><input type="time" id="hf"></div></div>
      <div><label>Lugar</label><input id="pl" maxlength="150"></div><div><label>Descripción (opcional)</label><textarea id="pc" maxlength="500"></textarea></div>
      ${destino}<button class="btn">${ico('save')} Publicar actividad</button></form>`,
  };
  const pintar = async () => {
    $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    $('#tl').textContent = tab === 'a' ? 'Avisos publicados' : 'Actividades del calendario';
    $('#form').innerHTML = FORM[tab]; poner($('#form'));
    const L = await api(tab === 'a' ? '/api/staff/avisos' : '/api/staff/eventos');
    $('#lista').innerHTML = L.length ? L.map(x => `<div class="item"><div class="info"><b>${esc(x.titulo)}</b>
        <small>${tab === 'a' ? 'Publicado el ' + fmtF(x.publicado) + (x.fecha_actividad ? ' · actividad: ' + fmtF(x.fecha_actividad) : '') : fmtF(x.fecha) + ' · ' + (x.hora_inicio ? x.hora_inicio + (x.hora_fin ? ' – ' + x.hora_fin : '') : 'sin horario') + (x.lugar ? ' · ' + esc(x.lugar) : '')} · ${esc(x.destino)}</small></div>
        ${admin || x.mio ? `<div class="acc"><button data-del="${x.id}" title="Eliminar">${ico('trash')}</button></div>` : ''}</div>`).join('')
      : `<p class="vacio">Aún no hay ${tab === 'a' ? 'avisos' : 'actividades'} publicados.</p>`;
    poner($('#lista'));
    $('#fp').onsubmit = async e => {
      e.preventDefault();
      const b = { titulo: $('#pt').value, seccion_id: $('#pd').value || null };
      if (tab === 'a') Object.assign(b, { contenido: $('#pc').value, fecha_actividad: $('#pf').value });
      else Object.assign(b, { fecha: $('#pf').value, hora_inicio: $('#hi').value, hora_fin: $('#hf').value, lugar: $('#pl').value, descripcion: $('#pc').value });
      try { await api(tab === 'a' ? '/api/staff/avisos' : '/api/staff/eventos', b); toast('Publicado: ya lo ven los estudiantes'); await pintar(); }
      catch (err) { toast(err.message); }
    };
  };
  $$('.tab').forEach(b => { b.onclick = () => { tab = b.dataset.t; pintar().catch(e => toast(e.message)); }; });
  $('#lista').onclick = async e => {
    const b = e.target.closest('[data-del]'); if (!b || !confirmar('¿Eliminar esta publicación? Los estudiantes dejarán de verla.')) return;
    try { await api(`/api/staff/${tab === 'a' ? 'avisos' : 'eventos'}/${b.dataset.del}`, undefined, 'DELETE'); toast('Publicación eliminada'); await pintar(); }
    catch (err) { toast(err.message); }
  };
  await pintar();
};
