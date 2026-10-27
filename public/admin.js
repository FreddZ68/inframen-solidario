/* INFRAMEN - páginas del administrador (y las que comparte con el docente: asistencia y reportes). */

/* ================== Inicio del administrador: tablero de control ================== */
PAGINAS.inicioAdmin = async yo => {
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Panel de control</h1><p id="hola">Bienvenido(a), ${esc(yo.nombre.split(' ')[0])}</p></div></div>
    <div class="kpis" id="kpis"></div>
    <div class="card bloque" style="margin-bottom:18px"><h2>Avance de horas por sección <small style="color:var(--gris);font-weight:400" id="metaTxt"></small></h2><div id="avance"></div></div>
    <div class="card bloque"><h2>Accesos rápidos</h2><div class="accesos" id="accesos"></div></div>`;
  const r = await api('/api/admin/reportes');
  const rend = r.rendimiento;
  $('#kpis').innerHTML = stat('users', 'Total de estudiantes', r.estudiantes) + stat('check', 'Asistencia del mes', r.asistencia.promedio + '%')
    + stat('chart', 'Rendimiento global', rend.pct + '%') + stat('award', 'Completaron la meta', `${rend.completaron} de ${r.estudiantes}`);
  $('#metaTxt').textContent = `· meta: ${r.meta} h por estudiante · ${rend.pendientes} h pendientes de validar`;
  $('#avance').innerHTML = filasAvance(r.avance);
  const A = [
    ['usuarios', 'users', 'Gestión de Usuarios', 'Docentes, estudiantes y contraseñas iniciales'],
    ['secciones', 'layers', 'Gestión de Secciones', 'Especialidades, docentes y estudiantes'],
    ['asignar', 'users', 'Asignar estudiantes', 'Da de alta estudiantes con un CSV y asígnalos a su sección'],
    ['proyectos', 'folder', 'Proyectos y Actividades', 'Proyectos, actividades y sus documentos'],
    ['institucion', 'settings', 'Gestión de la Institución', 'Meta de horas, máximo semanal y nombre'],
    ['asistencia', 'calendar', 'Registro de Asistencia', 'Marca la asistencia por sección y fecha'],
    ['resumen', 'clock', 'Resumen de horas', 'Avance de cada estudiante hacia la meta'],
    ['reportes', 'chart', 'Reportes y Estadísticas', 'Rendimiento y asistencia con exportación'],
  ];
  $('#accesos').innerHTML = A.map(([f, i, t, s]) => `<a class="acceso" href="${f}.html"><span class="i">${ico(i)}</span><div><b>${t}</b><small>${s}</small></div><em>›</em></a>`).join('');
};

/* ================== Gestión de Usuarios ================== */
PAGINAS.usuarios = async yo => {
  let D = [], S = [], pag = 1; const POR = 8;
  // Un apartado por rol: Estudiantes, Docentes y Administradores
  const TABS = {
    alumno: { texto: 'Estudiantes', uno: 'estudiante', cod: 'NIE', sec: 'Sección' },
    docente: { texto: 'Docentes', uno: 'docente', cod: 'Código', sec: 'Secciones asignadas' },
    administrador: { texto: 'Administradores', uno: 'administrador', cod: 'Código', sec: null },
  };
  let rol = (location.hash || '').slice(1); if (!TABS[rol]) rol = 'alumno';
  const cargar = async () => { [D, S] = await Promise.all([api('/api/admin/usuarios'), api('/api/admin/secciones')]); };
  // Filtros de especialidad y sección (estudiantes y docentes). La sección de cada usuario viene como "Especialidad N"
  // (los docentes pueden tener varias, separadas por coma).
  const idsDe = u => String(u.seccion_ids || '').split(',').filter(Boolean).map(Number);   // ids de las secciones del usuario
  const secPorId = id => S.find(s => s.id === id);
  const llenarFiltros = () => {
    const esp0 = $('#fesp').value, anio0 = $('#fanio').value, sec0 = $('#fsec').value;
    const esps = [...new Set(S.map(s => s.especialidad))].sort((x, y) => x.localeCompare(y, 'es'));
    $('#fesp').innerHTML = '<option value="">Todas las especialidades</option>' + esps.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
    $('#fesp').value = esps.includes(esp0) ? esp0 : '';
    const esp = $('#fesp').value;
    const anios = [...new Set(S.filter(s => !esp || s.especialidad === esp).map(s => String(s.anio)))].sort((x, y) => y - x);
    $('#fanio').innerHTML = '<option value="">Todos los años</option>' + anios.map(y => `<option value="${y}">Año ${y}</option>`).join('');
    $('#fanio').value = anios.includes(anio0) ? anio0 : '';
    const anio = $('#fanio').value;
    const lista = S.filter(s => (!esp || s.especialidad === esp) && (!anio || String(s.anio) === anio))
      .sort((x, y) => y.anio - x.anio || (x.especialidad + x.seccion).localeCompare(y.especialidad + y.seccion, 'es', { numeric: true }));
    $('#fsec').innerHTML = '<option value="">Todas las secciones</option>' + lista.map(s => `<option value="${s.id}">${esp ? 'Sección ' + s.seccion : esc(s.especialidad + ' ' + s.seccion)} (${s.anio})</option>`).join('');
    $('#fsec').value = lista.some(s => String(s.id) === sec0) ? sec0 : '';
  };
  const vis = () => {
    const q = $('#q').value.trim().toLowerCase(), e = $('#fest').value, esp = $('#fesp').value, anio = $('#fanio').value, sec = $('#fsec').value;
    const usaSec = !!TABS[rol].sec;
    return D.filter(u => u.rol === rol && (!e || String(u.activo ? 1 : 0) === e)
      && (!usaSec || idsDe(u).some(id => { const s = secPorId(id); return s && (!esp || s.especialidad === esp) && (!anio || String(s.anio) === anio) && (!sec || String(id) === sec); })
        || (usaSec && !esp && !anio && !sec))
      && `${u.nombre} ${u.correo} ${u.nie} ${u.id}`.toLowerCase().includes(q));
  };
  const pintar = () => {
    const T = TABS[rol], n = r => D.filter(u => u.rol === r).length;
    llenarFiltros();
    $('#fesp').style.display = $('#fanio').style.display = $('#fsec').style.display = T.sec ? '' : 'none';   // los administradores no tienen sección
    $('#tabs').innerHTML = Object.entries(TABS).map(([r, t]) => `<button class="tab${r === rol ? ' on' : ''}" data-rol="${r}">${t.texto} <span>${n(r)}</span></button>`).join('');
    $('#ttabla').textContent = 'Lista de ' + T.texto.toLowerCase();
    $('#nuevo').innerHTML = ico('plus') + ' Nuevo ' + T.uno;
    $('#th').innerHTML = `<tr><th>${T.cod}</th><th>Nombre</th><th>Correo electrónico</th>${T.sec ? `<th>${T.sec}</th>` : ''}<th>Estado</th><th>Acciones</th></tr>`;
    const v = vis(), tot = v.length, ult = Math.max(1, Math.ceil(tot / POR)); if (pag > ult) pag = ult;
    $('#tb').innerHTML = v.slice((pag - 1) * POR, pag * POR).map(u => `<tr>
      <td>${esc(u.nie || pad(u.id))}</td><td>${esc(u.nombre)}</td><td>${esc(u.correo)}</td>
      ${T.sec ? `<td>${esc(u.seccion || '-')}</td>` : ''}
      <td><span class="pill ${u.activo ? 'e-act' : 'e-ina'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td><div class="acc"><button data-ver="${u.id}" title="Ver">${ico('eye')}</button><button data-edit="${u.id}" title="Editar">${ico('edit')}</button><button data-del="${u.id}" title="Eliminar">${ico('trash')}</button></div></td></tr>`).join('')
      || `<tr><td colspan="${T.sec ? 6 : 5}" class="vacio">No hay ${T.texto.toLowerCase()} con esos filtros.</td></tr>`;
    paginador($('#pag'), $('#info'), tot, pag, POR, p => { pag = p; pintar(); });
    $('#info').textContent = $('#info').textContent.replace(/(\d+)$/, '$1 ' + T.texto.toLowerCase());
  };
  const recargar = async () => { await cargar(); pintar(); };

  const mostrarPin = (nombre, pin, titulo = 'PIN generado') => {
    modal(titulo, `<p class="aviso-txt">PIN de acceso para <b>${esc(nombre)}</b></p><div class="pin-grande">${esc(pin)}</div>
      <p class="aviso-txt">Entrégalo a la persona. Podrás generar uno nuevo cuando sea necesario.</p>`);
  };

  const formulario = u => {
    const nuevo = !u;
    const m = modal(nuevo ? 'Nuevo ' + TABS[rol].uno : 'Editar usuario', `<form id="fu" class="form-modal">
      <div><label>Nombre completo</label><input id="fn" required maxlength="100" placeholder="Nombre y apellido"></div>
      <div><label>NIE / código de acceso</label><input id="fnie" inputmode="numeric" maxlength="15" ${nuevo ? 'required' : 'disabled'}><small id="hnie"></small></div>
      ${nuevo ? '<div><label>PIN inicial (opcional)</label><input id="fpin0" inputmode="numeric" maxlength="4" placeholder="4 números; vacío = se genera uno"><small>Podrás verlo o cambiarlo después desde el detalle del usuario.</small></div>' : ''}
      <div><label>Correo electrónico</label><input id="fc" type="email" ${nuevo ? 'placeholder="Opcional: se genera con el NIE"' : 'required'}></div>
      <div><label>Rol</label><select id="fr" disabled><option value="alumno">Estudiante</option><option value="docente">Docente</option><option value="administrador">Administrador</option></select></div>
      <div id="wsec"><label>Sección</label><select id="fs">${S.length ? S.map(s => `<option value="${s.id}">${esc(s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')')}</option>`).join('') : '<option value="">Primero crea una sección</option>'}</select></div>
      ${nuevo ? '' : '<div><label>Estado</label><select id="fe"><option value="1">Activo</option><option value="0">Inactivo</option></select></div>'}
      <div class="acciones-modal"><button type="button" class="btn claro" data-x>Cancelar</button><button class="btn">${ico('save')} Guardar</button></div></form>`);
    $('#fn', m).value = u?.nombre || ''; $('#fnie', m).value = u?.nie || ''; $('#fc', m).value = u?.correo || '';
    $('#fr', m).value = u?.rol || rol; if (u?.seccion_id) $('#fs', m).value = u.seccion_id; if (!nuevo) $('#fe', m).value = u.activo ? 1 : 0;
    const ajustar = () => {
      const r = $('#fr', m).value; $('#wsec', m).style.display = r === 'alumno' ? '' : 'none';
      $('#hnie', m).textContent = r === 'alumno' ? 'Estudiantes: exactamente 8 números' : 'Solo números (máximo 15)';
      $('#fnie', m).maxLength = r === 'alumno' ? 8 : 15;
    };
    $('#fr', m).onchange = ajustar; ajustar();
    $('#fnie', m).oninput = e => { e.target.value = e.target.value.replace(/\D/g, ''); };
    if (nuevo) $('#fpin0', m).oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); };
    $('#fn', m).oninput = e => { e.target.value = e.target.value.replace(/[^\p{L}\s]/gu, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' '); };
    $('#fu', m).onsubmit = async e => {
      e.preventDefault();
      const rol = $('#fr', m).value, sec = $('#fs', m).value;
      const b = { nombre: $('#fn', m).value, correo: $('#fc', m).value, seccion_id: rol === 'alumno' ? sec : null };
      try {
        if (nuevo) {
          const r = await api('/api/admin/usuarios', { ...b, nie: $('#fnie', m).value, rol, pin: $('#fpin0', m).value });
          m.cerrar(); await recargar(); mostrarPin(b.nombre, r.pin, 'Usuario creado');
        } else {
          await api(`/api/admin/usuarios/${u.id}`, { ...b, activo: $('#fe', m).value === '1' }, 'PUT');
          m.cerrar(); await recargar(); toast('Usuario actualizado');
        }
      } catch (err) { toast(err.message); }
    };
  };

  const ver = u => {
    const m = modal('Detalle del usuario', `<dl class="det">
      <dt>ID</dt><dd>${pad(u.id)}</dd><dt>Nombre</dt><dd>${esc(u.nombre)}</dd><dt>NIE / código</dt><dd>${esc(u.nie || '-')}</dd>
      <dt>Correo</dt><dd>${esc(u.correo)}</dd><dt>Rol</dt><dd>${esc(ROL[u.rol] || u.rol)}</dd>
      <dt>Sección</dt><dd>${esc(u.seccion || '-')}</dd><dt>Estado</dt><dd>${u.activo ? 'Activo' : 'Inactivo'}</dd></dl>
      <p class="pinout" id="pinout"></p>
      <div class="inline-pin"><input id="pinfijo" inputmode="numeric" maxlength="4" placeholder="PIN nuevo (vacío = aleatorio)"><button class="btn claro" id="npin" type="button">${ico('rotate')} Restablecer PIN</button></div>
      <div class="acciones-modal" style="margin-top:10px"><button class="btn claro" id="vpin" type="button">${ico('eye')} Ver PIN actual</button></div>`);
    $('#vpin', m).onclick = async () => { try { $('#pinout', m).textContent = 'PIN: ' + (await api(`/api/admin/usuarios/${u.id}/pin`)).pin; } catch (e) { toast(e.message); } };
    $('#pinfijo', m).oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); };
    $('#npin', m).onclick = async () => {
      if (!confirmar('¿Cambiar el PIN? El anterior dejará de funcionar.')) return;
      try { const r = await api(`/api/admin/usuarios/${u.id}/pin`, { pin: $('#pinfijo', m).value }); $('#pinout', m).textContent = 'PIN nuevo: ' + r.pin; } catch (e) { toast(e.message); }
    };
  };

  $('#nuevo').onclick = () => formulario(null);
  $('#q').oninput = $('#fest').onchange = $('#fesp').onchange = $('#fanio').onchange = $('#fsec').onchange = () => { pag = 1; pintar(); };
  $('#tabs').onclick = e => {
    const b = e.target.closest('[data-rol]'); if (!b) return;
    rol = b.dataset.rol; location.hash = rol; pag = 1; $('#q').value = ''; $('#fesp').value = ''; $('#fanio').value = ''; $('#fsec').value = ''; pintar();
  };
  $('#tb').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = +(b.dataset.ver || b.dataset.edit || b.dataset.del), u = D.find(x => x.id === id); if (!u) return;
    if (b.dataset.ver) ver(u);
    else if (b.dataset.edit) formulario(u);
    else if (b.dataset.del) {
      if (!confirmar(`¿Eliminar a ${u.nombre}? Se borrarán también sus asistencias.`)) return;
      try { await api(`/api/admin/usuarios/${id}`, undefined, 'DELETE'); await recargar(); toast('Usuario eliminado'); } catch (err) { toast(err.message); }
    }
  };
  await recargar();
};

