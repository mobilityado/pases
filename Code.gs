/**
 * PASES Mobility ADO - Backend Google Apps Script
 * v1.9 - Token único por autorizador institucional
 *
 * IMPORTANTE:
 * 1) Este proyecto usa 3 archivos de Google Sheets por ID.
 * 2) En USUARIOS_PASES debe existir una pestaña USUARIOS y una pestaña CONDUCTORES.
 * 3) Despliega como Aplicación web: Ejecutar como "Yo" y acceso según tu política.
 */

const CFG = {
  TZ: 'America/Mexico_City',
  APP_NAME: 'PASES | Mobility ADO',
  FRONTEND_URL: '', // Opcional: URL final de GitHub Pages.
  SS_USUARIOS: '1CJmmhWbEJFKnJDAEEWE2ZAGAT1DwPVtgxWMRQsf8vwI',
  SS_ACLARACION: '1aBcopfMs5w65AxHe5g7T7-sDqJMqYbhzZ5Ry_Fuotkw',
  SS_NO_ADEUDO: '145ksso0BfXh5bTEiHvO7ez5gsQvs0cWWjwtLhOV8DAI',
  SH_USUARIOS: 'USUARIOS',
  SH_CONDUCTORES: 'CONDUCTORES',
  SH_ACLARACION: '', // vacío = primera pestaña
  SH_NO_ADEUDO: '',  // vacío = primera pestaña
  SESSION_MINUTES: 480
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  // IMPORTANTE: el GET del enlace de correo NUNCA debe ejecutar la decisión.
  // Algunos sistemas de correo/antivirus abren o inspeccionan automáticamente los enlaces.
  // Por eso el GET solo muestra una pantalla de confirmación y la decisión real se procesa por POST.
  if (p.action === 'decision') return decisionConfirmPage_(p);

  // API por GET (principalmente pruebas/health).
  if (p.action === 'health') return json_({ok:true, app:CFG.APP_NAME, time:new Date()});
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;padding:30px"><h2>PASES | Mobility ADO</h2>' +
    '<p>Backend activo.</p><p>La interfaz principal se publica en GitHub Pages.</p></div>'
  ).setTitle(CFG.APP_NAME);
}

function doPost(e) {
  try {
    let body = {};
    const raw = (e && e.postData && e.postData.contents) || '';
    if (raw) {
      try { body = JSON.parse(raw); } catch (_) { body = (e && e.parameter) || {}; }
    } else {
      body = (e && e.parameter) || {};
    }
    const action = String(body.action || '');
    let result;

    switch (action) {
      case 'decision':
        result = decisionPost_(body);
        let msg='La decisión quedó registrada correctamente.';
        if (result && result.yaProcesado) {
          const fecha=result.fecha ? ' el '+esc_(formatDateTime_(result.fecha)) : '';
          msg='<p><b>Este pase ya había sido procesado anteriormente.</b></p>' +
              '<p><b>Resultado:</b> '+esc_(result.estatus)+'</p>' +
              '<p><b>Procesado por:</b> '+esc_(result.autorizadoPor || 'AUTORIZADOR')+'</p>' +
              (result.correo ? '<p><b>Correo:</b> '+esc_(result.correo)+'</p>' : '') +
              '<p><b>Fecha:</b>'+fecha+'</p>' +
              '<p>No es necesario realizar ninguna otra acción.</p>';
        }
        return HtmlService.createHtmlOutput('<div style="font-family:Arial;max-width:650px;margin:40px auto;text-align:center;padding:50px"><h2>'+esc_(result.folio)+'</h2><h1>'+esc_(result.estatus)+'</h1>'+msg+'</div>').setTitle('Pases Mobility ADO').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      case 'login': result = login_(body); break;
      case 'loginUsers': result = loginUsers_(); break;
      case 'logout': result = logout_(body); break;
      case 'findDriver': result = findDriver_(body); break;
      case 'adminAddDriver': result = adminAddDriver_(body); break;
      case 'adminListDrivers': result = adminListDrivers_(body); break;
      case 'adminStats': result = adminStats_(body); break;
      case 'adminListUsers': result = adminListUsers_(body); break;
      case 'adminAddUser': result = adminAddUser_(body); break;
      case 'adminDeleteUser': result = adminDeleteUser_(body); break;
      case 'saveNoAdeudo': result = saveNoAdeudo_(body); break;
      case 'saveAclaracion': result = saveAclaracion_(body); break;
      case 'listPasses': result = listPasses_(body); break;
      case 'getPass': result = getPass_(body); break;
      default: throw new Error('Acción no válida.');
    }
    return json_({ok:true, data:result});
  } catch (err) {
    console.error(err);
    return json_({ok:false, error:String(err.message || err)});
  }
}

/* ========================= SESIÓN / USUARIOS ========================= */

function loginUsers_() {
  // Para el selector de acceso se muestra NOMBRE, pero el value sigue siendo USUARIO.
  const rows = objects_(sheet_(CFG.SS_USUARIOS, CFG.SH_USUARIOS));
  const out = [];

  rows.forEach(r => {
    const activo = String(val_(r, 'ACTIVO') || 'SI').trim().toUpperCase();
    // Si explícitamente dice NO, se omite.
    if (activo === 'NO') return;

    const usuario = String(val_(r, 'USUARIO') || '').trim();
    const nombre = String(val_(r, 'NOMBRE') || usuario).trim();

    if (usuario) {
      // Se permite listar todas las filas de forma independiente (incluyendo cajeros y puestos repetidos)
      out.push({ usuario: usuario, nombre: nombre });
    }
  });

  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' }));
}

function login_(b) {
  const user = String(b.usuario || '').trim().toUpperCase();
  const pass = String(b.contrasena || '').trim();
  if (!user || !pass) throw new Error('Captura usuario y contraseña.');

  const rows = objects_(sheet_(CFG.SS_USUARIOS, CFG.SH_USUARIOS));
  const found = rows.find(r =>
    val_(r,'USUARIO').toUpperCase() === user &&
    val_(r,'CONTRASEÑA','CONTRASENA') === pass &&
    val_(r,'ACTIVO').toUpperCase() !== 'NO'
  );
  if (!found) throw new Error('Usuario o contraseña incorrectos.');

  const token = Utilities.getUuid() + Utilities.getUuid();
  const profile = {
    id: val_(found,'ID_USUARIO') || user,
    usuario: val_(found,'USUARIO'),
    nombre: val_(found,'NOMBRE') || val_(found,'USUARIO'),
    area: val_(found,'AREA'),
    tipo: val_(found,'TIPO_CUENTA','TIPO DE CUENTA'),
    correo: val_(found,'CORREO_1','CORREO 1','CORREO_2','CORREO 2')
  };
  CacheService.getScriptCache().put('S_'+token, JSON.stringify(profile), CFG.SESSION_MINUTES*60);
  return {token, profile};
}

function logout_(b) {
  if (b.token) CacheService.getScriptCache().remove('S_'+b.token);
  return true;
}

function session_(token) {
  if (!token) throw new Error('Sesión no válida.');
  const raw = CacheService.getScriptCache().get('S_'+token);
  if (!raw) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
  CacheService.getScriptCache().put('S_'+token, raw, CFG.SESSION_MINUTES*60);
  return JSON.parse(raw);
}

