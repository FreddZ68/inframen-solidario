/* INFRAMEN - módulo del estudiante: Inicio, Mis jornadas, Calendario, Avisos (Mi perfil está en common.js).
   Solo lectura: el estudiante consulta sus datos reales; el servidor filtra todo por el usuario de la sesión. */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const cuando = e => e.hora_inicio ? e.hora_inicio + (e.hora_fin ? ' – ' + e.hora_fin : '') : 'Horario por confirmar';
const fmtLarga = f => new Date(f + 'T00:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' });
const tituloPag = (t, p) => `<div class="titulo"><div><h1>${t}</h1><p>${p}</p></div></div>`;

/* ================== Inicio ================== */
PAGINAS.inicioAlumno = async yo => {
  $('#contenido').innerHTML = tituloPag('Inicio', `Bienvenido(a), ${esc(yo.nombre.split(' ')[0])}. Aquí ves tus horas validadas por tus docentes.`) + `
    <div class="card panel-alumno" id="hero"></div>
    <div class="card constancia" id="const"></div>
    <div class="dos-igual">
      <div class="card bloque"><h2>Jornadas recientes <a class="enlace" href="jornadas.html">Ver todas ›</a></h2><div id="recientes"></div></div>
      <div class="card bloque"><h2>Avisos importantes <a class="enlace" href="avisos.html">Ver todos ›</a></h2><div id="avisos"></div></div>
    </div>`;
  const [R, A] = await Promise.all([api('/api/alumno/resumen'), api('/api/alumno/avisos?por=3')]);
  const pct = Math.min(100, R.validadas / R.meta * 100);
  $('#hero').innerHTML = `${anillo(pct, true)}
    <div class="datos"><div><h2 style="margin:0;color:var(--azul);font-size:20px">${esc(R.alumno.nombre)}</h2>
      <small style="color:var(--gris)">${esc(R.alumno.especialidad || 'Sin especialidad')} · Sección ${esc(R.alumno.seccion.replace(R.alumno.especialidad, '').trim() || '-')} · NIE ${esc(R.alumno.nie)}</small></div>
      <div style="font-size:16px;color:var(--azul)"><b>${horasTxt(R.validadas)}</b> validadas de <b>${R.meta} h</b> requeridas</div>
      <div class="prog${R.validadas >= R.meta ? ' ok' : ''}" style="max-width:460px"><div class="pista"><i style="width:${pct}%"></i></div><small>${Math.round(pct)}%</small></div>
      <div class="kpis">${stat('award', 'Horas requeridas', horasTxt(R.meta))}${stat('check', 'Completadas y validadas', horasTxt(R.validadas))}
        ${stat('rotate', 'Pendientes de validación', horasTxt(R.pendientes))}${stat('clock', 'Horas restantes', horasTxt(R.restantes))}</div>
      ${R.rechazadas ? `<div class="nota" style="margin:0">${ico('bell')}<span>Tienes ${horasTxt(R.rechazadas)} rechazadas, que no se suman a tu avance. Revisa el motivo en <a href="jornadas.html?estado=rechazado" style="color:var(--vino)">Mis jornadas</a>.</span></div>` : ''}
      <small style="color:var(--gris)">Las horas pendientes o rechazadas no se suman: solo cuentan las validadas por un docente.${R.limite_semanal > 0 ? ` Tu límite de registro es de ${horasTxt(R.limite_semanal)} por semana.` : ''}</small></div>`;

  // Constancia: botón deshabilitado hasta cumplir los requisitos (el servidor lo vuelve a comprobar al pedirla)
  $('#const').className = 'card constancia' + (R.cumplida ? ' lista' : '');
  $('#const').innerHTML = `<div class="caja">${ico(R.cumplida ? 'award' : 'lock')}</div>
    <div class="txt"><b>${R.cumplida ? '¡Felicidades, completaste tus horas sociales!' : 'Constancia de horas sociales'}</b>
    <small>${R.cumplida ? 'Ya puedes descargar tu constancia en PDF.' : `Se habilita al completar ${R.meta} horas validadas. Te faltan ${horasTxt(R.restantes)}.`}</small></div>
    <button class="btn grande" id="bconst" ${R.cumplida ? '' : 'disabled title="Disponible al completar la meta"'}>${ico('download')} Descargar constancia</button>`;
  $('#bconst').onclick = async () => {
    try { generarConstancia(await api('/api/alumno/constancia')); } catch (e) { toast(e.message); }
  };

  $('#recientes').innerHTML = R.recientes.length
    ? `<div class="lista-j">${R.recientes.map(r => `<div class="j-item"><div><b>${esc(r.actividad)}</b><small>${fmtF(r.fecha)} · ${horasTxt(r.horas)}</small></div>${pillRegistro(r.estado, true)}</div>`).join('')}</div>`
    : '<p class="vacio">Todavía no tienes jornadas registradas. Tu docente las irá cargando.</p>';
  $('#avisos').innerHTML = A.avisos.length ? A.avisos.map(tarjetaAviso).join('') : '<p class="vacio">No hay avisos publicados por ahora.</p>';
};