/* ================== Gestión de Secciones ================== */
PAGINAS.secciones = async yo => {
  let D = [], DOC = [], sel = null, pag = 1; const POR = 6;
  const cargar = async () => { [D, DOC] = await Promise.all([api('/api/admin/secciones'), api('/api/admin/docentes')]); };
  const nombre = s => s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')';
  const ANIO_ACTUAL = new Date().getFullYear();
  const vencida = s => s.activa && s.anio < ANIO_ACTUAL;   // sigue activa pero su año ya pasó
  const llenarAnio = () => {
    const act = $('#fanio').value, an = [...new Set(D.map(s => String(s.anio)))].sort().reverse();
    $('#fanio').innerHTML = '<option value="">Todos los años</option>' + an.map(a => `<option>${a}</option>`).join(''); $('#fanio').value = an.includes(act) ? act : '';
  };
  const llenarEsp = () => {
    const act = $('#fesp').value, es = [...new Set(D.map(s => s.especialidad))].sort();
    $('#fesp').innerHTML = '<option value="">Todas las especialidades</option>' + es.map(e => `<option>${esc(e)}</option>`).join(''); $('#fesp').value = es.includes(act) ? act : '';
  };
  const vis = () => {
    const q = $('#q').value.trim().toLowerCase(), e = $('#fesp').value, st = $('#fest').value, an = $('#fanio').value;
    return D.filter(s => (!e || s.especialidad === e) && (!an || String(s.anio) === an) && (!st || String(s.activa ? 1 : 0) === st)
      && `${nombre(s)} ${s.docente || ''}`.toLowerCase().includes(q));
  };
  const pintar = () => {
    const docs = new Set(D.filter(s => s.docente_id).map(s => s.docente_id)).size;
    $('#stats').innerHTML = stat('layers', 'Total secciones', D.length) + stat('book', 'Especialidades', new Set(D.map(s => s.especialidad)).size)
      + stat('user', 'Docentes asignados', docs) + stat('users', 'Estudiantes inscritos', D.reduce((a, s) => a + Number(s.estudiantes), 0));
    const v = vis(), ult = Math.max(1, Math.ceil(v.length / POR)); if (pag > ult) pag = ult;
    $('#tb').innerHTML = v.slice((pag - 1) * POR, pag * POR).map(s => `<tr class="clic${sel === s.id ? ' sel' : ''}" data-fila="${s.id}">
      <td>S${pad(s.id, 2)}</td><td>${esc(s.especialidad)}</td><td>${s.seccion}</td><td>${s.anio}</td><td>${esc(s.docente || 'Sin asignar')}</td><td>${s.estudiantes}${s.cupo_max ? ' / ' + s.cupo_max : ''}</td>
      <td><span class="pill ${s.activa ? 'e-act' : 'e-ina'}">${s.activa ? 'Activa' : 'Inactiva'}</span>${vencida(s) ? ` <span class="pill p-pend" title="El año de esta sección ya pasó">Año vencido</span>` : ''}</td>
      <td><div class="acc"><button data-ver="${s.id}" title="Ver">${ico('eye')}</button><button data-estado="${s.id}" title="${s.activa ? 'Poner inactiva' : 'Poner activa'}">${ico('rotate')}</button><button data-edit="${s.id}" title="Editar">${ico('edit')}</button><button data-del="${s.id}" title="Eliminar">${ico('trash')}</button></div></td></tr>`).join('')
      || '<tr><td colspan="8" class="vacio">No hay secciones con esos filtros.</td></tr>';
    paginador($('#pag'), $('#info'), v.length, pag, POR, p => { pag = p; pintar(); });
    $('#info').textContent = $('#info').textContent.replace(/(\d+)$/, '$1 secciones');
    detalle();
  };
  const detalle = () => {
    const s = D.find(x => x.id === sel);
    $('#det').innerHTML = s ? `<div class="det-tit">${ico('layers')} ${esc(nombre(s))}</div><dl class="det">
      <dt>Especialidad</dt><dd>${esc(s.especialidad)}</dd><dt>Sección</dt><dd>${s.seccion}</dd><dt>Año</dt><dd>${s.anio}</dd><dt>Docente</dt><dd>${esc(s.docente || 'Sin asignar')}</dd>
      <dt>Estudiantes</dt><dd>${s.estudiantes}</dd><dt>Estado</dt><dd><span class="pill ${s.activa ? 'e-act' : 'e-ina'}">${s.activa ? 'Activa' : 'Inactiva'}</span></dd></dl>
      <button class="btn block" style="margin-top:18px" id="deted">${ico('edit')} Editar sección</button>` : '<p class="vacio">Selecciona una sección para ver su detalle.</p>';
    if (s) $('#deted').onclick = () => formulario(s);
  };
  const recargar = async () => { await cargar(); llenarEsp(); llenarAnio(); pintar(); };

  const formulario = s => {
    const nuevo = !s;
    const m = modal(nuevo ? 'Nueva sección' : 'Editar sección', `<form id="fs" class="form-modal">
      <div><label>Especialidad</label><input id="fe" list="lesp" required maxlength="100" placeholder="Ej.: Desarrollo de Software"><datalist id="lesp">${[...new Set(D.map(x => x.especialidad))].map(e => `<option value="${esc(e)}">`).join('')}</datalist></div>
      <div><label>Número de sección (1 al 9)</label><input id="fn" type="number" min="1" max="9" required></div>
      <div><label>Año</label><input id="fy" type="number" min="2000" max="2100" required></div>
      <div><label>Docente asignado</label><select id="fd"><option value="">Sin asignar</option>${DOC.map(d => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('')}</select></div>
      <div><label>Estado</label><select id="fa"><option value="1">Activa</option><option value="0">Inactiva</option></select></div>
      <div class="acciones-modal"><button type="button" class="btn claro" data-x>Cancelar</button><button class="btn">${ico('save')} Guardar</button></div></form>`);
    $('#fe', m).value = s?.especialidad || 'Desarrollo de Software'; $('#fn', m).value = s?.seccion || ''; $('#fy', m).value = s?.anio || ANIO_ACTUAL;
    $('#fd', m).value = s?.docente_id || ''; $('#fa', m).value = s ? (s.activa ? 1 : 0) : 1;
    $('#fs', m).onsubmit = async e => {
      e.preventDefault();
      const b = { especialidad: $('#fe', m).value, seccion: $('#fn', m).value, anio: $('#fy', m).value, docente_id: $('#fd', m).value || null, activa: $('#fa', m).value === '1' };
      try {
        if (nuevo) { const r = await api('/api/admin/secciones', b); sel = r.id; } else await api(`/api/admin/secciones/${s.id}`, b, 'PUT');
        m.cerrar(); await recargar(); toast(nuevo ? 'Sección creada' : 'Sección actualizada');
      } catch (err) { toast(err.message); }
    };
  };

  $('#nuevo').onclick = () => formulario(null);
  $('#q').oninput = $('#fesp').onchange = $('#fanio').onchange = $('#fest').onchange = () => { pag = 1; pintar(); };
  $('#tb').onclick = async e => {
    const f = e.target.closest('[data-fila]'); if (!f) return;
    const id = +f.dataset.fila, b = e.target.closest('button'), s = D.find(x => x.id === id);
    sel = id;
    if (b?.dataset.estado) {
      pintar();
      const nuevoEstado = !s.activa;
      if (!confirmar(`¿Poner la sección ${nombre(s)} como ${nuevoEstado ? 'ACTIVA' : 'INACTIVA'}?`)) return;
      try {
        await api(`/api/admin/secciones/${id}`, { especialidad: s.especialidad, seccion: s.seccion, anio: s.anio, docente_id: s.docente_id || null, activa: nuevoEstado }, 'PUT');
        await recargar(); toast(nuevoEstado ? 'Sección activada' : 'Sección desactivada');
      } catch (err) { toast(err.message); }
      return;
    }
    if (b?.dataset.edit) { pintar(); return formulario(s); }
    if (b?.dataset.del) {
      pintar();
      if (!confirmar(`¿Eliminar la sección ${nombre(s)}?`)) return;
      try { await api(`/api/admin/secciones/${id}`, undefined, 'DELETE'); sel = null; await recargar(); toast('Sección eliminada'); } catch (err) { toast(err.message); }
      return;
    }
    pintar();
  };
  await recargar();
};