function emailsByProfiles_(profiles) {
  const wanted=(profiles||[]).map(x=>norm_(x));
  const rows=objects_(sheet_(CFG.SS_USUARIOS,CFG.SH_USUARIOS));
  const emails=[];
  rows.forEach(r=>{
    const tipo=norm_(val_(r,'TIPO_CUENTA','TIPO DE CUENTA'));
    if (!wanted.includes(tipo)) return;
    if (val_(r,'ACTIVO').toUpperCase()==='NO') return;
    [val_(r,'CORREO_1','CORREO 1'),val_(r,'CORREO_2','CORREO 2')].forEach(mail=>{
      String(mail||'').split(/[;,]/).forEach(x=>{
        x=x.trim();
        if(x && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) && !emails.some(e=>e.toLowerCase()===x.toLowerCase())) emails.push(x);
      });
    });
  });
  return emails;
}

function requireEmailsByProfiles_(profiles,label) {
  const emails=emailsByProfiles_(profiles);
  if(!emails.length) throw new Error('No hay correos configurados en CORREO 1 / CORREO 2 para '+label+'.');
  return emails;
}

// Devuelve los datos del autorizador a partir del correo institucional
// al que se envió la autorización. El enlace de correo lleva este correo
// como parámetro para que podamos identificar quién tomó la decisión.
function autorizadorPorCorreo_(correo, destino) {
  const email=String(correo||'').trim().toLowerCase();
  if(!email) return null;
  const rows=objects_(sheet_(CFG.SS_USUARIOS,CFG.SH_USUARIOS));
  const wanted=norm_(destino||'');
  for (const r of rows) {
    if (val_(r,'ACTIVO').toUpperCase()==='NO') continue;
    if (wanted && norm_(val_(r,'TIPO_CUENTA','TIPO DE CUENTA'))!==wanted) continue;
    const correos=[val_(r,'CORREO_1','CORREO 1'),val_(r,'CORREO_2','CORREO 2')]
      .flatMap(x=>String(x||'').split(/[;,]/))
      .map(x=>x.trim().toLowerCase())
      .filter(Boolean);
    if (correos.includes(email)) {
      return {
        correo: email,
        nombre: val_(r,'NOMBRE') || val_(r,'USUARIO') || email,
        usuario: val_(r,'USUARIO') || '',
        tipo: val_(r,'TIPO_CUENTA','TIPO DE CUENTA') || destino || ''
      };
    }
  }
  return null;
}

function userRow_(usuario) {
  return objects_(sheet_(CFG.SS_USUARIOS, CFG.SH_USUARIOS))
    .find(r => val_(r,'USUARIO').toUpperCase() === String(usuario||'').toUpperCase());
}

/* ========================= CONDUCTORES ========================= */

function findDriver_(b) {
  session_(b.token);
  const clave = String(b.clave || '').trim();
  if (!clave) return {found:false};
  const rows = objects_(sheet_(CFG.SS_USUARIOS, CFG.SH_CONDUCTORES));
  const r = rows.find(x => val_(x,'CLAVE') === clave);
  return r ? {
    found:true,
    clave:val_(r,'CLAVE'),
    nombre:val_(r,'NOMBRE'),
    marca:val_(r,'MARCA')
  } : {found:false, clave};
}

function ensureDriver_(clave,nombre,marca) {
  clave=String(clave||'').trim();
  nombre=String(nombre||'').trim().toUpperCase();
  marca=String(marca||'').trim().toUpperCase();
  if (!clave || !nombre) return;
  const sh=sheet_(CFG.SS_USUARIOS, CFG.SH_CONDUCTORES);
  const rows=objects_(sh);
  if (!rows.some(r=>val_(r,'CLAVE')===clave)) {
    appendObject_(sh,{CLAVE:clave,NOMBRE:nombre,MARCA:marca});
  }
}

function requireAdmin_(s) {
  if (norm_(s.tipo)!=='ADMINISTRADOR') throw new Error('Módulo exclusivo para Administradores.');
}

function adminAddDriver_(b) {
  const s=session_(b.token); requireAdmin_(s);
  const d=b.data||{};
  const clave=String(d.clave||'').trim();
  const nombre=String(d.nombre||'').trim().toUpperCase();
  const marca=String(d.marca||'').trim().toUpperCase();
  if(!clave || !nombre || !marca) throw new Error('Captura clave, nombre y marca.');
  const sh=sheet_(CFG.SS_USUARIOS,CFG.SH_CONDUCTORES);
  const rows=objects_(sh);
  if(rows.some(r=>val_(r,'CLAVE')===clave)) throw new Error('La clave '+clave+' ya existe en CONDUCTORES.');
  appendObject_(sh,{CLAVE:clave,NOMBRE:nombre,MARCA:marca});
  return {ok:true,clave:clave,nombre:nombre,marca:marca};
}

function adminListDrivers_(b) {
  const s=session_(b.token); requireAdmin_(s);
  const q=norm_(b.q||'');
  let rows=objects_(sheet_(CFG.SS_USUARIOS,CFG.SH_CONDUCTORES)).map(r=>({
    clave:val_(r,'CLAVE'),nombre:val_(r,'NOMBRE'),marca:val_(r,'MARCA')
  }));
  if(q) rows=rows.filter(r=>norm_(r.clave+' '+r.nombre+' '+r.marca).includes(q));
  rows.sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));
  return rows.slice(0,1000);
}

function adminListUsers_(b) {
  const s=session_(b.token); requireAdmin_(s);
  const q=norm_(b.q||'');
  let rows=objects_(sheet_(CFG.SS_USUARIOS,CFG.SH_USUARIOS)).map(r=>({
    id:val_(r,'ID_USUARIO'),
    usuario:val_(r,'USUARIO'),
    nombre:val_(r,'NOMBRE'),
    area:val_(r,'AREA'),
    tipo:val_(r,'TIPO_CUENTA','TIPO DE CUENTA'),
    correo1:val_(r,'CORREO_1','CORREO 1'),
    correo2:val_(r,'CORREO_2','CORREO 2'),
    activo:val_(r,'ACTIVO')||'SI'
  }));
  if(q) rows=rows.filter(r=>norm_([r.usuario,r.nombre,r.area,r.tipo,r.correo1,r.correo2].join(' ')).includes(q));
  rows.sort((a,b)=>String(a.nombre||a.usuario).localeCompare(String(b.nombre||b.usuario),'es'));
  return rows;
}