/* ================== Mis jornadas (solo consulta) ================== */
PAGINAS.jornadas = async yo => {
  const q = new URLSearchParams(location.search), inicial = ['pendiente', 'validado', 'rechazado'].includes(q.get('estado')) ? q.get('estado') : '';
  $('#contenido').innerHTML = tituloPag('Mis jornadas', 'Historial de tus jornadas de servicio social. Solo puedes consultarlo; las registra y valida tu docente.') + `
    <div class="card filtros"><div><label for="fd">Desde</label><input type="date" id="fd"></div><div><label for="fh">Hasta</label><input type="date" id="fh"></div>
      <div><label for="fe">Estado</label><select id="fe"><option value="">Todos</option><option value="pendiente">Pendiente de validación</option><option value="validado">Validada</option><option value="rechazado">Rechazada</option></select></div>
      <button class="btn claro" id="limpiar" type="button" style="align-self:flex-end">Limpiar filtros</button></div>
    <div class="card bloque"><div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th>Fecha</th><th>Actividad</th><th>Horas</th><th>Estado</th><th>Observación del docente</th></tr></thead><tbody id="tb"></tbody></table></div>
    <div class="pie-tabla"><span id="info"></span><div class="pag" id="pag"></div></div></div>`;
  $('#fe').value = inicial;
  let pag = 1;
  const cargar = async () => {
    const f = new URLSearchParams({ pagina: pag });
    if ($('#fd').value) f.set('desde', $('#fd').value);
    if ($('#fh').value) f.set('hasta', $('#fh').value);
    if ($('#fe').value) f.set('estado', $('#fe').value);
    const R = await api('/api/alumno/jornadas?' + f);
    $('#tb').innerHTML = R.registros.map(r => `<tr><td>${fmtF(r.fecha)}</td><td>${esc(r.actividad)}${r.descripcion ? `<small>${esc(r.descripcion)}</small>` : ''}</td>
      <td><b>${horasTxt(r.horas)}</b></td><td>${pillRegistro(r.estado, true)}${r.revisado_en ? `<small>Revisada el ${fmtF(r.revisado_en)}</small>` : ''}</td>
      <td>${r.observacion ? `<span class="obs-doc">${esc(r.observacion)}</span>${r.revisado_por ? `<small>${esc(r.revisado_por)}</small>` : ''}` : '<span style="color:var(--gris)">—</span>'}</td></tr>`).join('')
      || `<tr><td colspan="5" class="vacio">${$('#fd').value || $('#fh').value || $('#fe').value ? 'No hay jornadas con esos filtros.' : 'Todavía no tienes jornadas registradas. Tu docente las irá cargando.'}</td></tr>`;
    paginador($('#pag'), $('#info'), R.total, R.pagina, R.por, p => { pag = p; cargar().catch(e => toast(e.message)); });
    $('#info').textContent += ` · ${horasTxt(R.horas)} en total`;
  };
  const filtrar = () => { pag = 1; cargar().catch(e => toast(e.message)); };
  ['#fd', '#fh', '#fe'].forEach(s => { $(s).onchange = filtrar; });
  $('#limpiar').onclick = () => { $('#fd').value = $('#fh').value = $('#fe').value = ''; filtrar(); };
  await cargar();
};