/* ================== Gestión de la Institución: meta de horas, máximo semanal y nombre ================== */
PAGINAS.institucion = async yo => {
  const c = await api('/api/admin/config');
  $('#fmeta').value = c.meta_horas; $('#fmax').value = c.max_horas_semana; $('#finst').value = c.institucion;
  $('#fconf').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/api/admin/config', { meta_horas: $('#fmeta').value, max_horas_semana: $('#fmax').value, institucion: $('#finst').value }, 'PUT');
      CFG = await api('/api/config'); toast('Configuración guardada');
    } catch (err) { toast(err.message); }
  };
};

/* ================== Proyectos y actividades (administrador: gestiona; docente: consulta y descarga) ================== */
PAGINAS.proyectos = async yo => {
  const ADM = yo.rol === 'administrador';
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>Proyectos y Actividades</h1>
      <p>${ADM ? 'Crea los proyectos, sus actividades y adjunta sus documentos (Word, PDF, Excel y más). También puedes cargar todas las actividades desde un documento de Word.' : 'Consulta los proyectos, sus actividades y descarga sus documentos.'}</p></div>
      ${ADM ? `<div class="accion fila-btns"><a class="btn claro" href="plantilla-actividades.docx" download>${ico('download')} Descargar plantilla</a><button class="btn claro" id="nword" type="button">${ico('file')} Importar desde Word</button><button class="btn claro" id="nact" type="button">${ico('plus')} Nueva actividad</button><button class="btn" id="nproy" type="button">${ico('plus')} Nuevo proyecto</button></div>` : ''}</div>
    <div id="prevW"></div>
    <div class="secciones proy-grid" id="gp"></div>
    ${ADM ? `<div class="card bloque" style="margin-top:18px"><h2>Todas las actividades</h2>
      <div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th>Actividad</th><th>Proyecto</th><th>Documentos</th><th>Usos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="tba"></tbody></table></div></div>` : ''}`;
  let D = { proyectos: [], sin_proyecto: [], max_archivo_mb: 10, extensiones: [] };
  const todasAct = () => [...D.proyectos.flatMap(p => p.actividades.map(a => ({ ...a, proyecto: p.nombre }))), ...D.sin_proyecto.map(a => ({ ...a, proyecto: '' }))]
    .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
  const tam = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

  const linkArch = f => `<a class="mini-arch" href="/api/proyectos/archivos/${f.id}" download title="${esc(f.nombre)} · ${tam(f.tamano)}">${ico('file')}<span>${esc(f.nombre)}</span></a>`;
  const actItem = a => `<li><span class="chip${a.activa ? '' : ' off'}">${esc(a.nombre)}</span>${(a.archivos || []).map(linkArch).join('')}</li>`;

  const pintar = () => {
    const tarjeta = p => `<article class="card seccion proy" data-pid="${p.id}">
      <header><div class="badge">${ico('folder')}</div><h3>${esc(p.nombre)}</h3><span class="pill ${p.activo ? 'e-act' : 'e-ina'}">${p.activo ? 'Activo' : 'Inactivo'}</span></header>
      ${p.descripcion ? `<p class="proy-desc">${esc(p.descripcion)}</p>` : ''}
      <div class="proy-sec"><b>Actividades (${p.actividades.length})</b>
        <ul class="acts">${p.actividades.map(actItem).join('') || '<li><small>Sin actividades todavía</small></li>'}</ul></div>
      <div class="proy-sec"><b>Documentos (${p.archivos.length})</b>
        <ul class="arch">${p.archivos.map(f => `<li><a href="/api/proyectos/archivos/${f.id}" download title="Descargar">${ico('file')}<span>${esc(f.nombre)}</span></a>
          <small>${tam(f.tamano)} · ${fmtF(f.fecha)}</small>${ADM ? `<button type="button" data-delf="${f.id}" title="Eliminar archivo">${ico('trash')}</button>` : ''}</li>`).join('') || '<li class="vacio-li">Sin documentos</li>'}</ul></div>
      ${ADM ? `<div class="fila-btns proy-btns"><button class="btn claro" data-sub="${p.id}" type="button">${ico('upload')} Subir documento</button>
        <div class="acc"><button data-ed="${p.id}" title="Editar" type="button">${ico('edit')}</button><button data-del="${p.id}" title="Eliminar" type="button">${ico('trash')}</button></div></div>
        <small class="drop-txt">Puedes arrastrar archivos aquí · máx. ${D.max_archivo_mb} MB</small>` : ''}</article>`;
    const sin = D.sin_proyecto.length ? `<article class="card seccion proy"><header><div class="badge">${ico('layers')}</div><h3>Actividades sin proyecto</h3></header>
      <ul class="acts">${D.sin_proyecto.map(actItem).join('')}</ul></article>` : '';
    $('#gp').innerHTML = D.proyectos.map(tarjeta).join('') + sin
      || `<p class="vacio">${ADM ? 'Aún no hay proyectos. Crea el primero con «Nuevo proyecto» y luego sube sus documentos desde su tarjeta.' : 'Todavía no hay proyectos disponibles.'}</p>`;
    if (!ADM) return;
    $('#tba').innerHTML = todasAct().map(a => `<tr><td>${esc(a.nombre)}</td><td>${esc(a.proyecto || 'Sin proyecto')}</td>
      <td><div class="arch-celda">${(a.archivos || []).map(f => `<span class="arch-fila">${linkArch(f)}<button type="button" data-delf="${f.id}" title="Eliminar documento">${ico('trash')}</button></span>`).join('') || '<small>Sin documentos</small>'}</div></td>
      <td>${a.usos}</td>
      <td><span class="pill ${a.activa ? 'e-act' : 'e-ina'}">${a.activa ? 'Activa' : 'Inactiva'}</span></td>
      <td><div class="acc"><button data-eda="${a.id}" title="Editar" type="button">${ico('edit')}</button><button data-dela="${a.id}" title="Eliminar" type="button">${ico('trash')}</button></div></td></tr>`).join('')
      || '<tr><td colspan="6" class="vacio">Aún no hay actividades. Los docentes también pueden escribir una actividad libre al cargar horas.</td></tr>';
  };
  const recargar = async () => { D = await api('/api/proyectos'); pintar(); };

  if (ADM) {
    const formP = p => {
      const m = modal(p ? 'Editar proyecto' : 'Nuevo proyecto', `<form class="form-modal" id="fp">
        <div><label>Nombre del proyecto</label><input id="pn" required maxlength="100"></div>
        <div><label>Descripción (opcional)</label><input id="pd" maxlength="255"></div>
        <div><label>Estado</label><select id="pa"><option value="1">Activo</option><option value="0">Inactivo</option></select></div>
        <div class="acciones-modal"><button type="button" class="btn claro" data-x>Cancelar</button><button class="btn">${ico('save')} Guardar</button></div></form>`);
      $('#pn', m).value = p?.nombre || ''; $('#pd', m).value = p?.descripcion || ''; $('#pa', m).value = p ? (p.activo ? 1 : 0) : 1;
      $('#fp', m).onsubmit = async e => {
        e.preventDefault();
        const b = { nombre: $('#pn', m).value, descripcion: $('#pd', m).value, activo: $('#pa', m).value === '1' };
        try { if (p) await api(`/api/admin/proyectos/${p.id}`, b, 'PUT'); else await api('/api/admin/proyectos', b); m.cerrar(); await recargar(); toast('Proyecto guardado'); }
        catch (err) { toast(err.message); }
      };
    };
    const formA = a => {
      const m = modal(a ? 'Editar actividad' : 'Nueva actividad', `<form class="form-modal" id="fa">
        <div><label>Nombre de la actividad</label><input id="an" required maxlength="100" placeholder="Ej.: Jornada de limpieza"></div>
        <div><label>Proyecto</label><select id="ap"><option value="">Sin proyecto</option>${D.proyectos.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div>
        <div><label>Estado</label><select id="aa"><option value="1">Activa</option><option value="0">Inactiva</option></select></div>
        <div class="acciones-modal"><button type="button" class="btn claro" data-x>Cancelar</button><button class="btn">${ico('save')} Guardar</button></div></form>`);
      $('#an', m).value = a?.nombre || ''; $('#ap', m).value = a?.proyecto_id || ''; $('#aa', m).value = a ? (a.activa ? 1 : 0) : 1;
      $('#fa', m).onsubmit = async e => {
        e.preventDefault();
        const b = { nombre: $('#an', m).value, proyecto_id: $('#ap', m).value || null, activa: $('#aa', m).value === '1' };
        try { if (a) await api(`/api/admin/actividades/${a.id}`, b, 'PUT'); else await api('/api/admin/actividades', b); m.cerrar(); await recargar(); toast('Actividad guardada'); }
        catch (err) { toast(err.message); }
      };
    };
    // Subida de documentos: el archivo viaja tal cual y su nombre en una cabecera
    const subir = async (tipo, pid, archivos) => {
      let ok = 0;
      for (const f of archivos) {
        if (f.size > D.max_archivo_mb * 1048576) { toast(`"${f.name}" supera el máximo de ${D.max_archivo_mb} MB`); continue; }
        try {
          const r = await fetch(`/api/admin/${tipo === 'actividad' ? 'actividades' : 'proyectos'}/${pid}/archivos`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre-Archivo': encodeURIComponent(f.name) }, body: f });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { toast(j.error || `No se pudo subir "${f.name}"`); continue; }
          ok++;
        } catch { toast(`No se pudo subir "${f.name}"`); }
      }
      if (ok) { await recargar(); toast(ok === 1 ? 'Documento subido' : ok + ' documentos subidos'); }
    };
    const selector = document.createElement('input');
    selector.type = 'file'; selector.multiple = true; selector.hidden = true;
    selector.accept = D.extensiones.map(e => '.' + e).join(',');
    document.body.appendChild(selector);
    let destino = null;
    selector.onchange = () => { const f = [...selector.files]; selector.value = ''; if (destino && f.length) subir(destino.tipo, destino.id, f); };

    /* ---------- Importar actividades desde un documento de Word: vista previa y luego se guarda una por una ---------- */
    const wordInput = document.createElement('input');
    wordInput.type = 'file'; wordInput.accept = '.docx'; wordInput.hidden = true;
    document.body.appendChild(wordInput);
    let archivoWord = null;
    const enviarWord = async aplicar => {
      const r = await fetch(`/api/admin/actividades/importar-word?aplicar=${aplicar ? 1 : 0}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivoWord });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo leer el documento');
      return j;
    };
    const pintarWord = (r, aplicado) => {
      const R = r.resumen, pill = e => e === 'nuevo' ? 'p-valid' : e === 'igual' ? 'p-pend' : 'e-ina';
      $('#prevW').innerHTML = `<div class="card bloque" style="margin-bottom:18px"><h2>${aplicado ? 'Resultado: ya se guardó' : 'Vista previa del documento (aún no se guardó nada)'}</h2>
        <p class="sub" style="margin:0 0 10px">${esc(archivoWord.name)}</p>
        <div class="fila-btns" style="margin-bottom:12px"><span class="pill p-valid">${R.proyectos} ${aplicado ? 'proyectos creados' : 'proyectos nuevos'}</span><span class="pill p-valid">${R.nuevas} ${aplicado ? 'actividades creadas' : 'actividades por crear'}</span>
          <span class="pill p-pend">${R.igual} ya existían</span><span class="pill e-ina">${R.error} con error</span></div>
        <div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th>Fila</th><th>Proyecto</th><th>Actividad</th><th>Estado</th></tr></thead><tbody>
        ${r.filas.map(f => `<tr><td>${f.fila}</td><td>${esc(f.proyecto || 'Sin proyecto')}</td><td>${esc(f.actividad)}</td><td><span class="pill ${pill(f.estado)}">${esc(f.mensaje)}</span></td></tr>`).join('')}</tbody></table></div>
        <div class="fila-btns" style="margin-top:14px">${!aplicado ? `<button class="btn" id="wguardar" type="button" ${R.nuevas ? '' : 'disabled'}>${ico('save')} Guardar ${R.nuevas} actividades</button>` : ''}
          <button class="btn claro" id="wcerrar" type="button">${aplicado ? 'Cerrar' : 'Cancelar'}</button></div></div>`;
      $('#wcerrar').onclick = () => { $('#prevW').innerHTML = ''; archivoWord = null; };
      if ($('#wguardar')) $('#wguardar').onclick = async () => {
        if (!confirmar(`¿Guardar ${R.nuevas} actividades${R.proyectos ? ' y ' + R.proyectos + ' proyectos nuevos' : ''}?`)) return;
        $('#wguardar').disabled = true;
        try { const x = await enviarWord(true); await recargar(); pintarWord(x, true); toast('Actividades guardadas'); }
        catch (err) { $('#wguardar').disabled = false; toast(err.message); }
      };
      $('#prevW').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    wordInput.onchange = async () => {
      const f = wordInput.files[0]; wordInput.value = ''; if (!f) return;
      if (!/\.docx$/i.test(f.name)) return toast('Elige un documento de Word (.docx)');
      if (f.size > 5 * 1024 * 1024) return toast('El documento es demasiado grande (máximo 5 MB)');
      archivoWord = f;
      try { pintarWord(await enviarWord(false), false); } catch (err) { archivoWord = null; toast(err.message); }
    };
    $('#nword').onclick = () => wordInput.click();
    $('#nproy').onclick = () => formP(null);
    $('#nact').onclick = () => formA(null);
    $('#gp').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.sub) { destino = { tipo: 'proyecto', id: +b.dataset.sub }; selector.accept = D.extensiones.map(x => '.' + x).join(','); return selector.click(); }
      if (b.dataset.delf) {
        if (!confirmar('¿Eliminar este documento?')) return;
        try { await api(`/api/admin/proyectos/archivos/${b.dataset.delf}`, undefined, 'DELETE'); await recargar(); toast('Documento eliminado'); } catch (err) { toast(err.message); }
        return;
      }
      const id = +(b.dataset.ed || b.dataset.del), p = D.proyectos.find(x => x.id === id); if (!p) return;
      if (b.dataset.ed) return formP(p);
      if (!confirmar(`¿Eliminar el proyecto "${p.nombre}" y sus documentos?`)) return;
      try { await api(`/api/admin/proyectos/${id}`, undefined, 'DELETE'); await recargar(); toast('Proyecto eliminado'); } catch (err) { toast(err.message); }
    };
    // Arrastrar archivos sobre la tarjeta del proyecto
    $('#gp').ondragover = e => { const t = e.target.closest('[data-pid]'); if (t) { e.preventDefault(); t.classList.add('soltar'); } };
    $('#gp').ondragleave = e => { const t = e.target.closest('[data-pid]'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('soltar'); };
    $('#gp').ondrop = e => { const t = e.target.closest('[data-pid]'); if (!t) return; e.preventDefault(); t.classList.remove('soltar'); subir('proyecto', +t.dataset.pid, [...e.dataTransfer.files]); };
    $('#tba').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.delf) {
        if (!confirmar('¿Eliminar este documento?')) return;
        try { await api(`/api/admin/proyectos/archivos/${b.dataset.delf}`, undefined, 'DELETE'); await recargar(); toast('Documento eliminado'); } catch (err) { toast(err.message); }
        return;
      }
      const id = +(b.dataset.eda || b.dataset.dela), a = todasAct().find(x => x.id === id); if (!a) return;
      if (b.dataset.eda) return formA(a);
      if (!confirmar(`¿Eliminar la actividad "${a.nombre}"? Las horas ya registradas conservan su nombre.`)) return;
      try { await api(`/api/admin/actividades/${id}`, undefined, 'DELETE'); await recargar(); toast('Actividad eliminada'); } catch (err) { toast(err.message); }
    };
  }
  await recargar();
};