function adminAddUser_(b) {
  const s=session_(b.token); requireAdmin_(s);
  const d=b.data||{};
  const usuario=String(d.usuario||'').trim().toUpperCase();
  const contrasena=String(d.contrasena||'').trim();
  const nombre=String(d.nombre||'').trim().toUpperCase();
  const perfil=norm_(d.perfil||'');
  const correo1=String(d.correo1||'').trim();
  const correo2=String(d.correo2||'').trim();
  const activo=norm_(d.activo||'SI')==='NO'?'NO':'SI';

  if(!usuario || !contrasena || !nombre || !perfil) throw new Error('Captura usuario, contraseña, nombre y tipo de cuenta.');
  const permitidos=['ADMINISTRADOR','VILLAHERMOSA','CARDENAS','PRECEPTOR','PRECEPTOR_CRT','TRAFICO_VHT','TRAFICO_CRT'];
  if(!permitidos.includes(perfil)) throw new Error('Tipo de cuenta no válido.');

  let tipo='', area='';
  if(perfil==='ADMINISTRADOR'){tipo='ADMINISTRADOR';area='ADMINISTRADOR';}
  else if(perfil==='VILLAHERMOSA'){tipo='USUARIO';area='VILLAHERMOSA';}
  else if(perfil==='CARDENAS'){tipo='USUARIO';area='CARDENAS';}
  else if(perfil==='PRECEPTOR'){tipo='PRECEPTOR';area='VILLAHERMOSA';}
  else if(perfil==='PRECEPTOR_CRT'){tipo='PRECEPTOR CRT';area='CARDENAS';}
  else if(perfil==='TRAFICO_VHT'){tipo='TRAFICO VHT';area='VILLAHERMOSA';}
  else if(perfil==='TRAFICO_CRT'){tipo='TRAFICO CRT';area='CARDENAS';}

  const sh=sheet_(CFG.SS_USUARIOS,CFG.SH_USUARIOS);
  const rows=objects_(sh);
  if(rows.some(r=>norm_(val_(r,'USUARIO'))===norm_(usuario))) throw new Error('El usuario '+usuario+' ya existe.');
  if(rows.some(r=>norm_(val_(r,'ID_USUARIO'))===norm_(usuario))) throw new Error('El ID '+usuario+' ya existe.');

  appendObject_(sh,{
    ID_USUARIO:usuario,
    USUARIO:usuario,
    'CONTRASEÑA':contrasena,
    NOMBRE:nombre,
    AREA:area,
    TIPO_CUENTA:tipo,
    CORREO_1:correo1,
    CORREO_2:correo2,
    ACTIVO:activo
  });
  return {ok:true,usuario:usuario,nombre:nombre,area:area,tipo:tipo};
}

function adminDeleteUser_(b) {
  const s=session_(b.token); requireAdmin_(s);
  const usuario=String(b.usuario||'').trim();
  if(!usuario) throw new Error('Usuario no válido.');
  if(norm_(usuario)===norm_(s.usuario)) throw new Error('No puedes eliminar la cuenta con la que tienes la sesión abierta.');

  const sh=sheet_(CFG.SS_USUARIOS,CFG.SH_USUARIOS);
  const rows=objects_(sh);
  const target=rows.find(r=>norm_(val_(r,'USUARIO'))===norm_(usuario));
  if(!target) throw new Error('No se encontró el usuario.');

  if(norm_(val_(target,'TIPO_CUENTA','TIPO DE CUENTA'))==='ADMINISTRADOR'){
    const admins=rows.filter(r=>norm_(val_(r,'TIPO_CUENTA','TIPO DE CUENTA'))==='ADMINISTRADOR' && norm_(val_(r,'ACTIVO'))!=='NO');
    if(admins.length<=1) throw new Error('No se puede eliminar el último administrador activo.');
  }
  sh.deleteRow(target.__row);
  return {ok:true,usuario:usuario};
}

function adminStats_(b) {
  const s=session_(b.token); requireAdmin_(s);
  const gran=String(b.granularity||'MONTH').toUpperCase();
  if(!['WEEK','MONTH','YEAR'].includes(gran)) throw new Error('Periodo no válido.');

  const desde=String(b.desde||'').trim();
   const hasta=String(b.hasta||'').trim();
   let dDesde=null,dHasta=null;
   if(desde){
     dDesde=new Date(desde+'T00:00:00');
     if(isNaN(dDesde.getTime())) throw new Error('Fecha Desde no válida.');
   }
   if(hasta){
     dHasta=new Date(hasta+'T23:59:59.999');
     if(isNaN(dHasta.getTime())) throw new Error('Fecha Hasta no válida.');
   }
   if(dDesde && dHasta && dDesde>dHasta) throw new Error('La fecha Desde no puede ser mayor que la fecha Hasta.');

   let all=[];
  objects_(sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION)).forEach(r=>all.push({
    tipo:'ACLARACION', fecha:val_(r,'FECHA_CREACION'), usuario:val_(r,'NOMBRE_CREADOR','CREADO_POR')||'SIN USUARIO'
  }));
  objects_(sheet_(CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO)).forEach(r=>all.push({
    tipo:'NO_ADEUDO', fecha:val_(r,'FECHA_CREACION'), usuario:val_(r,'NOMBRE_CREADOR','CREADO_POR')||'SIN USUARIO'
  }));

  const items={};
  all.forEach(x=>{
    const d=parseDate_(x.fecha); if(!d || isNaN(d.getTime())) return;
    if(dDesde && d<dDesde) return;
    if(dHasta && d>dHasta) return;
    const p=periodKey_(d,gran);
    const key=p.key+'|'+x.usuario;
    if(!items[key]) items[key]={period:p.key,label:p.label,sort:p.sort,usuario:x.usuario,total:0,noAdeudo:0,aclaracion:0};
    items[key].total++;
    if(x.tipo==='NO_ADEUDO') items[key].noAdeudo++; else items[key].aclaracion++;
  });
  let rows=Object.keys(items).map(k=>items[k]);
  rows.sort((a,b)=>a.sort-b.sort || String(a.usuario).localeCompare(String(b.usuario),'es'));

  const periods={};
  rows.forEach(r=>{
    if(!periods[r.period]) periods[r.period]={period:r.period,label:r.label,sort:r.sort,total:0,noAdeudo:0,aclaracion:0};
    periods[r.period].total+=r.total; periods[r.period].noAdeudo+=r.noAdeudo; periods[r.period].aclaracion+=r.aclaracion;
  });
  let summary=Object.keys(periods).map(k=>periods[k]).sort((a,b)=>a.sort-b.sort);
  const limit=gran==='WEEK'?12:(gran==='MONTH'?12:5);
  summary=summary.slice(-limit);
  const keep={}; summary.forEach(x=>keep[x.period]=true);
  rows=rows.filter(x=>keep[x.period]);

  const byUser={};
  rows.forEach(r=>{
    if(!byUser[r.usuario]) byUser[r.usuario]={usuario:r.usuario,total:0,noAdeudo:0,aclaracion:0};
    byUser[r.usuario].total+=r.total; byUser[r.usuario].noAdeudo+=r.noAdeudo; byUser[r.usuario].aclaracion+=r.aclaracion;
  });
  const users=Object.keys(byUser).map(k=>byUser[k]).sort((a,b)=>b.total-a.total);
  return {granularity:gran,summary:summary,rows:rows,users:users,
    totals:{total:summary.reduce((a,x)=>a+x.total,0),noAdeudo:summary.reduce((a,x)=>a+x.noAdeudo,0),aclaracion:summary.reduce((a,x)=>a+x.aclaracion,0)}};
}