/* ================== Calendario (solo consulta) ================== */
const tarjetaEvento = (e, pasado) => {
  const [, m, d] = e.fecha.split('-');
  return `<article class="evento${pasado ? ' pasado' : ''}"><div class="fecha-caja"><b>${+d}</b><small>${MESES[+m - 1]}</small></div>
    <div class="ev-cuerpo"><h3>${esc(e.titulo)}${e.general ? '' : ' <span class="tag">Tu sección</span>'}</h3>
      <div class="ev-datos"><span>${ico('calendar')} ${fmtLarga(e.fecha)}</span><span>${ico('clock')} ${cuando(e)}</span>${e.lugar ? `<span>${ico('folder')} ${esc(e.lugar)}</span>` : ''}</div>
      ${e.descripcion ? `<p>${esc(e.descripcion)}</p>` : ''}</div></article>`;
};
PAGINAS.calendario = async yo => {
  $('#contenido').innerHTML = tituloPag('Calendario', 'Actividades de servicio social publicadas por tus docentes y la administración.') + `
    <div class="tabs"><button class="tab on" data-t="p">Próximas <span id="np">0</span></button><button class="tab" data-t="x">Pasadas <span id="nx">0</span></button></div><div id="lista"></div>`;
  const C = await api('/api/alumno/calendario');
  $('#np').textContent = C.proximos.length; $('#nx').textContent = C.pasados.length;
  const ver = t => {
    $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    const l = t === 'p' ? C.proximos : C.pasados;
    $('#lista').innerHTML = l.length ? `<div class="eventos">${l.map(e => tarjetaEvento(e, t === 'x')).join('')}</div>`
      : `<div class="card"><p class="vacio">${t === 'p' ? 'No hay actividades próximas programadas por ahora.' : 'Aún no hay actividades pasadas.'}</p></div>`;
    poner($('#lista'));
  };
  $$('.tab').forEach(b => { b.onclick = () => ver(b.dataset.t); });
  ver('p');
};

/* ================== Avisos (solo consulta) ================== */
const tarjetaAviso = a => `<article class="aviso"><header><h3>${esc(a.titulo)}</h3><small>${fmtF(a.publicado)}${a.autor ? ' · ' + esc(a.autor) : ''}</small></header>
  ${a.fecha_actividad ? `<span class="tag">${ico('calendar')} Actividad: ${fmtLarga(a.fecha_actividad)}</span>` : ''}${a.general ? '' : '<span class="tag">Tu sección</span>'}
  <p>${esc(a.contenido)}</p></article>`;
PAGINAS.avisos = async yo => {
  $('#contenido').innerHTML = tituloPag('Avisos', 'Comunicados oficiales dirigidos a ti o a toda la institución.') + '<div id="lista"></div><div class="pie-tabla"><span id="info"></span><div class="pag" id="pag"></div></div>';
  let pag = 1;
  const cargar = async () => {
    const R = await api('/api/alumno/avisos?pagina=' + pag);
    $('#lista').innerHTML = R.avisos.length ? R.avisos.map(tarjetaAviso).join('') : '<div class="card"><p class="vacio">No hay avisos publicados por ahora.</p></div>';
    poner($('#lista'));
    paginador($('#pag'), $('#info'), R.total, R.pagina, R.por, p => { pag = p; cargar().catch(e => toast(e.message)); window.scrollTo(0, 0); });
  };
  await cargar();
};