/* ================== Registro de Asistencia Docente ================== */
PAGINAS.asistencia = async yo => {
  const EST = { presente: 'Presente', falto: 'Ausente', permiso: 'Justificado', tarde: 'Tardanza' };
  const COL = { presente: '#7b1230', falto: '#f1c9d4', permiso: '#2b7fd6', tarde: '#f5b82e' };
  let SEC = [], R = [], pag = 1; const POR = 8;
  const DOC = yo.rol === 'administrador';   // el administrador marca la asistencia de los DOCENTES
  $('#fecha').value = hoy(); $('#fecha').max = hoy();
  if (DOC) {
    $('#sec').closest('.campo').style.display = 'none';
    $('.titulo p').textContent = 'Marca la asistencia de los docentes por fecha.';
    $('h2', $('#cuerpo')).textContent = 'Lista de docentes';
    $('#q').placeholder = 'Buscar docente...';
    $('th:nth-child(2)', $('#cuerpo')).textContent = 'Docente (apellidos, nombres)';
    $('#todos').textContent = 'Marcar todos como presentes';
    document.title = 'INFRAMEN - Registro de Asistencia Docente';
  } else {
    $('.titulo p').textContent = `Marca la asistencia de los estudiantes por sección y fecha. Quien quede como «Justificado» recibe ${CFG.horas_permiso || 2} h automáticamente ese día.`;
    SEC = (await api('/api/admin/secciones')).filter(s => s.activa);
    $('#sec').innerHTML = SEC.map(s => `<option value="${s.id}">${esc(s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')')}</option>`).join('');
  }
  if (!DOC && !SEC.length) {
    $('#cuerpo').innerHTML = '<div class="card bloque"><p class="vacio">No tienes secciones activas asignadas.</p></div>'; return;
  }

  const cargar = async () => {
    try {
      const r = await api(DOC ? `/api/admin/asistencia-docentes?fecha=${$('#fecha').value}` : `/api/admin/asistencia?seccion_id=${$('#sec').value}&fecha=${$('#fecha').value}`);
      R = r.map(a => ({ ...a, estado: a.estado || 'presente', sel: false })).sort(porApellido); pag = 1; pintar();
    } catch (e) { toast(e.message); }
  };
  const vis = () => { const q = $('#q').value.trim().toLowerCase(); return R.filter(a => (a.nombre + ' ' + a.nie).toLowerCase().includes(q)); };
  const pintar = () => {
    const v = vis(), ult = Math.max(1, Math.ceil(v.length / POR)); if (pag > ult) pag = ult;
    $('#tb').innerHTML = v.slice((pag - 1) * POR, pag * POR).map(a => `<tr data-id="${a.id}">
      <td><input type="checkbox" class="chk"${a.sel ? ' checked' : ''}></td><td>${esc(apellidosPrimero(a.nombre))}<small>${esc(a.nie)}</small></td>
      <td data-l="Estado"><select class="est ${a.estado}">${Object.entries(EST).map(([k, t]) => `<option value="${k}"${k === a.estado ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
      <td data-l="Observaciones"><input class="obs" maxlength="255" placeholder="-" value="${esc(a.obs)}"></td></tr>`).join('')
      || `<tr><td colspan="4" class="vacio">${DOC ? 'No hay docentes registrados.' : 'No hay estudiantes en esta sección.'}</td></tr>`;
    paginador($('#pag'), $('#info'), v.length, pag, POR, p => { pag = p; pintar(); });
    $('#info').textContent = $('#info').textContent.replace(/(\d+)$/, DOC ? '$1 docentes' : '$1 estudiantes');
    resumen();
  };
  const resumen = () => {
    const n = k => R.filter(a => a.estado === k).length, T = R.length, pct = T ? Math.round((n('presente') + n('tarde')) / T * 100) : 0;
    let acum = 0;
    const seg = Object.keys(EST).map(k => { const d = T ? n(k) / T * 360 : 0, s = `${COL[k]} ${acum}deg ${acum + d}deg`; acum += d; return s; });
    $('#donut').style.background = T ? `conic-gradient(${seg.join(',')})` : '#eee';
    $('#pct').textContent = pct + '%';
    $('#ley').innerHTML = Object.entries(EST).map(([k, t]) => `<li><i style="background:${COL[k]}"></i>${t === 'Presente' ? 'Presentes' : t === 'Ausente' ? 'Ausentes' : t === 'Justificado' ? 'Justificados' : 'Tardanzas'}<b>${n(k)}</b></li>`).join('');
    $('#total').textContent = 'Total: ' + T;
  };

  $('#tb').onchange = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return; const a = R.find(x => x.id === +tr.dataset.id);
    if (e.target.matches('.est')) { a.estado = e.target.value; e.target.className = 'est ' + a.estado; resumen(); }
    if (e.target.matches('.chk')) a.sel = e.target.checked;
  };
  $('#tb').oninput = e => { if (e.target.matches('.obs')) R.find(x => x.id === +e.target.closest('tr').dataset.id).obs = e.target.value; };
  $('#q').oninput = () => { pag = 1; pintar(); };
  $('#sec').onchange = cargar;
  $('#fecha').onchange = () => { if (!$('#fecha').value || $('#fecha').value > hoy()) { $('#fecha').value = hoy(); toast('No se puede elegir una fecha futura'); } cargar(); };
  // El botón genera el PDF de la asistencia (sección + fecha elegidas, con lo que hay en pantalla)
  $('#cargar').onclick = () => {
    if (!R.length) return toast(DOC ? 'No hay docentes para generar el PDF' : 'No hay estudiantes para generar el PDF');
    if (!window.jspdf) return toast('No se pudo cargar la librería de PDF');
    const sec = DOC ? 'Docentes' : $('#sec').selectedOptions[0].textContent.trim(), f = $('#fecha').value;
    const n = k => R.filter(a => a.estado === k).length, T = R.length, pct = Math.round((n('presente') + n('tarde')) / T * 100);
    const doc = new jspdf.jsPDF();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(16, 40, 79); doc.text(DOC ? 'Registro de asistencia docente' : 'Registro de asistencia', 14, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(60, 75, 110);
    doc.text(`INFRAMEN · ${CFG.institucion}`, 14, 25);
    doc.text(DOC ? `Personal docente    Fecha: ${fmtF(f)}` : `Sección: ${sec}    Fecha: ${fmtF(f)}`, 14, 32);
    doc.text(`Presentes: ${n('presente')}   Ausentes: ${n('falto')}   Justificados: ${n('permiso')}   Tardanzas: ${n('tarde')}   Total: ${T}   Asistencia: ${pct}%`, 14, 39);
    doc.autoTable({ startY: 45, head: [['#', 'NIE', DOC ? 'Docente (apellidos, nombres)' : 'Estudiante (apellidos, nombres)', 'Estado', 'Observaciones']],
      body: R.map((a, i) => [i + 1, a.nie, apellidosPrimero(a.nombre), EST[a.estado], a.obs || '-']),
      headStyles: { fillColor: [123, 18, 48] }, styles: { fontSize: 9 }, columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 24 } } });
    doc.save(`asistencia-${sec.replace(/\s+/g, '-')}-${f}.pdf`);
  };
  $('#todos').onclick = () => { const s = R.some(a => a.sel); R.forEach(a => { if (!s || a.sel) a.estado = 'presente'; }); pintar(); toast(s ? 'Seleccionados marcados como presentes' : 'Todos marcados como presentes'); };
  $('#limpiar').onclick = () => { R.forEach(a => { a.sel = false; }); pintar(); };
  $('#guardar').onclick = async () => {
    if (!R.length) return toast(DOC ? 'No hay docentes para guardar' : 'No hay estudiantes para guardar');
    try {
      let extra = '';
      if (DOC) await api('/api/admin/asistencia-docentes', { fecha: $('#fecha').value, registros: R.map(a => ({ docente_id: a.id, estado: a.estado, obs: a.obs })) });
      else {
        const r = await api('/api/admin/asistencia', { seccion_id: +$('#sec').value, fecha: $('#fecha').value, registros: R.map(a => ({ alumno_id: a.id, estado: a.estado, obs: a.obs })) });
        if (r.horas_auto) extra = ` · se sumaron ${r.horas_por_permiso} h a ${r.horas_auto} estudiante${r.horas_auto === 1 ? '' : 's'} justificado${r.horas_auto === 1 ? '' : 's'}`;
      }
      toast('Asistencia guardada' + extra);
    } catch (e) { toast(e.message); }
  };
  await cargar();
};

/* ================== Reportes y Estadísticas (administrador y docente) ================== */
PAGINAS.reportes = async yo => {
  let R = null;
  const h = hoy(); $('#rd').value = h.slice(0, 8) + '01'; $('#rh').value = h;
  const secs = await api('/api/admin/secciones');
  $('#rs').innerHTML = '<option value="">Todas las secciones</option>' + secs.map(s => `<option value="${s.id}">${esc(s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')')}</option>`).join('');
  const cargar = async () => {
    try {
      R = await api(`/api/admin/reportes?desde=${$('#rd').value}&hasta=${$('#rh').value}&seccion_id=${$('#rs').value}`); pintar();
    } catch (e) { toast(e.message); }
  };
  const pintar = () => {
    const a = R.asistencia, rend = R.rendimiento;
    $('#kpis').innerHTML = stat('users', 'Total de estudiantes', R.estudiantes) + stat('check', 'Asistencia promedio', a.promedio + '%')
      + stat('chart', 'Rendimiento global', rend.pct + '%') + stat('clock', 'Horas validadas (período)', R.horas.toLocaleString('es-SV') + ' h');
    $('#metaTxt').textContent = `· meta: ${R.meta} h · ${rend.completaron} de ${R.estudiantes} completaron · ${rend.pendientes} h pendientes de validar`;
    $('#avance').innerHTML = filasAvance(R.avance);
    $('#plot').innerHTML = R.porSeccion.map(s => `<div class="col"><div class="v" style="bottom:calc(${s.pct}% + 4px)">${s.total ? s.pct + '%' : '-'}</div><div class="b" style="height:${s.pct}%"></div></div>`).join('')
      || '<p class="vacio" style="width:100%">Sin secciones.</p>';
    $('#etq').innerHTML = R.porSeccion.map(s => `<span title="${esc(s.grupo)}">${esc(s.grupo)}</span>`).join('');
    const D = [['presente', 'Presentes', '#7b1230'], ['tarde', 'Tardanzas', '#f5b82e'], ['permiso', 'Justificados', '#2b7fd6'], ['falto', 'Ausentes', '#f1c9d4']];
    let acum = 0;
    const seg = D.map(([k, , c]) => { const d = a.total ? a[k] / a.total * 360 : 0, s = `${c} ${acum}deg ${acum + d}deg`; acum += d; return s; });
    $('#donut').style.background = a.total ? `conic-gradient(${seg.join(',')})` : '#eee';
    $('#dtot').textContent = a.total;
    $('#ley').innerHTML = D.map(([k, t, c]) => `<li><i style="background:${c}"></i>${t}<b>${a[k]} (${a.total ? Math.round(a[k] / a.total * 100) : 0}%)</b></li>`).join('');
    $('#act').innerHTML = R.actividad.map(x => `<tr><td>${fmtF(x.fecha)}</td><td>Registro de asistencia - ${esc(x.grupo)}</td>
      <td><span class="pill t-asis">Asistencia</span></td><td><span class="pill ${x.pct >= 80 ? 'e-act' : x.pct >= 60 ? 'p-tarde' : 'e-ina'}">${x.pct}% (${x.pres}/${x.registros})</span></td></tr>`).join('')
      || '<tr><td colspan="4" class="vacio">No hay asistencias registradas en este rango.</td></tr>';
  };
  // Una fila por sección: asistencia del período + avance de horas acumulado
  const filasSec = () => R.porSeccion.map(s => {
    const v = R.avance.find(x => x.grupo === s.grupo);
    return [s.grupo, s.total, s.pres, s.pct + '%', v ? v.horas : 0, v ? v.pct + '%' : '0%'];
  });
  const cols = ['Sección', 'Registros', 'Asistieron', '% Asistencia', 'Horas validadas', '% de la meta'];
  $('#rd').onchange = $('#rh').onchange = () => {
    if ($('#rd').value && $('#rh').value && $('#rd').value > $('#rh').value) { $('#rh').value = $('#rd').value; toast('La fecha final no puede ser anterior a la inicial'); }
    cargar();
  };
  $('#rs').onchange = cargar;
  $('#gen').onclick = () => R && pdf(`Reporte académico (${fmtF(R.desde)} - ${fmtF(R.hasta)})`, cols, filasSec(), 'reporte-academico.pdf');
  $('#exp').onclick = () => R && bajar('reporte-asistencia.csv', cols.join(',') + '\n' + filasSec().map(f => f.map(c => `"${c}"`).join(',')).join('\n'));
  await cargar();
};

/* ================== Asignación de estudiantes a secciones: uno por uno o por CSV ================== */
// Lee un CSV (separado por coma o punto y coma, con o sin comillas) y devuelve una matriz de textos
function leerCSV(texto) {
  texto = texto.replace(/^\ufeff/, '');
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = [], c = '', q = false;
  const cerrar = () => { fila.push(c); c = ''; if (fila.some(x => x.trim() !== '')) filas.push(fila); fila = []; };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (q) { if (ch === '"') { if (texto[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { fila.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; cerrar(); }
    else c += ch;
  }
  if (c !== '' || fila.length) cerrar();
  return filas.map(f => f.map(x => x.trim()));
}

PAGINAS.asignar = async yo => {
  const ADM = yo.rol === 'administrador';   // el docente da de alta estudiantes solo en sus secciones
  $('#contenido').innerHTML = `<div class="titulo"><div><h1>${ADM ? 'Asignación de estudiantes' : 'Alta de estudiantes'}</h1><p>${ADM
      ? 'Da de alta a los estudiantes y asígnalos a su sección: con un archivo CSV o uno por uno.'
      : 'Crea a tus estudiantes en tus secciones: uno por uno o con un archivo CSV. Cada estudiante recibe un PIN de acceso.'}</p></div></div>
    <div class="tabs" id="tabsA">${ADM
      ? '<button class="tab on" data-t="csv">Alta por archivo CSV</button><button class="tab" data-t="manual">Asignar uno por uno</button>'
      : '<button class="tab on" data-t="nuevo">Nuevo estudiante</button><button class="tab" data-t="csv">Alta por archivo CSV</button>'}</div>
    <div id="vNuevo"${ADM ? ' style="display:none"' : ''}></div><div id="vCsv"${ADM ? '' : ' style="display:none"'}></div><div id="vManual" style="display:none"></div>`;
  let E = [], S = [];
  const sel = new Set(); let pag = 1; const POR = 12;
  let pintarManual = () => {};
  const cargar = async () => {
    if (!ADM) { S = await api('/api/admin/secciones'); return; }
    [E, S] = await Promise.all([api('/api/admin/usuarios'), api('/api/admin/secciones')]);
    E = E.filter(u => u.rol === 'alumno' && u.activo).sort(porApellido);
  };
  $('#tabsA').onclick = e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    $$('#tabsA .tab').forEach(x => x.classList.toggle('on', x === b));
    $('#vCsv').style.display = b.dataset.t === 'csv' ? '' : 'none';
    $('#vManual').style.display = b.dataset.t === 'manual' ? '' : 'none';
    $('#vNuevo').style.display = b.dataset.t === 'nuevo' ? '' : 'none';
  };

  /* ---------- Alta por CSV: crea a los estudiantes que no existen y los asigna a su sección ---------- */
  $('#vCsv').innerHTML = `<div class="card bloque" style="margin-bottom:14px"><h2>Cargar archivo</h2>
      <p class="sub" style="margin:0 0 12px">Una fila por estudiante, con las columnas <b>nie</b>, <b>nombre</b> y <b>seccion</b> (el nombre de la sección como aparece en Gestión de Secciones, por ejemplo <i>Desarrollo de Software 1</i>).
      Si el NIE no existe, se <b>crea la cuenta</b> del estudiante con un PIN generado y se asigna a la sección. Si ya existe y no tiene sección, solo se asigna. A quien ya tiene sección no se le cambia.
      También se acepta <b>especialidad</b> y <b>seccion</b> (número) en columnas separadas. Para secciones de otros años agrega la columna <b>anio</b> (por ejemplo <i>2025</i>) o elige el año aquí abajo. Sirve coma o punto y coma. Máximo 500 filas por carga y 50 estudiantes por sección.</p>
      <div class="fila-btns" style="margin-bottom:12px"><div style="min-width:260px"><label for="anioDef">Año de la sección</label>
        <select id="anioDef"><option value="">Según el archivo (o la sección activa)</option></select></div></div>
      <div class="fila-btns"><button class="btn claro" id="plantilla" type="button">${ico('download')} Descargar plantilla</button>
      <label class="btn" style="cursor:pointer">${ico('file')} Elegir archivo CSV<input type="file" id="arch" accept=".csv,.txt,text/csv" hidden></label></div></div>
    <div id="prev"></div>`;
  $('#plantilla').onclick = () => bajar('plantilla-estudiantes.csv', 'nie,nombre,seccion,anio\n21045001,Nombre Apellido,' + (S[0] ? S[0].especialidad + ' ' + S[0].seccion : 'Desarrollo de Software 1') + ',' + (S[0] ? S[0].anio : new Date().getFullYear()) + '\n');
  let filasCSV = [], filasBase = [];
  // Cada fila usa su propio año (columna "anio"); si no lo trae, el año elegido en pantalla; si tampoco, el servidor busca la sección activa.
  const aplicarAnio = () => { const d = $('#anioDef').value; filasCSV = filasBase.map(f => ({ ...f, anio: f.anio || d })); };
  const csvCelda = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const pintarPrev = (r, aplicado) => {
    const R = r.resumen, pill = e => e === 'nuevo' || e === 'ok' ? 'p-valid' : e === 'igual' ? 'p-pend' : 'e-ina';
    const hay = R.nuevo + R.ok;
    $('#prev').innerHTML = `<div class="card bloque"><h2>${aplicado ? 'Resultado: ya se guardó en la base de datos' : 'Vista previa (aún no se guardó nada)'}</h2>
      <div class="fila-btns" style="margin-bottom:12px"><span class="pill p-valid">${R.nuevo} ${aplicado ? 'creados' : 'por crear'}</span><span class="pill p-valid">${R.ok} ${aplicado ? 'asignados' : 'por asignar'}</span>
        <span class="pill p-pend">${R.igual} ya estaban</span><span class="pill e-ina">${R.error} con error</span></div>
      <div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th>Fila</th><th>NIE</th><th>Estudiante</th><th>Sección destino</th><th>Año</th>${aplicado ? '<th>PIN</th>' : ''}<th>Estado</th></tr></thead><tbody>
      ${r.filas.map(f => `<tr><td>${f.fila}</td><td>${esc(f.nie)}</td><td>${esc(f.nombre || '-')}</td><td>${esc(f.seccion || '-')}</td><td>${esc(f.anio || '-')}</td>
        ${aplicado ? `<td><b>${esc(f.pin || '-')}</b></td>` : ''}<td><span class="pill ${pill(f.estado)}">${esc(f.mensaje)}</span></td></tr>`).join('')}</tbody></table></div>
      <div class="fila-btns" style="margin-top:14px">
        ${!aplicado ? `<button class="btn" id="aplicar" ${hay ? '' : 'disabled'}>${ico('save')} Guardar ${hay} estudiantes en la base de datos</button>` : ''}
        ${aplicado && R.nuevo ? '<button class="btn" id="creds" type="button">Descargar PIN de los estudiantes creados</button>' : ''}
        ${R.error ? '<button class="btn claro" id="errores" type="button">Descargar filas con error</button>' : ''}</div>
      ${aplicado && R.nuevo ? '<p class="aviso-txt" style="text-align:left;margin-top:10px">Descarga y guarda los PIN ahora para entregarlos a los estudiantes. Después podrás verlos en Gestión de Usuarios (Ver PIN).</p>' : ''}</div>`;
    poner($('#prev'));
    if ($('#errores')) $('#errores').onclick = () => bajar('errores-carga.csv', 'fila,nie,nombre,seccion,anio,motivo\n' + r.filas.filter(f => f.estado === 'error').map(f => [f.fila, f.nie, f.nombre, f.seccion, f.anio, f.mensaje].map(csvCelda).join(',')).join('\n'));
    if ($('#creds')) $('#creds').onclick = () => bajar('pin-estudiantes-nuevos.csv', 'nie,nombre,seccion,anio,pin\n' + r.filas.filter(f => f.pin).map(f => [f.nie, f.nombre, f.seccion, f.anio, f.pin].map(csvCelda).join(',')).join('\n'));
    if ($('#aplicar')) $('#aplicar').onclick = async () => {
      if (!confirmar(`¿Guardar en la base de datos? Se crearán ${R.nuevo} estudiantes y se asignarán ${R.ok}.`)) return;
      $('#aplicar').disabled = true;
      try { const x = await api('/api/admin/asignaciones/csv', { filas: filasCSV, aplicar: true }); pintarPrev(x, true); await cargar(); llenarAnios(); pintarManual(); toast('Estudiantes guardados en la base de datos'); }
      catch (err) { $('#aplicar').disabled = false; toast(err.message); }
    };
  };
  $('#arch').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('El archivo es demasiado grande (máximo 2 MB)');
    const m = leerCSV(await f.text());
    if (!m.length) return toast('El archivo está vacío');
    const nz = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let ini = 0, iN = 0, iNom = 1, iS = 2, iE = -1, iA = -1;
    if (!/^\d+$/.test(m[0][0])) {   // la primera fila es el encabezado
      const h = m[0].map(nz); ini = 1;
      iN = h.findIndex(x => /^(nie|carnet|carne|codigo)/.test(x)); iS = h.findIndex(x => /^(seccion|grupo)/.test(x));
      iNom = h.findIndex(x => /^(nombre|estudiante|alumno)/.test(x)); iE = h.findIndex(x => /^especialidad/.test(x)); iA = h.findIndex(x => /^(anio|ano|year)$/.test(x));
      if (iN < 0 || iS < 0) return toast('No encontré las columnas "nie" y "seccion" en la primera fila');
    } else if (m[0].length >= 4) { iE = 2; iS = 3; }
    else if (m[0].length === 2) { iNom = -1; iS = 1; }
    filasBase = m.slice(ini).map(f => ({ nie: (f[iN] || '').trim(), nombre: iNom >= 0 ? (f[iNom] || '') : '', seccion: [iE >= 0 ? f[iE] : '', f[iS] || ''].filter(Boolean).join(' ').trim(), anio: iA >= 0 ? (f[iA] || '').trim() : '' }));
    if (!filasBase.length) return toast('El archivo no tiene filas de datos');
    if (filasBase.length > 500) { filasBase = []; return toast('Máximo 500 filas por carga: divide el archivo'); }
    revisarCSV();
  };
  // Los años salen de las secciones, que se cargan después de dibujar la pantalla: por eso el selector se llena aquí.
  const llenarAnios = () => {
    const d = $('#anioDef').value;
    $('#anioDef').innerHTML = '<option value="">Según el archivo (o la sección activa)</option>' + [...new Set(S.map(x => x.anio))].sort((p, q) => q - p).map(y => `<option value="${y}">${y}</option>`).join('');
    $('#anioDef').value = d;
  };
  const revisarCSV = async () => {
    if (!filasBase.length) return;
    aplicarAnio();
    try { pintarPrev(await api('/api/admin/asignaciones/csv', { filas: filasCSV, aplicar: false }), false); }
    catch (err) { toast(err.message); }
  };
  $('#anioDef').onchange = revisarCSV;   // al cambiar el año, se vuelve a revisar el archivo ya cargado

  if (ADM) {
    /* ---------- Uno por uno: estudiantes que aún no tienen sección ---------- */
    $('#vManual').innerHTML = `<div class="nota">${ico('users', 'ico')}<span>Aquí aparecen los estudiantes ya creados. Solo se pueden asignar los que <b>no tienen sección</b>. Para crear un estudiante nuevo usa el archivo CSV o Usuarios → Estudiantes.</span></div>
      <div class="card filtros"><div class="buscar grow">${ico('search')}<input id="q" placeholder="Buscar por nombre o NIE..."></div>
        <select id="fs"><option value="sin">Sin sección asignada</option><option value="">Todos los estudiantes</option></select></div>
      <div class="card pie-guardar" style="position:static;margin:0 0 14px"><b id="cuenta">0 seleccionados</b>
        <div class="fila-btns"><select id="dest"></select><button class="btn" id="asignar" type="button">${ico('ok')} Asignar a la sección</button></div></div>
      <div class="card bloque"><div class="tabla-scroll"><table class="tabla-cards"><thead><tr><th style="width:40px"><input type="checkbox" id="todos" title="Marcar los visibles"></th><th>NIE</th><th>Estudiante</th><th>Sección actual</th></tr></thead><tbody id="tb"></tbody></table></div>
      <div class="pie-tabla"><span id="info"></span><div class="pag" id="pag"></div></div></div>`;
    const vis = () => {
      const q = $('#q').value.trim().toLowerCase(), f = $('#fs').value;
      return E.filter(u => (!f || !u.seccion_id) && (u.nombre + ' ' + u.nie).toLowerCase().includes(q));
    };
    pintarManual = () => {
      const d = $('#dest').value;
      $('#dest').innerHTML = '<option value="">Elige la sección destino</option>' + S.filter(s => s.activa).map(s => `<option value="${s.id}">${esc(s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')')}</option>`).join('');
      $('#dest').value = d;
      for (const id of [...sel]) { const u = E.find(x => x.id === id); if (!u || u.seccion_id) sel.delete(id); }
      const v = vis(), ult = Math.max(1, Math.ceil(v.length / POR)); if (pag > ult) pag = ult;
      const pagina = v.slice((pag - 1) * POR, pag * POR);
      $('#tb').innerHTML = pagina.map(u => `<tr data-id="${u.id}"><td><input type="checkbox" class="chk"${sel.has(u.id) ? ' checked' : ''}${u.seccion_id ? ' disabled' : ''}></td><td>${esc(u.nie)}</td><td><b>${esc(apellidosPrimero(u.nombre))}</b></td>
        <td>${u.seccion ? esc(u.seccion) : '<span class="pill p-pend">Sin sección</span>'}</td></tr>`).join('')
        || '<tr><td colspan="4" class="vacio">No hay estudiantes con esos filtros.</td></tr>';
      const libres = pagina.filter(u => !u.seccion_id);
      $('#todos').checked = libres.length > 0 && libres.every(u => sel.has(u.id));
      $('#cuenta').textContent = sel.size + (sel.size === 1 ? ' seleccionado' : ' seleccionados');
      paginador($('#pag'), $('#info'), v.length, pag, POR, p => { pag = p; pintarManual(); });
      $('#info').textContent = $('#info').textContent.replace(/(\d+)$/, '$1 estudiantes');
    };
    $('#q').oninput = $('#fs').onchange = () => { pag = 1; pintarManual(); };
    $('#tb').onchange = e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.matches('.chk')) return;
      e.target.checked ? sel.add(+tr.dataset.id) : sel.delete(+tr.dataset.id); pintarManual();
    };
    $('#todos').onchange = e => {
      vis().slice((pag - 1) * POR, pag * POR).filter(u => !u.seccion_id).forEach(u => e.target.checked ? sel.add(u.id) : sel.delete(u.id)); pintarManual();
    };
    $('#asignar').onclick = async () => {
      if (!sel.size) return toast('Marca al menos un estudiante');
      if (!$('#dest').value) return toast('Elige la sección destino');
      try {
        const r = await api('/api/admin/asignaciones', { alumnos: [...sel], seccion_id: $('#dest').value });
        sel.clear(); await cargar(); pintarManual(); toast(`${r.cantidad} estudiante(s) asignado(s) a la sección`);
      } catch (err) { toast(err.message); }
    };


  }

  /* ---------- Docente: alta de un estudiante en una de sus secciones activas ---------- */
  if (!ADM) {
    $('#vNuevo').innerHTML = `<div class="card bloque"><h2>Nuevo estudiante</h2>
      <form class="form-modal" id="fn" style="max-width:520px">
        <div><label>NIE (8 números)</label><input id="nn" inputmode="numeric" maxlength="8" required placeholder="Ej.: 21045001"></div>
        <div><label>Nombre completo</label><input id="nm" maxlength="100" required placeholder="Nombres y apellidos"></div>
        <div><label>Sección</label><select id="ns" required></select></div>
        <p class="aviso-txt" style="text-align:left">Se crea la cuenta con el correo <b>NIE@clases.edu.sv</b> y un PIN generado, que verás al guardar. Después puedes consultarlo en Estudiantes → Ver PIN.</p>
        <div class="acciones-modal"><button class="btn">${ico('save')} Crear estudiante</button></div></form></div>`;
    const llenarSecs = () => {
      const act = S.filter(s => s.activa).sort((x, y) => y.anio - x.anio || (x.especialidad + x.seccion).localeCompare(y.especialidad + y.seccion, 'es', { numeric: true }));
      $('#ns').innerHTML = act.length ? act.map(s => `<option value="${s.id}">${esc(s.especialidad + ' ' + s.seccion + ' (' + s.anio + ')')}</option>`).join('')
        : '<option value="">No tienes secciones activas</option>';
    };
    $('#nn').oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8); };
    $('#nm').oninput = e => { e.target.value = e.target.value.replace(/[^\p{L}\s]/gu, '').replace(/^\s+/, '').replace(/\s{2,}/g, ' '); };   // el nombre solo acepta letras y espacios
    $('#nm').setAttribute('pattern', "[\\p{L}]+( [\\p{L}]+)+"); $('#nm').title = 'Nombre y apellido, solo letras';
    $('#fn').onsubmit = async e => {
      e.preventDefault();
      try {
        const r = await api('/api/docente/alumnos', { nie: $('#nn').value, nombre: $('#nm').value, seccion_id: $('#ns').value });
        modal('Estudiante creado', `<p class="aviso-txt">PIN de acceso para <b>${esc($('#nm').value)}</b> (NIE ${esc($('#nn').value)})</p><div class="pin-grande">${esc(r.pin)}</div>
          <p class="aviso-txt">Anótalo y entrégalo al estudiante. Podrás volver a verlo en Estudiantes → Ver PIN.</p>`);
        $('#nn').value = ''; $('#nm').value = ''; await cargar(); llenarSecs();
      } catch (err) { toast(err.message); }
    };
    await cargar(); llenarSecs();
  }

  if (ADM) { await cargar(); }
  llenarAnios(); pintarManual();
};