function parseDate_(v) {
  if(v instanceof Date) return v;
  if(!v) return null;
  let d=new Date(v);
  if(!isNaN(d.getTime())) return d;
  const m=String(v).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  return m?new Date(Number(m[3]),Number(m[2])-1,Number(m[1])):null;
}
function periodKey_(d,gran) {
  const y=d.getFullYear(), m=d.getMonth();
  if(gran==='YEAR') return {key:String(y),label:String(y),sort:y};
  if(gran==='MONTH') {
    const names=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    return {key:y+'-'+String(m+1).padStart(2,'0'),label:names[m]+' '+y,sort:y*100+m};
  }
  const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day);
  const first=new Date(x.getFullYear(),0,1);
  const week=Math.ceil((((x-first)/86400000)+first.getDay()+1)/7);
  return {key:x.getFullYear()+'-W'+String(week).padStart(2,'0'),label:'SEM '+week+' · '+x.getFullYear(),sort:x.getFullYear()*100+week};
}

/* ========================= NO ADEUDO ========================= */

function saveNoAdeudo_(b) {
  const s=session_(b.token);
  requireUserCreator_(s);
  const d=b.data||{};
  required_(d,['recaudacion','autobus','claveConductor','nombreConductor']);
  if (!['VILLAHERMOSA','CARDENAS','CÁRDENAS'].includes(String(d.recaudacion||'').trim().toUpperCase())) throw new Error('Recaudación no válida.');

  const driverInfo=findDriver_({token:b.token,clave:d.claveConductor});
  if (driverInfo.found) {
    d.nombreConductor=driverInfo.nombre;
    d.marca=driverInfo.marca;
    if (!String(d.marca||'').trim()) throw new Error('El conductor existe, pero no tiene MARCA registrada en CONDUCTORES.');
  } else {
    if (!String(d.marca||'').trim()) throw new Error('Captura la marca del conductor nuevo.');
    ensureDriver_(d.claveConductor,d.nombreConductor,d.marca);
  }

  const folio=nextFolio_('NA',s.area,CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO);
  const now=new Date();
  const recaudacionNA=norm_(d.recaudacion||'');
  const perfilTrafico=(recaudacionNA==='CARDENAS'||recaudacionNA==='CÁRDENAS')?'TRAFICO CRT':'TRAFICO VHT';
  
  const correosDestino=requireEmailsByProfiles_(
    ['USUARIO','ADMINISTRADOR',perfilTrafico],
    'USUARIO, ADMINISTRADOR y '+perfilTrafico
  );
  const correoDestino=correosDestino.join(',');

  const obj={
    ID:Utilities.getUuid(), FOLIO:folio, AREA:s.area, FECHA_CREACION:now,
    RECAUDACION:d.recaudacion, MARCA:d.marca, AUTOBUS:d.autobus,
    CLAVE_CONDUCTOR:d.claveConductor, NOMBRE_CONDUCTOR:d.nombreConductor,
    OBSERVACIONES:d.observaciones||'', CREADO_POR:s.usuario, NOMBRE_CREADOR:s.nombre, CORREO_DESTINO:correoDestino,
    ESTATUS:'GENERADO', FECHA_ENVIO:'', URL_DOCUMENTO:''
  };
  const sh=sheet_(CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO);
  appendObject_(sh,obj);

  const pdf=createPdf_('NO ADEUDO',obj);
  sendMail_(correoDestino,'Pase de No Adeudo '+folio,
    'Se adjunta el Pase de No Adeudo '+folio+'.',pdf);

  updateByFolio_(sh,folio,{ESTATUS:'ENVIADO',FECHA_ENVIO:new Date()});
  return {folio, estatus:'ENVIADO'};
}

/* ========================= ACLARACIÓN ========================= */

function saveAclaracion_(b) {
  const s=session_(b.token);
  requireUserCreator_(s);
  const d=b.data||{};
  required_(d,['fechaEvento','motivoConcepto','autobus','claveConductor','nombreConductor','destinoAutorizacion']);

  ensureDriver_(d.claveConductor,d.nombreConductor,d.marca||'');

  const folio=nextFolio_('AC',s.area,CFG.SS_ACLARACION,CFG.SH_ACLARACION);
  const now=new Date();
  const u=userRow_(s.usuario)||{};
  const destino=String(d.destinoAutorizacion).toUpperCase();
  const perfilesValidos=['PRECEPTOR','PRECEPTOR CRT','ADMINISTRADOR','GERENTE'];
  if(!perfilesValidos.includes(destino)) throw new Error('Destino de autorización no válido.');
  const correosAut=requireEmailsByProfiles_([destino],destino);
  const correoAut=correosAut.join(',');

  const tokenAut=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  const obj={
    ID:Utilities.getUuid(), FOLIO:folio, AREA:s.area, FECHA_CREACION:now,
    FECHA_EVENTO:d.fechaEvento, MOTIVO_CONCEPTO:d.motivoConcepto, AUTOBUS:d.autobus,
    CLAVE_CONDUCTOR:d.claveConductor, NOMBRE_CONDUCTOR:d.nombreConductor, MARCA:d.marca||'',
    OBSERVACIONES:'', CREADO_POR:s.usuario, NOMBRE_CREADOR:s.nombre,
    DESTINO_AUTORIZACION:destino, CORREO_AUTORIZADOR:correoAut, CORREO_AUTORIZADOR_REAL:'', ESTATUS:'PENDIENTE',
    FECHA_ENVIO_AUTORIZACION:now, AUTORIZADO_POR:'', FECHA_AUTORIZACION:'',
    COMENTARIO_AUTORIZADOR:'', URL_DOCUMENTO:'', FECHA_ENVIO_FINAL:'',
    TOKEN_AUTORIZACION:tokenAut, TOKENS_AUTORIZACION:''
  };
  const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
  ensureHeaders_(sh,['CLAVE_CONDUCTOR','NOMBRE_CONDUCTOR','MARCA','CORREO_AUTORIZADOR_REAL','TOKENS_AUTORIZACION']);
  appendObject_(sh,obj);

  if (destino==='ADMINISTRADOR') {
    const autorizador='ADMINISTRADOR (AUTOMÁTICO)';
    const fechaAutorizacion=new Date();

    updateByFolio_(sh,folio,{
      ESTATUS:'AUTORIZADO',
      AUTORIZADO_POR:autorizador,
      FECHA_AUTORIZACION:fechaAutorizacion,
      COMENTARIO_AUTORIZADOR:'Autorización automática por destino ADMINISTRADOR.'
    });
    SpreadsheetApp.flush();

    const fresh=objects_(sh).find(x=>val_(x,'FOLIO')===folio);
    if (!fresh) throw new Error('No se pudo recuperar el pase autorizado '+folio+'.');
    fresh.ESTATUS='AUTORIZADO';
    fresh.AUTORIZADO_POR=autorizador;
    fresh.FECHA_AUTORIZACION=fechaAutorizacion;

    const pdf=createPdf_('ACLARACION',fresh);
    const correosFinales=requireEmailsByProfiles_(['USUARIO','ADMINISTRADOR'],'USUARIO y ADMINISTRADOR');
    const destinoFinal=correosFinales.join(',');

    sendMail_(destinoFinal,'Pase de Aclaración AUTORIZADO '+folio,
      'El pase '+folio+' fue autorizado automáticamente por estar dirigido a ADMINISTRADOR. Se adjunta el documento final.',pdf);

    // El pase de Aclaración conserva su estatus de AUTORIZADO.
    // ENVIADO se reserva para los pases de No Adeudo.
    updateByFolio_(sh,folio,{FECHA_ENVIO_FINAL:new Date()});
    return {folio, estatus:'AUTORIZADO', enviadoA:'USUARIO y ADMINISTRADOR'};
  }

  const url=ScriptApp.getService().getUrl();
  const destinatarios=correoAut.split(',').map(x=>x.trim()).filter(Boolean);
  // Cada destinatario recibe un TOKEN ÚNICO. Así, cuando uno de los dos
  // PRECEPTOR CRT autoriza, el sistema sabe exactamente cuál de sus correos
  // recibió y utilizó el enlace, sin depender de una cuenta Google.
  const tokensPorCorreo={};
  destinatarios.forEach(correo=>{
    const info=autorizadorPorCorreo_(correo,destino);
    if(!info) return;
    const tokenDest=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
    tokensPorCorreo[info.correo]=tokenDest;
    const yes=url+'?action=decision&token='+encodeURIComponent(tokenDest)+'&decision=AUTORIZADO';
    const no=url+'?action=decision&token='+encodeURIComponent(tokenDest)+'&decision=RECHAZADO';
    const html='<div style="font-family:Arial;max-width:650px">'+
      '<h2>Pase de Aclaración pendiente</h2><p><b>Folio:</b> '+esc_(folio)+'</p>'+
      '<p><b>Área:</b> '+esc_(s.area)+' &nbsp; <b>Autobús:</b> '+esc_(d.autobus)+'</p>'+
      '<p><b>Conductor:</b> '+esc_(d.claveConductor+' - '+d.nombreConductor)+'</p>'+'<p><b>Marca:</b> '+esc_(d.marca||'')+'</p>'+
      '<p><b>Motivo:</b> '+esc_(d.motivoConcepto)+'</p>'+
      '<p><b>Autorización dirigida a:</b> '+esc_(info.nombre)+' ('+esc_(info.correo)+')</p>'+
      '<p><a href="'+yes+'" style="background:#18864b;color:white;padding:12px 18px;text-decoration:none;border-radius:7px">AUTORIZAR</a> '+
      '<a href="'+no+'" style="background:#b42318;color:white;padding:12px 18px;text-decoration:none;border-radius:7px">RECHAZAR</a></p></div>';
    sendMail_(correo,'Autorización Pase de Aclaración '+folio,
      'Pase '+folio+' pendiente de autorización para '+info.nombre+' ('+info.correo+').',null,html);
  });
  // Guardamos la relación token -> correo en la hoja. Es la fuente de verdad
  // para identificar al autorizador sin confiar en parámetros editables del URL.
  updateByFolio_(sh,folio,{TOKENS_AUTORIZACION:JSON.stringify(tokensPorCorreo)});
  return {folio, estatus:'PENDIENTE', enviadoA:destino};
}

