# INFRAMEN – Sistema unificado (Administrador · Docente · Estudiante)

Un solo servidor (`server.js`) y una sola carpeta `public/`. Todos entran por `login.html` con su NIE/código y PIN de 4 números; después de entrar, cada rol ve su propio panel.

## Puesta en marcha
1. `npm install`
2. Copia `.env.example` a `.env` y completa los datos. **Usa el mismo `PIN_KEY` que ya tenías**, o los PIN guardados no se podrán descifrar.
3. En MySQL ejecuta **`inframen_completo.sql`**: es el único archivo SQL; crea todas las tablas (es seguro repetirlo). Si ya tenías la base de datos, no hace falta ejecutarlo: el servidor agrega solo lo que falte al arrancar.
4. Crea el primer administrador: `node scripts/crear-admin.js 00000001 "Nombre Apellido" 1234` (NIE/código, nombre y PIN de 4 números).
5. `npm start` y abre http://localhost:3000/login.html

## Qué ve cada rol
| Rol | Páginas |
|---|---|
| **Administrador** | Inicio (tablero), Gestión de Usuarios (pestañas: Estudiantes · Docentes · Administradores), Gestión de Secciones, **Asignación** (estudiantes a secciones, uno por uno o por CSV), **Proyectos** (proyectos, actividades y sus documentos), **Institución** (meta de horas, máximo semanal, nombre), Asistencia, Resumen de horas, Reportes, Mi Perfil |
| **Docente** | Inicio, Mis Secciones, Estudiantes, **Alta de estudiantes**, Proyectos (consulta y descarga) (perfil con historial y "Agregar registro de horas"), Registro de Horas (carga masiva), Asistencia, Resumen, Reportes, **Avisos** (publicar avisos y actividades del calendario para sus secciones), Mi Perfil |
| **Estudiante** | Inicio (avance, horas validadas / pendientes / restantes, jornadas recientes, avisos, constancia), Mis jornadas (historial con filtros y observaciones), Calendario, Avisos y Mi perfil. Solo lectura, salvo su correo, teléfono y PIN |

## Cómo funcionan las horas
- Cada carga es un registro en `registro_horas`: fecha, actividad, descripción, horas y estado (**validado** o **pendiente**).
- Solo las horas **validadas** cuentan para la meta, el anillo del estudiante y la constancia. El docente puede guardar como pendiente y validar después desde el perfil del estudiante; también puede eliminar un registro mal capturado.
- Cada registro tiene tres estados: **pendiente**, **validado** y **rechazado**. El docente valida o rechaza desde el perfil del estudiante; al rechazar debe escribir el motivo, que el estudiante ve en *Mis jornadas*. Las horas rechazadas no suman ni ocupan cupo semanal.
- Avisos y calendario: los publica **solo el docente**, siempre dirigidos a una de sus secciones (el administrador no tiene esta pantalla). El estudiante únicamente ve lo dirigido a todos o a su sección.
- La meta (150 por defecto), el máximo semanal general (2 h por defecto; `0` = sin límite) y el nombre de la institución se cambian en **Institución**.
- **Límite semanal:** se aplica siempre, también desde el perfil del estudiante. Cada estudiante usa el límite general de *Institución* (o el límite personal que ya tuviera guardado en `usuarios.limite_semanal`). La pantalla ya no permite cambiarlo por estudiante.
- **Ver PIN / Nuevo PIN:** en *Estudiantes* el docente puede ver o regenerar el PIN de los estudiantes de sus secciones.
- La **constancia** (PDF) se habilita al llegar a la meta con horas validadas (y cuenta activa con sección). El servidor también lo comprueba: `/api/alumno/constancia` responde 403 si no se cumple. Si la institución exige otra condición, se agrega en `resumenAlumno()` de `server.js`.

## Estructura
```
server.js            API única con permisos por rol
inframen_completo.sql  esquema completo de la base de datos (único archivo SQL)
lib/importar-word.js   lector de documentos Word para importar actividades
public/common.js     utilidades, barra de navegación por rol, arranque
public/admin.js      usuarios, secciones, institución, asistencia, reportes, tablero
public/logo/         logo.png (barra superior) y logo1.png (login)
public/docente.js    secciones, estudiantes, perfil, horas, resumen (+ PDFs institucionales)
public/alumno.js     Inicio, Mis jornadas, Calendario y Avisos del estudiante, y constancia
public/docente.js    (también) Avisos: publicación de avisos y eventos
scripts/             importar-alumnos.js e importar-pines.js (ejecútalos desde esta carpeta raíz:
                     node scripts/importar-alumnos.js; los CSV van dentro de scripts/)
```