/* ---- Constancia oficial en PDF (A4 vertical), con el historial de horas validadas ---- */
function generarConstancia(C) {
  if (!window.jspdf) return toast('No se pudo cargar la librería de PDF');
  const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const NAVY = [16, 40, 79], VINO = [123, 18, 48], GRIS = [90, 100, 125], W = 210, M = 20;
  const ink = c => doc.setTextColor(...c);
  const fecha = new Date(C.emitida + 'T00:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' });
  const a = C.alumno;

  // Marco y encabezado
  doc.setDrawColor(...VINO); doc.setLineWidth(1.2); doc.rect(8, 8, W - 16, 281);
  doc.setLineWidth(.3); doc.rect(10.5, 10.5, W - 21, 276);
  doc.setFillColor(...VINO); doc.rect(8, 8, W - 16, 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); ink(NAVY); doc.text('INFRAMEN', W / 2, 32, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); ink(GRIS); doc.text(String(C.institucion).toUpperCase(), W / 2, 39, { align: 'center' });
  doc.setDrawColor(...VINO); doc.setLineWidth(.6); doc.line(W / 2 - 22, 44, W / 2 + 22, 44);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); ink(VINO); doc.text('CONSTANCIA DE HORAS', W / 2, 58, { align: 'center' });
  doc.setFontSize(10); ink(GRIS); doc.setFont('helvetica', 'normal'); doc.text('Folio ' + C.folio, W / 2, 64, { align: 'center' });

  // Texto principal
  doc.setFontSize(12); ink(NAVY);
  doc.text('La dirección de ' + C.institucion + ' hace constar que:', M, 80);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(a.nombre, W / 2, 92, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); ink(GRIS);
  doc.text(`NIE ${a.nie}  ·  Sección ${a.seccion}`, W / 2, 99, { align: 'center' });
  ink(NAVY); doc.setFontSize(12);
  const t = `ha completado satisfactoriamente un total de ${C.horas} horas validadas, cumpliendo la meta institucional de ${C.meta} horas, según el registro de actividades que se detalla a continuación.`;
  doc.text(doc.splitTextToSize(t, W - 2 * M), M, 112, { align: 'left', lineHeightFactor: 1.5 });

  // Detalle de actividades validadas
  doc.autoTable({
    startY: 132, margin: { left: M, right: M },
    head: [['Fecha', 'Actividad', 'Horas']],
    body: C.registros.map(r => [fmtF(r.fecha), r.actividad + (r.descripcion ? ' - ' + r.descripcion : ''), String(r.horas)]),
    foot: [['', 'Total de horas validadas', String(C.horas)]],
    headStyles: { fillColor: VINO, textColor: 255 }, footStyles: { fillColor: [238, 243, 250], textColor: NAVY, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 2.2, textColor: NAVY }, columnStyles: { 0: { cellWidth: 26 }, 2: { cellWidth: 20, halign: 'right' } },
    showFoot: 'lastPage',
  });

  // Firmas y fecha (si no caben en la página, pasan a una nueva)
  let y = doc.lastAutoTable.finalY + 26;
  if (y > 262) { doc.addPage(); doc.setDrawColor(...VINO); doc.setLineWidth(1.2); doc.rect(8, 8, W - 16, 281); y = 60; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); ink(NAVY);
  doc.text(`Se extiende la presente constancia el ${fecha}.`, M, y - 12);
  doc.setDrawColor(...NAVY); doc.setLineWidth(.3);
  doc.line(M + 4, y + 10, M + 64, y + 10); doc.line(W - M - 64, y + 10, W - M - 4, y + 10);
  doc.setFontSize(10); ink(GRIS);
  doc.text('Docente responsable', M + 34, y + 16, { align: 'center' }); doc.text('Dirección', W - M - 34, y + 16, { align: 'center' });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); ink(GRIS); doc.text(`Página ${i} de ${n}`, W / 2, 285, { align: 'center' }); }
  doc.save('constancia-' + a.nie + '.pdf');
}