function decisionConfirmPage_(p) {
  try {
    const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
    const token=String(p.token||'');
    const found=findAuthorizationByToken_(sh,token);
    if (!found) throw new Error('Enlace de autorización inválido o expirado.');
    const rr=found.row;
    const info=autorizadorPorCorreo_(found.email, val_(rr,'DESTINO_AUTORIZACION'));
    if (!info || String(info.correo).toLowerCase()!==String(found.email).toLowerCase())
      throw new Error('No se pudo identificar al autorizador institucional.');
    const folio=val_(rr,'FOLIO');
    const decision=String(p.decision||'').toUpperCase();
    if (!['AUTORIZADO','RECHAZADO'].includes(decision)) throw new Error('Decisión no válida.');
    const titulo=decision==='AUTORIZADO'?'Confirmar autorización':'Confirmar rechazo';
    const color=decision==='AUTORIZADO'?'#18864b':'#b42318';
    const accion=ScriptApp.getService().getUrl();
    const html='<div style="font-family:Arial;max-width:650px;margin:40px auto;padding:30px;border:1px solid #ddd;border-radius:12px">'+
      '<h2>'+esc_(titulo)+'</h2>'+
      '<p><b>Folio:</b> '+esc_(folio)+'</p>'+
      '<p><b>Autorizador:</b> '+esc_(info.nombre)+'</p>'+
      '<p><b>Correo:</b> '+esc_(info.correo)+'</p>'+
      '<p>Esta pantalla es de confirmación. La decisión no se registra hasta que pulses el botón.</p>'+
      '<form method="post" action="'+esc_(accion)+'" target="_top" style="margin-top:25px">'+
      '<input type="hidden" name="action" value="decision">'+
      '<input type="hidden" name="token" value="'+esc_(p.token)+'">'+
      '<input type="hidden" name="decision" value="'+esc_(decision)+'">'+
      '<input type="hidden" name="email" value="'+esc_(info.correo)+'">'+
      '<button type="submit" style="background:'+color+';color:#fff;border:0;padding:14px 22px;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer">'+esc_(decision==='AUTORIZADO'?'CONFIRMAR AUTORIZACIÓN':'CONFIRMAR RECHAZO')+'</button>'+
      '</form></div>';
    return HtmlService.createHtmlOutput(html).setTitle('Pases Mobility ADO').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch(err) {
    return HtmlService.createHtmlOutput('<div style="font-family:Arial;padding:50px"><h2>No fue posible abrir la autorización</h2><p>'+esc_(err.message)+'</p></div>');
  }
}

function decisionPost_(p) {
  const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
  const found=findAuthorizationByToken_(sh,String(p.token||''));
  if (!found) throw new Error('Enlace de autorización inválido o expirado.');
  const rr=found.row;
  const info=autorizadorPorCorreo_(found.email, val_(rr,'DESTINO_AUTORIZACION'));
  if (!info || String(info.correo).toLowerCase()!==String(found.email).toLowerCase())
    throw new Error('No se pudo identificar al autorizador institucional.');
  const actor=info.nombre;
  const actorEmail=info.correo;
  return processDecision_(p.token,p.decision,p.comentario||'',actor,actorEmail);
}

// Busca el token único de un destinatario y devuelve también el correo al que
// pertenece. Compatible con pases antiguos que solo tengan TOKEN_AUTORIZACION.
function findAuthorizationByToken_(sh,token) {
  const t=String(token||'');
  if (!t) return null;
  const rows=objects_(sh);
  for (const row of rows) {
    const raw=val_(row,'TOKENS_AUTORIZACION');
    if (raw) {
      try {
        const map=JSON.parse(raw);
        for (const email in map) {
          if (String(map[email])===t) return {row:row,email:email};
        }
      } catch (_) {}
    }
    if (String(val_(row,'TOKEN_AUTORIZACION'))===t) {
      const email=String(val_(row,'CORREO_AUTORIZADOR')||'').split(',')[0].trim();
      if (email) return {row:row,email:email};
    }
  }
  return null;
}

function decisionApi_(b) {
  const s=session_(b.token);
  const tipo=String(s.tipo||'').toUpperCase();
  if (!['ADMINISTRADOR','PRECEPTOR','PRECEPTOR CRT','GERENTE'].includes(tipo))
    throw new Error('Tu perfil no puede autorizar pases.');
  const row=userRow_(s.usuario)||{};
  const actor=val_(row,'NOMBRE') || s.nombre || s.usuario;
  const actorEmail=String(val_(row,'CORREO_1','CORREO 1') || val_(row,'CORREO_2','CORREO 2') || s.correo || '').trim();
  return processDecision_(b.tokenAut,b.decision,b.comentario||'',actor,actorEmail);
}

function processDecision_(tokenAut,decision,comentario,actor,actorEmail) {
  const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
  // El enlace nuevo usa un token distinto por cada autorizador y se guarda
  // dentro de TOKENS_AUTORIZACION como {correo: token}. Por eso NO debemos
  // buscarlo únicamente en TOKEN_AUTORIZACION (que es el token general/antiguo).
  // Primero resolvemos cualquier token válido mediante la fuente de verdad.
  const found=findAuthorizationByToken_(sh,String(tokenAut||''));
  if (!found) throw new Error('Enlace de autorización inválido.');

  const folio=val_(found.row,'FOLIO');
  decision=String(decision||'').toUpperCase();
  if (!['AUTORIZADO','RECHAZADO'].includes(decision)) throw new Error('Decisión no válida.');

  // BLOQUEO DE CONCURRENCIA: si dos autorizadores confirman casi al mismo
  // tiempo, solo el primero puede cambiar el pase desde PENDIENTE. El segundo
  // encontrará el estado ya procesado y recibirá quién lo autorizó/rechazó.
  const lock=LockService.getScriptLock();
  lock.waitLock(20000);
  let fechaDecision;
  try {
    const rows=objects_(sh);
    const rActual=rows.find(x=>val_(x,'FOLIO')===folio);
    if (!rActual) throw new Error('No se encontró el pase '+folio+'.');
    const actual=String(val_(rActual,'ESTATUS')||'').toUpperCase();
    if (actual!=='PENDIENTE') {
      return {folio:folio,estatus:actual,yaProcesado:true,
        autorizadoPor:val_(rActual,'AUTORIZADO_POR'),
        correo:val_(rActual,'CORREO_AUTORIZADOR_REAL'),
        fecha:val_(rActual,'FECHA_AUTORIZACION')};
    }

    fechaDecision=new Date();
    const nuevoEstatus=decision==='RECHAZADO'?'RECHAZADO':'AUTORIZADO';
    updateByFolio_(sh,folio,{ESTATUS:nuevoEstatus,AUTORIZADO_POR:actor,
      CORREO_AUTORIZADOR_REAL:actorEmail,FECHA_AUTORIZACION:fechaDecision,
      COMENTARIO_AUTORIZADOR:comentario});
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // Recuperamos el registro actualizado fuera del bloqueo para continuar con
  // correo/PDF sin impedir que otro clic pueda consultar el resultado.
  const r=objects_(sh).find(x=>val_(x,'FOLIO')===folio);
  if (!r) throw new Error('No se pudo recuperar el pase '+folio+'.');

  if (decision==='RECHAZADO') {
    const fechaRechazo=fechaDecision;

    const creador=val_(r,'CREADO_POR');
    const creadorRow=userRow_(creador)||{};
    const correosCreador=[
      val_(creadorRow,'CORREO_1','CORREO 1'),
      val_(creadorRow,'CORREO_2','CORREO 2')
    ].join(',');

    if (correosCreador.trim()) {
      const nombreCreador=val_(r,'NOMBRE_CREADOR') || creador;
      const motivoRechazo=comentario ? '\n\nComentario del autorizador: '+comentario : '';
      sendMail_(correosCreador,
        'Pase de Aclaración RECHAZADO '+folio,
        'Hola '+nombreCreador+',\n\nEl Pase de Aclaración '+folio+' fue RECHAZADO por '+actor+'.'+motivoRechazo+'\n\nYa puedes consultar el estatus del pase en PASE INTELIGENTE.',
        null,
        '<div style=\"font-family:Arial;max-width:650px\">'+
          '<h2 style=\"color:#b42318\">Pase de Aclaración RECHAZADO</h2>'+
          '<p><b>Folio:</b> '+esc_(folio)+'</p>'+
          '<p><b>Creado por:</b> '+esc_(nombreCreador)+'</p>'+
          '<p><b>Rechazado por:</b> '+esc_(actor)+'</p>'+
          (actorEmail ? '<p><b>Correo:</b> '+esc_(actorEmail)+'</p>' : '')+
          (comentario ? '<p><b>Comentario:</b> '+esc_(comentario)+'</p>' : '')+
          '<p>El pase no fue autorizado. Puedes consultar su estatus en PASE INTELIGENTE.</p>'+
        '</div>'
      );
    }

    return {folio,estatus:'RECHAZADO'};
  }

  const autorizador=String(actor||'').trim() || String(val_(r,'DESTINO_AUTORIZACION')||'AUTORIZADOR').trim();
  const fechaAutorizacion=fechaDecision;

  const fresh=objects_(sh).find(x=>val_(x,'FOLIO')===folio);
  if (!fresh) throw new Error('No se pudo recuperar el pase autorizado '+folio+'.');
  fresh.ESTATUS='AUTORIZADO';
  fresh.AUTORIZADO_POR=autorizador;
  fresh.CORREO_AUTORIZADOR_REAL=actorEmail;
  fresh.FECHA_AUTORIZACION=fechaAutorizacion;
  const pdf=createPdf_('ACLARACION',fresh);

  const correosFinales=requireEmailsByProfiles_(['USUARIO','ADMINISTRADOR'],'USUARIO y ADMINISTRADOR');
  const destinoFinal=correosFinales.join(',');
  sendMail_(destinoFinal,'Pase de Aclaración AUTORIZADO '+folio,
    'El pase '+folio+' fue autorizado. Se adjunta el documento final.',pdf);
  // El pase de Aclaración queda como AUTORIZADO aun después de enviar el PDF.
  // El estatus ENVIADO se utiliza únicamente para Pases de No Adeudo.
  updateByFolio_(sh,folio,{FECHA_ENVIO_FINAL:new Date()});
  return {folio,estatus:'AUTORIZADO'};
}

/* ========================= CONSULTA ========================= */

function listPasses_(b) {
  const s=session_(b.token);
  requirePassConsulta_(s);
  const q=String(b.q||'').trim().toUpperCase();
  const tipo=String(b.tipo||'TODOS').toUpperCase();
  const status=String(b.estatus||'').toUpperCase();
  const isAdmin=String(s.tipo).toUpperCase()==='ADMINISTRADOR';
  const desde=String(b.desde||'').trim();
  const hasta=String(b.hasta||'').trim();
  const creador=String(b.creador||'').trim().toUpperCase();

  let all=[];
  if (tipo==='TODOS'||tipo==='ACLARACION') all=all.concat(objects_(sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION)).map(r=>normPass_(r,'ACLARACION')));
  if (tipo==='TODOS'||tipo==='NO_ADEUDO') all=all.concat(objects_(sheet_(CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO)).map(r=>normPass_(r,'NO_ADEUDO')));

  if (!isAdmin) {
    all=all.filter(x=>String(x.area).toUpperCase()===String(s.area).toUpperCase());
  } else {
    if (desde) {
      const d0=new Date(desde+'T00:00:00');
      all=all.filter(x=>{const d=new Date(x.fechaCreacion); return !isNaN(d)&&d>=d0;});
    }
    if (hasta) {
      const d1=new Date(hasta+'T23:59:59');
      all=all.filter(x=>{const d=new Date(x.fechaCreacion); return !isNaN(d)&&d<=d1;});
    }
    if (creador) {
      all=all.filter(x=>String(x.creadoPor||'').toUpperCase()===creador || String(x.nombreCreador||'').toUpperCase()===creador);
    }
  }
  if (status) all=all.filter(x=>String(x.estatus).toUpperCase()===status);
  if (q) all=all.filter(x=>JSON.stringify(x).toUpperCase().includes(q));
  all.sort((a,b)=>new Date(b.fechaCreacion)-new Date(a.fechaCreacion));
  return all.slice(0,2000);
}

function getPass_(b) {
  const s=session_(b.token);
  const folio=String(b.folio||'');
  let r=objects_(sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION)).find(x=>val_(x,'FOLIO')===folio);
  if (r) return {tipo:'ACLARACION',data:r};
  r=objects_(sheet_(CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO)).find(x=>val_(x,'FOLIO')===folio);
  if (r) return {tipo:'NO_ADEUDO',data:r};
  throw new Error('Folio no encontrado.');
}

