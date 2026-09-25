# PASES | Mobility ADO — instalación

## Archivos
- `Code.gs`: backend para Google Apps Script.
- `index.html`: frontend para GitHub Pages.

## Estructura esperada

### Archivo USUARIOS_PASES
Pestaña `USUARIOS`:
`ID_USUARIO | USUARIO | CONTRASEÑA | NOMBRE | AREA | TIPO_CUENTA | CORREO_USUARIO | CORREO_NO_ADEUDO | CORREO_ACLARACION_PRECEPTOR | CORREO_ACLARACION_ADMIN | CORREO_ACLARACION_GERENTE | ACTIVO`

Pestaña `CONDUCTORES`:
`CLAVE | NOMBRE | MARCA`

### PASES_ACLARACION
`ID | FOLIO | AREA | FECHA_CREACION | FECHA_EVENTO | MOTIVO_CONCEPTO | AUTOBUS | CLAVE_CONDUCTOR | NOMBRE_CONDUCTOR | OBSERVACIONES | CREADO_POR | NOMBRE_CREADOR | DESTINO_AUTORIZACION | CORREO_AUTORIZADOR | ESTATUS | FECHA_ENVIO_AUTORIZACION | AUTORIZADO_POR | FECHA_AUTORIZACION | COMENTARIO_AUTORIZADOR | URL_DOCUMENTO | FECHA_ENVIO_FINAL | TOKEN_AUTORIZACION`

> Si ya habías creado la estructura anterior, agrega al final `TOKEN_AUTORIZACION`.

### PASES_NO_ADEUDO
`ID | FOLIO | AREA | FECHA_CREACION | RECAUDACION | MARCA | AUTOBUS | CLAVE_CONDUCTOR | NOMBRE_CONDUCTOR | OBSERVACIONES | CREADO_POR | NOMBRE_CREADOR | CORREO_DESTINO | ESTATUS | FECHA_ENVIO | URL_DOCUMENTO`

## Paso 1 — Apps Script
1. Abre tu proyecto actual de Apps Script.
2. Sustituye el contenido de `Code.gs` por el incluido aquí.
3. Guarda.
4. Ejecuta manualmente una función que requiera permisos (por ejemplo `doGet`) y autoriza Sheets, Drive, Docs y Mail cuando Google lo solicite.
5. Ve a **Implementar > Administrar implementaciones > Editar**.
6. Selecciona **Nueva versión** y vuelve a implementar.
7. Si Google conserva la misma URL `/exec`, no cambies `index.html`. Si genera otra URL, cambia `API_URL` en `index.html`.

## Paso 2 — GitHub Pages
1. Sube `index.html` a la raíz del repositorio (puedes renombrar el repo, por ejemplo `PASES`).
2. En GitHub: **Settings > Pages**.
3. Publica desde la rama `main`, carpeta `/root`.
4. Abre la URL de GitHub Pages y prueba el login.

## Flujo implementado
- Login por usuario/contraseña.
- Área y rol desde la base de usuarios.
- Autocompletado de conductor por CLAVE.
- Si no existe, permite capturarlo y lo agrega a `CONDUCTORES`.
- No Adeudo: folio `NA-VHT/CRT-000001`, PDF y correo.
- Aclaración: folio `AC-VHT/CRT-000001`, correo de autorización con botones Autorizar/Rechazar.
- Al autorizar, genera PDF final y lo envía al correo del usuario creador.
- Consulta de pases con búsqueda, tipo y estatus.
- Administrador ve todas las áreas; otros perfiles ven su área.

## Importante antes de producción
- Cambia las contraseñas de prueba.
- Restringe el acceso de edición pública a las hojas de Drive.
- El código acepta los encabezados con guiones bajos indicados arriba.
- Los PDFs iniciales son digitales y limpios. Después se puede afinar el diseño para que replique al milímetro los formatos físicos fotografiados.


## Cambios v1.1
- No Adeudo: Recaudación ahora es selección VILLAHERMOSA/CARDENAS.
- No Adeudo: Marca ahora es selección SURO/TRT/ADO.
- No Adeudo: se agregó OBSERVACIONES.
- PDF compacto: No Adeudo 14 x 9 cm y Aclaración 15 x 12 cm, con estructura visual similar a los formatos físicos.
- El ajuste de tamaño usa Google Docs API mediante UrlFetchApp; la primera ejecución puede solicitar autorización adicional.