## Asignación de estudiantes (administrador)
Menú **Asignación**: sirve para **dar de alta** estudiantes y ubicarlos en su sección (no para cambiarlos de sección).
- **Alta por archivo CSV:** columnas `nie`, `nombre` y `seccion` (el nombre de la sección como en Gestión de Secciones, p. ej. `Desarrollo de Software 1`; también se aceptan `especialidad` y `seccion` separadas). Coma o punto y coma, máximo 500 filas por carga.
  - NIE que **no existe** → se crea la cuenta del estudiante (correo `nie@clases.edu.sv`, PIN generado) y se asigna a la sección.
  - NIE que existe **sin sección** → solo se asigna.
  - NIE que ya está en esa sección → se omite. Si tiene **otra** sección → no se cambia (se informa).
  - Primero se ve una vista previa fila por fila; no se guarda nada hasta pulsar *Guardar en la base de datos*. Al terminar se puede descargar un CSV con los PIN de los estudiantes creados y otro con las filas con error.
- **Asignar uno por uno:** lista de estudiantes sin sección; se marcan uno o varios y se asignan a la sección elegida.
- Las secciones deben existir y estar activas. Los NIE nuevos deben tener 7 u 8 números.

## Cambios de la última versión
- **Proyectos y actividades (administrador):** menú nuevo **Proyectos**. Cada proyecto es una tarjeta con sus actividades y sus **documentos** (`.pdf`, `.doc/.docx`, `.xls/.xlsx`, `.ppt/.pptx`, `.csv`, `.txt`, `.odt/.ods/.odp`, `.png/.jpg`, `.zip`): se suben con el botón *Subir documento* o arrastrándolos a la tarjeta (máx. 10 MB por archivo y 30 por proyecto). Los docentes ven la misma pantalla en modo lectura y pueden descargarlos. *Institución* queda solo con la meta, el máximo semanal y el nombre.
  - Los archivos se guardan en `uploads/proyectos/` (cambia la carpeta con `UPLOADS_DIR`). **Si publicas en un servicio con disco temporal, usa un disco persistente o los archivos se perderán al reiniciar.** Respáldala junto con la base de datos.
- **Asistencia con permiso:** al guardar la asistencia de una sección, quien quede **Justificado** recibe automáticamente **2 horas validadas** ese día (actividad «Asistencia justificada»). Si luego se cambia el estado, esas horas se quitan; guardar dos veces no las duplica y se respeta la meta. Cambia la cantidad con `HORAS_PERMISO`.
- **El docente da de alta a sus estudiantes:** menú **Alta de estudiantes** (uno por uno o CSV). Solo puede usar sus propias secciones activas, respeta el límite de 50 por sección y obtiene el PIN generado.
- **Administrador → Usuarios:** *Ver PIN actual* ahora también funciona con docentes (no con administradores). Si un docente no tiene el PIN guardado, usa *Restablecer PIN*.
- La tabla `proyecto_archivos` y la columna `registro_horas.origen` se crean solas al arrancar (también están en `inframen_completo.sql`).

- **Importar actividades desde Word:** en *Proyectos* el botón **Importar desde Word** lee un `.docx`, muestra una vista previa (proyectos nuevos, actividades por crear, las que ya existían y las que tienen error) y al confirmar registra las actividades una por una, creando los proyectos que falten. El documento puede tener títulos «Proyecto: nombre» con una tabla de actividades, una tabla con las columnas *Proyecto* y *Actividad*, o listas con viñetas bajo cada título. La plantilla está en `public/plantilla-actividades.docx`. No necesita instalar nada: el lector está en `lib/importar-word.js`.
- **Plantilla de Word:** el botón **Descargar plantilla** de *Proyectos* baja `public/plantilla-actividades.docx` con el formato que entiende la importación.
- **Fechas:** los avisos y las actividades del calendario ya no aceptan fechas anteriores a hoy (el navegador las bloquea y el servidor también las rechaza). La zona horaria es la de El Salvador; cámbiala con `ZONA_HORARIA` en `.env`.
- **Formularios de proyecto y actividad:** ya no piden archivos al crearse; los documentos se suben desde la tarjeta del proyecto o la tabla de actividades.