/* ========================= PDF / CORREO ========================= */

function createPdf_(tipo,r) {
  const folio=val_(r,'FOLIO');
  const pres=SlidesApp.create('TMP_'+folio);
  const slide=pres.getSlides()[0];

  slide.getPageElements().forEach(function(el){ try{el.remove();}catch(e){} });

  const W=720, H=405;
  const purple='#552583', red='#ED1C24', ink='#202124', light='#F5F0F8';

  const frame=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,10,10,W-20,H-20);
  frame.getFill().setSolidFill('#FFFFFF');
  frame.getBorder().setWeight(3);
  frame.getBorder().getLineFill().setSolidFill(purple);

  const logo=slide.insertImage(logoBlob_());
  logo.setLeft(24).setTop(18).setWidth(150).setHeight(96);

  addSlideText_(slide, tipo==='ACLARACION'?'PASE DE ACLARACIÓN':'PASE DE NO ADEUDO',
    190,31,330,32,17,true,purple,SlidesApp.ParagraphAlignment.CENTER);
  const fol=slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,535,31,155,34);
  fol.getFill().setSolidFill(red); fol.getBorder().setTransparent();
  setShapeText_(fol,'FOLIO  '+folio,11,true,'#FFFFFF',SlidesApp.ParagraphAlignment.CENTER);

  const line=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,190,72,500,4);
  line.getFill().setSolidFill(purple); line.getBorder().setTransparent();

  let rows;
  if(tipo==='ACLARACION'){
    let claveAc=val_(r,'CLAVE_CONDUCTOR','CLAVE CONDUCTOR','CLAVE');
    let nombreAc=val_(r,'NOMBRE_CONDUCTOR','NOMBRE CONDUCTOR','CONDUCTOR');
    let marcaAc=val_(r,'MARCA');
    if(claveAc && (!nombreAc || !marcaAc)){
      const dr=objects_(sheet_(CFG.SS_USUARIOS,CFG.SH_CONDUCTORES))
        .find(x=>val_(x,'CLAVE')===String(claveAc));
      if(dr){
        if(!nombreAc) nombreAc=val_(dr,'NOMBRE');
        if(!marcaAc) marcaAc=val_(dr,'MARCA');
      }
    }
    rows=[
      ['ÁREA',val_(r,'AREA'),'FECHA ACTUAL',fmtDate_(val_(r,'FECHA_CREACION'))],
      ['FECHA EVENTO',fmtDate_(val_(r,'FECHA_EVENTO')),'AUTOBÚS',val_(r,'AUTOBUS')],
      ['CLAVE',claveAc,'CONDUCTOR',nombreAc],
      ['MARCA',marcaAc,'',''],
      ['MOTIVO / CONCEPTO',val_(r,'MOTIVO_CONCEPTO'),'','']
    ];
  } else {
    rows=[
      ['RECAUDACIÓN',val_(r,'RECAUDACION'),'MARCA',val_(r,'MARCA')],
      ['FECHA',fmtDate_(val_(r,'FECHA_CREACION')),'AUTOBÚS',val_(r,'AUTOBUS')],
      ['CLAVE',val_(r,'CLAVE_CONDUCTOR'),'CONDUCTOR',val_(r,'NOMBRE_CONDUCTOR')],
      ['OBSERVACIONES',val_(r,'OBSERVACIONES')||'','','']
    ];
  }

  let y=105;
  rows.forEach(function(row,i){
    const h=(i>=3?42:36);
    addFieldBox_(slide,row[0],row[1],24,y,330,h,purple,light,ink);
    if(row[2]) addFieldBox_(slide,row[2],row[3],366,y,330,h,purple,light,ink);
    else {
      const wide=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,24,y,672,h);
      wide.getFill().setSolidFill('#FFFFFF');
      wide.getBorder().setWeight(1);
      wide.getBorder().getLineFill().setSolidFill('#B8A7C5');
      setShapeText_(wide,row[0]+':  '+String(row[1]||''),8.5,false,ink,SlidesApp.ParagraphAlignment.START);
    }
    y+=h+7;
  });

  const footerY=336;
  const footer=slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,24,footerY,672,48);
  footer.getFill().setSolidFill(light);
  footer.getBorder().setWeight(1);
  footer.getBorder().getLineFill().setSolidFill('#B8A7C5');

  let footText;
  if(tipo==='ACLARACION'){
    const autoriza=val_(r,'AUTORIZADO_POR') || 'PENDIENTE DE AUTORIZACIÓN';
    const correoAutoriza=val_(r,'CORREO_AUTORIZADOR_REAL');
    footText='GENERADO POR: '+(val_(r,'NOMBRE_CREADOR')||val_(r,'CREADO_POR'))+
             '     •     AUTORIZADO POR: '+autoriza+
             (correoAutoriza ? '\nCORREO: '+correoAutoriza : '');
  } else {
    footText='GENERADO POR: '+(val_(r,'NOMBRE_CREADOR')||val_(r,'CREADO_POR'));
  }
  setShapeText_(footer,footText,9,true,purple,SlidesApp.ParagraphAlignment.CENTER);

  pres.saveAndClose();
  Utilities.sleep(900);
  const f=DriveApp.getFileById(pres.getId());
  const pdf=f.getBlob().getAs(MimeType.PDF).setName(folio+'.pdf');
  f.setTrashed(true);
  return pdf;
}

