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
`ID | FOLIO | AREA | FECHA_CREACION | RECAUDACION | MARCA | AUTOBUS | CLAVE_CONDUCTOR | NOMBRE_CONDUCTOR | CREADO_POR | NOMBRE_CREADOR | CORREO_DESTINO | ESTATUS | FECHA_ENVIO | URL_DOCUMENTO`

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
