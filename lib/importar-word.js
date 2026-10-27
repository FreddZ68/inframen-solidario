// Lee un documento Word (.docx) y saca de él los proyectos y sus actividades. Sin dependencias: un .docx es un ZIP y aquí
// solo se necesita word/document.xml, que se abre con el módulo zlib de Node.
//
// Formatos que entiende (se pueden mezclar en el mismo documento):
//  1) Títulos de proyecto + tabla:   "Proyecto 1: Cuidado del entorno"  y debajo una tabla con una columna "Actividad".
//  2) Tabla con columnas "Proyecto" y "Actividad" (cada fila trae su proyecto).
//  3) Títulos de proyecto + lista con viñetas o numerada (cada elemento de la lista es una actividad).
// Los títulos son los párrafos con estilo "Título 1/2/3" o los que empiezan con la palabra "Proyecto".
const zlib = require('zlib');

const MAX_XML = 20 * 1024 * 1024;

function leerZip(buf, nombre) {
  const e = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (e < 0 || buf.length < 22) throw new Error('El archivo no es un documento de Word (.docx) válido');
  const total = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (nom === nombre) {
      if (usize > MAX_XML) throw new Error('El documento es demasiado grande');
      const ini = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
      const datos = buf.subarray(ini, ini + csize);
      if (metodo === 0) return datos.toString('utf8');
      if (metodo === 8) return zlib.inflateRawSync(datos, { maxOutputLength: MAX_XML }).toString('utf8');
      throw new Error('El documento usa una compresión no compatible');
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error('El archivo no es un documento de Word (.docx) válido');
}

// Fin del elemento <w:tag ...> que empieza en `ini` (cuenta anidados y entiende <w:tag/>)
function cerrar(xml, tag, ini) {
  const re = new RegExp(`<w:${tag}(?=[\\s>/])|</w:${tag}>`, 'g');
  re.lastIndex = ini;
  let prof = 0, m;
  while ((m = re.exec(xml))) {
    if (m[0][1] === '/') { if (--prof === 0) return m.index + m[0].length; }
    else {
      const fin = xml.indexOf('>', m.index);
      if (xml[fin - 1] === '/') { if (prof === 0) return fin + 1; }   // elemento vacío
      else prof++;
    }
  }
  return xml.length;
}

// Elementos <w:tag> del primer nivel dentro de `xml`, en orden
function hijos(xml, tags) {
  const re = new RegExp(`<w:(${tags.join('|')})(?=[\\s>/])`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) {
    const fin = cerrar(xml, m[1], m.index);
    out.push({ tag: m[1], xml: xml.slice(m.index, fin) });
    re.lastIndex = fin;
  }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = t => t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, c) => {
  if (c[0] === '#') { const n = c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[c.toLowerCase()];
});
const textoDe = p => decodificar(
  p.replace(/<w:tab\/>|<w:br\/>/g, '<w:t> </w:t>').match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g)?.map(x => x.replace(/<[^>]+>/g, '')).join('') || '').replace(/\s+/g, ' ').trim();
const estiloDe = p => (p.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const PREFIJO = /^proyecto\s*(?:n\.?\s*[°º]?\s*)?\d*\s*[:\-–—.)]\s*(.+)$/i;
const esTitulo = estilo => /^(heading|ttulo|titulo)\d+$/i.test(estilo);

function filasDeTabla(tbl) {
  return hijos(tbl, ['tr']).map(tr => hijos(tr.xml, ['tc']).map(tc => hijos(tc.xml, ['p']).map(p => textoDe(p.xml)).filter(Boolean).join(' ')));
}

// Devuelve [{ proyecto, actividad }] en el orden del documento
function leerActividadesDocx(buf) {
  const xml = leerZip(buf, 'word/document.xml');
  const cuerpo = xml.slice(xml.indexOf('<w:body'));
  let proyecto = '';
  const salida = [];
  const agregar = (p, a) => { if (a) salida.push({ proyecto: p || '', actividad: a }); };

  for (const el of hijos(cuerpo.replace(/^<w:body[^>]*>/, ''), ['p', 'tbl'])) {
    if (el.tag === 'p') {
      const txt = textoDe(el.xml), estilo = estiloDe(el.xml);
      if (!txt) continue;
      const m = txt.match(PREFIJO);
      if (m) proyecto = m[1].trim();
      else if (esTitulo(estilo)) proyecto = txt;
      else if (/<w:numPr>/.test(el.xml) && !/^(ttulo|title|titulo)$/i.test(estilo)) agregar(proyecto, txt);   // elemento de lista
      continue;
    }
    const filas = filasDeTabla(el.xml).filter(f => f.some(Boolean));
    if (!filas.length) continue;
    const enc = filas[0].map(norm);
    const hayEnc = enc.some(h => /^(actividad|actividades|nombre|nombre de la actividad|proyecto|descripcion|horas|n|no|num|numero)$/.test(h));
    let iAct = enc.findIndex(h => /^(actividad|actividades|nombre de la actividad|nombre)$/.test(h));
    const iProy = enc.findIndex(h => h === 'proyecto');
    const datos = hayEnc ? filas.slice(1) : filas;
    if (iAct < 0) {   // sin columna "Actividad": la primera columna con texto que no sea número ni proyecto
      const ncol = Math.max(...filas.map(f => f.length));
      for (let c = 0; c < ncol && iAct < 0; c++) {
        if (c === iProy) continue;
        if (datos.some(f => f[c] && !/^[\d.\s°º#]+$/.test(f[c]))) iAct = c;
      }
    }
    if (iAct < 0) continue;
    for (const f of datos) agregar(iProy >= 0 && f[iProy] ? f[iProy] : proyecto, f[iAct]);
  }
  return salida;
}

module.exports = { leerActividadesDocx, norm };