function addFieldBox_(slide,label,value,x,y,w,h,purple,light,ink){
  const box=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,x,y,w,h);
  box.getFill().setSolidFill('#FFFFFF');
  box.getBorder().setWeight(1);
  box.getBorder().getLineFill().setSolidFill('#B8A7C5');
  setShapeText_(box,label+':  '+String(value||''),8.5,false,ink,SlidesApp.ParagraphAlignment.START);
  return box;
}

function addSlideText_(slide,text,x,y,w,h,size,bold,color,align){
  const shape=slide.insertTextBox(String(text||''),x,y,w,h);
  setShapeText_(shape,text,size,bold,color,align);
  return shape;
}

function setShapeText_(shape,text,size,bold,color,align){
  const tr=shape.getText();
  tr.setText(String(text||''));
  tr.getTextStyle().setFontFamily('Arial').setFontSize(size).setBold(bold).setForegroundColor(color);
  tr.getParagraphStyle().setParagraphAlignment(align);
}

function logoBlob_(){
  const b64='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';
  return Utilities.newBlob(Utilities.base64Decode(b64),'image/png','mobility-ado.png');
}

function fmtDate_(v){
  if(!v)return '';
  const d=new Date(v);
  return isNaN(d)?String(v):Utilities.formatDate(d,CFG.TZ,'dd/MM/yyyy');
}

