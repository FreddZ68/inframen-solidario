# INFRAMEN – Sistema unificado (Administrador · Docente · Estudiante)

Un solo servidor (`server.js`) y una sola carpeta `public/`. Todos entran por `login.html` con su NIE/código y PIN de 4 números; después de entrar, cada rol ve su propio panel.

## Puesta en marcha
1. `npm install`
2. Copia `.env.example` a `.env` y completa los datos. **Usa el mismo `PIN_KEY` que ya tenías**, o los PIN guardados no se podrán descifrar.
3. Ejecuta `schema.sql` y después `schema_alumno.sql` en MySQL (el segundo agrega el estado *rechazado* y la observación del docente a `registro_horas`, el teléfono del estudiante y las tablas `eventos` y `avisos`). `schema.sql` (crea `configuracion`, `proyectos`, `actividades`, `registro_horas` y pasa tus horas actuales al nuevo registro). La sección A agrega `activa` a `secciones` y `tarde` a `asistencias.estado`; si ya los tenías, coméntala.
3b. Ejecuta `schema_limite.sql` (agrega `usuarios.limite_semanal`, el límite semanal por estudiante).
4. Crea el primer administrador: `node scripts/crear-admin.js 00000001 "Nombre Apellido" 1234` (NIE/código, nombre y PIN de 4 números).
5. `npm start` y abre http://localhost:3000/login.html

## Qué ve cada rol
| Rol | Páginas |
|---|---|
| **Administrador** | Inicio (tablero), Gestión de Usuarios (pestañas: Estudiantes · Docentes · Administradores), Gestión de Secciones, **Asignación** (estudiantes a secciones, uno por uno o por CSV), **Institución** (meta de horas, proyectos, actividades), Asistencia, Resumen de horas, Reportes, Mi Perfil |
| **Docente** | Inicio, Mis Secciones, Estudiantes (→ perfil con historial y "Agregar registro de horas"), Registro de Horas (carga masiva), Asistencia, Resumen, Reportes, **Avisos** (publicar avisos y actividades del calendario para sus secciones), Mi Perfil |
| **Estudiante** | Inicio (avance, horas validadas / pendientes / restantes, jornadas recientes, avisos, constancia), Mis jornadas (historial con filtros y observaciones), Calendario, Avisos y Mi perfil. Solo lectura, salvo su correo, teléfono y PIN |

## Cómo funcionan las horas
- Cada carga es un registro en `registro_horas`: fecha, actividad, descripción, horas y estado (**validado** o **pendiente**).
- Solo las horas **validadas** cuentan para la meta, el anillo del estudiante y la constancia. El docente puede guardar como pendiente y validar después desde el perfil del estudiante; también puede eliminar un registro mal capturado.
- Cada registro tiene tres estados: **pendiente**, **validado** y **rechazado**. El docente valida o rechaza desde el perfil del estudiante; al rechazar debe escribir el motivo, que el estudiante ve en *Mis jornadas*. Las horas rechazadas no suman ni ocupan cupo semanal.
- Avisos y calendario: los publica **solo el docente**, siempre dirigidos a una de sus secciones (el administrador no tiene esta pantalla). El estudiante únicamente ve lo dirigido a todos o a su sección.
- La meta (150 por defecto), el máximo semanal general (2 h por defecto; `0` = sin límite) y el nombre de la institución se cambian en **Institución**.
- **Límite semanal por estudiante:** cada estudiante usa el límite general, pero el docente (o el administrador) puede ampliárselo solo a él (4, 6 h...) desde su perfil con *Cambiar límite*, y volver al general con *Usar el límite general*. Se guarda en `usuarios.limite_semanal` (`NULL` = límite general). El servidor aplica ese límite al registrar horas, y el estudiante lo ve en su Inicio.
- **Ver PIN / Nuevo PIN:** en *Estudiantes* el docente puede ver o regenerar el PIN de los estudiantes de sus secciones.
- La **constancia** (PDF) se habilita al llegar a la meta con horas validadas (y cuenta activa con sección). El servidor también lo comprueba: `/api/alumno/constancia` responde 403 si no se cumple. Si la institución exige otra condición, se agrega en `resumenAlumno()` de `server.js`.

## Estructura
```
server.js            API única con permisos por rol
schema.sql           cambios de base de datos
schema_limite.sql    límite semanal por estudiante
schema_alumno.sql    módulo del estudiante: rechazo/observación, teléfono, eventos y avisos
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