## Cambios v1.2
- Ambos pases se generan en formato horizontal 20 × 12 cm.
- Se utiliza prácticamente toda la hoja.
- Se agregó el logotipo Mobility ADO proporcionado para el proyecto.
- Marco exterior morado de 2 pt.
- Encabezado morado/rojo y folio destacado.
- Campos en recuadros para acercar el PDF al aspecto de un pase físico.
- El logo está incrustado dentro de `Code.gs`; no necesitas subirlo a Drive.

## Cambios v1.3
- La marca de No Adeudo ya no se selecciona manualmente cuando el conductor existe.
- Al escribir la CLAVE, se obtiene NOMBRE y MARCA desde `CONDUCTORES`.
- NOMBRE y MARCA quedan bloqueados para evitar modificar accidentalmente el catálogo.
- Si la CLAVE no existe, ambos campos se habilitan y el nuevo conductor se registra al generar el pase.
- Se cambió el motor visual del PDF para incrustar el logo dentro del propio pase y conservar marco, colores y formato horizontal.

## Cambios v1.4
- Motor PDF cambiado a Google Slides para que el logotipo PNG quede incrustado físicamente en el PDF.
- Marco corporativo morado, folio rojo, formato horizontal y campos en recuadros.
- Se eliminaron por completo las líneas/textos de firmas.
- No Adeudo muestra `GENERADO POR: Nombre del usuario`.
- Aclaración final muestra `GENERADO POR` y `AUTORIZADO POR`.
- Portal rediseñado con apariencia ejecutiva: tarjetas blancas, acentos Mobility ADO, mejor jerarquía y tablas.
- Sigue vigente la marca automática desde la pestaña CONDUCTORES.

## Cambios v1.5
- Corregido `Marca no válida`: la validación ocurría antes de consultar CONDUCTORES.
- Si la clave existe, MARCA y NOMBRE se toman directamente de CONDUCTORES, sin lista fija.
- Si la clave es nueva, la marca sí se captura manualmente y se guarda para futuras visitas.
- Portal con nuevo dashboard ejecutivo, hero corporativo, logo real, encabezado profesional y accesos rápidos.

## Hotfix v1.5.1
- Corregido el error `El tipo de forma no es válido`.
- Google Slides usa `ROUND_RECTANGLE`; la versión anterior tenía `ROUNDED_RECTANGLE`.
- No cambia la lógica de conductores, marca automática ni el diseño ejecutivo.

## v1.5.2
- Agregada opción `PRECEPTOR CRT` en Pase de Aclaración.
- Al elegirla, el backend busca en `USUARIOS` la fila cuyo `TIPO_CUENTA` sea `PRECEPTOR CRT`.
- El correo se toma primero de `CORREO_USUARIO`; como respaldo, de `CORREO_ACLARACION_PRECEPTOR`.
- `PRECEPTOR CRT` también puede autorizar pases desde el portal.

## v1.6 Executive
- Eliminado el campo Observaciones/Notas del Pase de Aclaración.
- Pase de No Adeudo conserva Observaciones.
- Rediseño integral del portal: interfaz ejecutiva, tarjetas premium, jerarquía visual,
  formularios modernos, encabezado glass, dashboard corporativo y mejor responsive.
- Se conserva PRECEPTOR CRT y toda la lógica funcional de v1.5.2.

## v1.7 – Enrutamiento de correos por perfil
La hoja USUARIOS usa `CORREO 1` y `CORREO 2` como únicas fuentes de destinatarios.
- No Adeudo: se envía a TODOS los perfiles `USUARIO` + `ADMINISTRADOR`.
- Aclaración / PRECEPTOR: a TODOS los `PRECEPTOR`.
- Aclaración / PRECEPTOR CRT: a TODOS los `PRECEPTOR CRT`.
- Aclaración / ADMINISTRADOR: a TODOS los `ADMINISTRADOR`.
- Aclaración / GERENTE: a TODOS los `GERENTE`.
- Al aprobar una aclaración: PDF final a TODOS los `USUARIO` + `ADMINISTRADOR`.
- Se eliminan correos duplicados automáticamente, incluso si el mismo correo aparece en CORREO 1 y CORREO 2.
- Se restauró Observaciones en No Adeudo; Aclaración continúa sin notas/observaciones.

## v1.8 – Datos del conductor en Aclaración
El Pase de Aclaración incluye Clave, Nombre y Marca del conductor.
La clave usa el mismo catálogo CONDUCTORES y autocompleta Nombre/Marca.
Si no existe, permite captura manual y el backend lo registra mediante ensureDriver_.
El PDF de Aclaración muestra los datos del conductor y continúa sin Observaciones/Notas.