function sendMail_(to,subject,body,pdf,htmlBody) {
  const apiKey=PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
  if(!apiKey) throw new Error('Falta configurar BREVO_API_KEY en Propiedades del script.');

  const recipients=String(to||'')
    .split(/[;,]/)
    .map(x=>x.trim())
    .filter(Boolean)
    .map(email=>({email:email}));
  if(!recipients.length) throw new Error('No hay destinatarios para el correo.');

  const payload={
    sender:{name:'PASE INTELIGENTE',email:'no-responder@automatepowerpages.xyz'},
    to:recipients,
    subject:String(subject||''),
    textContent:String(body||'')
  };
  if(htmlBody) payload.htmlContent=String(htmlBody);
  if(pdf){
    payload.attachment=[{
      name:(typeof pdf.getName==='function' && pdf.getName()) ? pdf.getName() : 'pase.pdf',
      content:Utilities.base64Encode(pdf.getBytes())
    }];
  }

  const res=UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email',{
    method:'post',
    contentType:'application/json',
    headers:{'api-key':apiKey,'accept':'application/json'},
    payload:JSON.stringify(payload),
    muteHttpExceptions:true
  });
  const code=res.getResponseCode();
  const response=res.getContentText();
  if(code<200 || code>=300){
    throw new Error('Brevo no pudo enviar el correo (HTTP '+code+'): '+response);
  }
  return response ? JSON.parse(response) : {ok:true};
}

/* ========================= HELPERS ========================= */

function sheet_(id,name) {
  const ss=SpreadsheetApp.openById(id);
  if (name) {
    const sh=ss.getSheetByName(name);
    if (!sh) throw new Error('No existe la pestaña "'+name+'" en '+ss.getName()+'.');
    return sh;
  }
  return ss.getSheets()[0];
}

function objects_(sh) {
  const v=sh.getDataRange().getValues();
  if (!v.length) return [];
  const h=v[0].map(norm_);
  return v.slice(1).filter(r=>r.some(x=>x!==''&&x!==null)).map((r,i)=>{
    const o={__row:i+2};
    h.forEach((k,j)=>o[k]=r[j]);
    return o;
  });
}

function ensureHeaders_(sh, requiredHeaders) {
  let lastCol=sh.getLastColumn();
  if(lastCol<1){
    sh.getRange(1,1,1,requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }
  const current=sh.getRange(1,1,1,lastCol).getValues()[0];
  const normalized=current.map(norm_);
  requiredHeaders.forEach(function(h){
    if(!normalized.includes(norm_(h))){
      lastCol++;
      sh.getRange(1,lastCol).setValue(h);
      normalized.push(norm_(h));
    }
  });
}

function appendObject_(sh,obj) {
  const lastCol=Math.max(sh.getLastColumn(),1);
  const headers=sh.getRange(1,1,1,lastCol).getValues()[0];
  if (!headers.some(String)) throw new Error('La hoja '+sh.getName()+' no tiene encabezados.');
  const row=headers.map(h=>{
    const key=norm_(h);
    const sourceKey=Object.keys(obj).find(k=>norm_(k)===key);
    return sourceKey ? obj[sourceKey] : '';
  });
  sh.appendRow(row);
}

function updateByFolio_(sh,folio,changes) {
  const data=sh.getDataRange().getValues();
  const headers=data[0].map(norm_);
  const fi=headers.indexOf('FOLIO');
  if(fi<0) throw new Error('Falta columna FOLIO.');
  const ri=data.findIndex((r,i)=>i>0 && String(r[fi])===String(folio));
  if(ri<0) throw new Error('No se encontró '+folio);
  Object.keys(changes).forEach(k=>{
    const ci=headers.indexOf(norm_(k));
    if(ci>=0) sh.getRange(ri+1,ci+1).setValue(changes[k]);
  });
}

function nextFolio_(prefix,area,id,shName) {
  const lock=LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sig=String(area||'').toUpperCase().startsWith('CARD')?'CRT':'VHT';
    const rows=objects_(sheet_(id,shName));
    const re=new RegExp('^'+prefix+'-'+sig+'-(\\d+)$');
    let max=0;
    rows.forEach(r=>{const m=val_(r,'FOLIO').match(re); if(m) max=Math.max(max,Number(m[1]));});
    return prefix+'-'+sig+'-'+String(max+1).padStart(6,'0');
  } finally { lock.releaseLock(); }
}

function normPass_(r,tipo) {
  return {
    folio:val_(r,'FOLIO'), tipo, area:val_(r,'AREA'),
    fechaCreacion:val_(r,'FECHA_CREACION'), autobus:val_(r,'AUTOBUS'),
    claveConductor:val_(r,'CLAVE_CONDUCTOR'), nombreConductor:val_(r,'NOMBRE_CONDUCTOR'),
    estatus:val_(r,'ESTATUS'), creadoPor:val_(r,'CREADO_POR'),
    nombreCreador:val_(r,'NOMBRE_CREADOR','CREADO_POR')
  };
}

function formatDateTime_(value) {
  if (!value) return '';
  const d=value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return Utilities.formatDate(d, CFG.TZ, 'dd/MM/yyyy HH:mm');
}

function val_(o) {
  for(let i=1;i<arguments.length;i++){
    const k=norm_(arguments[i]);
    if(Object.prototype.hasOwnProperty.call(o,k) && o[k]!=='' && o[k]!=null) return String(o[k]);
  }
  return '';
}
function norm_(s){return String(s||'').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');}
function required_(o,keys){keys.forEach(k=>{if(!String(o[k]||'').trim())throw new Error('Falta el campo '+k+'.');});}
function requireUserCreator_(s){
  const tipo=norm_(s.tipo);
  if(!['USUARIO','ADMINISTRADOR'].includes(tipo)) throw new Error('Tu perfil no puede generar pases.');
}
function requirePassConsulta_(s){
  const tipo=norm_(s.tipo);
  const permitidos=['USUARIO','ADMINISTRADOR','PRECEPTOR','PRECEPTOR_CRT','TRAFICO_VHT','TRAFICO_CRT','GERENTE'];
  if(!permitidos.includes(tipo)) throw new Error('Tu perfil no tiene acceso a la consulta de pases.');
}
function fmt_(v){if(!v)return ''; const d=new Date(v); return isNaN(d)?String(v):Utilities.formatDate(d,CFG.TZ,'dd/MM/yyyy HH:mm');}
function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function esc_(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
