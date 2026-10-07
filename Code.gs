/**
 * PASES Mobility ADO - Backend Google Apps Script
 * v1.7 - Actualizado (Corrección de listado de usuarios con nombres duplicados)
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
  // Enlaces de autorización enviados por correo.
  if (p.action === 'decision') return decisionPage_(p);

  // API por GET (principalmente pruebas/health).
  if (p.action === 'health') return json_({ok:true, app:CFG.APP_NAME, time:new Date()});
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;padding:30px"><h2>PASES | Mobility ADO</h2>' +
    '<p>Backend activo.</p><p>La interfaz principal se publica en GitHub Pages.</p></div>'
  ).setTitle(CFG.APP_NAME);
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');
    let result;

    switch (action) {
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
      case 'decision': result = decisionApi_(body); break;
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

  let all=[];
  objects_(sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION)).forEach(r=>all.push({
    tipo:'ACLARACION', fecha:val_(r,'FECHA_CREACION'), usuario:val_(r,'NOMBRE_CREADOR','CREADO_POR')||'SIN USUARIO'
  }));
  objects_(sheet_(CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO)).forEach(r=>all.push({
    tipo:'NO_ADEUDO', fecha:val_(r,'FECHA_CREACION'), usuario:val_(r,'NOMBRE_CREADOR','CREADO_POR')||'SIN USUARIO'
  }));

  const now=new Date();
  const items={};
  all.forEach(x=>{
    const d=parseDate_(x.fecha); if(!d || isNaN(d.getTime())) return;
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
    DESTINO_AUTORIZACION:destino, CORREO_AUTORIZADOR:correoAut, ESTATUS:'PENDIENTE',
    FECHA_ENVIO_AUTORIZACION:now, AUTORIZADO_POR:'', FECHA_AUTORIZACION:'',
    COMENTARIO_AUTORIZADOR:'', URL_DOCUMENTO:'', FECHA_ENVIO_FINAL:'',
    TOKEN_AUTORIZACION:tokenAut
  };
  const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
  ensureHeaders_(sh,['CLAVE_CONDUCTOR','NOMBRE_CONDUCTOR','MARCA']);
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

    updateByFolio_(sh,folio,{ESTATUS:'ENVIADO',FECHA_ENVIO_FINAL:new Date()});
    return {folio, estatus:'ENVIADO', enviadoA:'USUARIO y ADMINISTRADOR'};
  }

  const url=ScriptApp.getService().getUrl();
  const yes=url+'?action=decision&token='+encodeURIComponent(tokenAut)+'&decision=AUTORIZADO';
  const no=url+'?action=decision&token='+encodeURIComponent(tokenAut)+'&decision=RECHAZADO';
  const html='<div style="font-family:Arial;max-width:650px">'+
    '<h2>Pase de Aclaración pendiente</h2><p><b>Folio:</b> '+esc_(folio)+'</p>'+
    '<p><b>Área:</b> '+esc_(s.area)+' &nbsp; <b>Autobús:</b> '+esc_(d.autobus)+'</p>'+
    '<p><b>Conductor:</b> '+esc_(d.claveConductor+' - '+d.nombreConductor)+'</p>'+'<p><b>Marca:</b> '+esc_(d.marca||'')+'</p>'+
    '<p><b>Motivo:</b> '+esc_(d.motivoConcepto)+'</p>'+
    '<p><a href="'+yes+'" style="background:#18864b;color:white;padding:12px 18px;text-decoration:none;border-radius:7px">AUTORIZAR</a> '+
    '<a href="'+no+'" style="background:#b42318;color:white;padding:12px 18px;text-decoration:none;border-radius:7px">RECHAZAR</a></p></div>';
  sendMail_(correoAut,'Autorización Pase de Aclaración '+folio,
    'Pase '+folio+' pendiente de autorización.',null,html);
  return {folio, estatus:'PENDIENTE', enviadoA:destino};
}

function decisionPage_(p) {
  try {
    const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
    const rr=objects_(sh).find(x=>val_(x,'TOKEN_AUTORIZACION')===String(p.token||''));
    const actor=rr ? (val_(rr,'DESTINO_AUTORIZACION') || val_(rr,'CORREO_AUTORIZADOR') || 'AUTORIZADOR') : 'AUTORIZADOR';
    const r=processDecision_(p.token,p.decision,p.comentario||'',actor);
    return HtmlService.createHtmlOutput('<div style="font-family:Arial;text-align:center;padding:50px">'+
      '<h2>'+esc_(r.folio)+'</h2><h1>'+esc_(r.estatus)+'</h1>'+
      '<p>La decisión quedó registrada correctamente.</p></div>').setTitle('Pases Mobility ADO');
  } catch(err) {
    return HtmlService.createHtmlOutput('<div style="font-family:Arial;padding:50px"><h2>No fue posible procesar</h2><p>'+
      esc_(err.message)+'</p></div>');
  }
}

function decisionApi_(b) {
  const s=session_(b.token);
  const tipo=String(s.tipo||'').toUpperCase();
  if (!['ADMINISTRADOR','PRECEPTOR','PRECEPTOR CRT','GERENTE'].includes(tipo))
    throw new Error('Tu perfil no puede autorizar pases.');
  return processDecision_(b.tokenAut,b.decision,b.comentario||'',s.usuario);
}

function processDecision_(tokenAut,decision,comentario,actor) {
  const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
  const rows=objects_(sh);
  const r=rows.find(x=>val_(x,'TOKEN_AUTORIZACION')===String(tokenAut||''));
  if (!r) throw new Error('Enlace de autorización inválido.');
  const actual=val_(r,'ESTATUS').toUpperCase();
  if (actual!=='PENDIENTE') return {folio:val_(r,'FOLIO'),estatus:actual};

  decision=String(decision||'').toUpperCase();
  if (!['AUTORIZADO','RECHAZADO'].includes(decision)) throw new Error('Decisión no válida.');
  const folio=val_(r,'FOLIO');

  if (decision==='RECHAZADO') {
    const fechaRechazo=new Date();
    updateByFolio_(sh,folio,{ESTATUS:'RECHAZADO',AUTORIZADO_POR:actor,FECHA_AUTORIZACION:fechaRechazo,
      COMENTARIO_AUTORIZADOR:comentario});

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
          (comentario ? '<p><b>Comentario:</b> '+esc_(comentario)+'</p>' : '')+
          '<p>El pase no fue autorizado. Puedes consultar su estatus en PASE INTELIGENTE.</p>'+
        '</div>'
      );
    }

    return {folio,estatus:'RECHAZADO'};
  }

  const autorizador=String(actor||'').trim() || String(val_(r,'DESTINO_AUTORIZACION')||'AUTORIZADOR').trim();
  const fechaAutorizacion=new Date();
  updateByFolio_(sh,folio,{ESTATUS:'AUTORIZADO',AUTORIZADO_POR:autorizador,FECHA_AUTORIZACION:fechaAutorizacion,
    COMENTARIO_AUTORIZADOR:comentario});
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
    'El pase '+folio+' fue autorizado. Se adjunta el documento final.',pdf);
  updateByFolio_(sh,folio,{ESTATUS:'ENVIADO',FECHA_ENVIO_FINAL:new Date()});
  return {folio,estatus:'ENVIADO'};
}

/* ========================= CONSULTA ========================= */

function listPasses_(b) {
  const s=session_(b.token);
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

  const footerY=350;
  const footer=slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,24,footerY,672,34);
  footer.getFill().setSolidFill(light);
  footer.getBorder().setWeight(1);
  footer.getBorder().getLineFill().setSolidFill('#B8A7C5');

  let footText;
  if(tipo==='ACLARACION'){
    const autoriza=val_(r,'AUTORIZADO_POR') || 'PENDIENTE DE AUTORIZACIÓN';
    footText='GENERADO POR: '+(val_(r,'NOMBRE_CREADOR')||val_(r,'CREADO_POR'))+
             '     •     AUTORIZADO POR: '+autoriza;
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
  const b64='/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAPXBgADASIAAhEBAxEB/8QAHQABAAIBBQEAAAAAAAAAAAAAAAgJBwEDBAUGAv/EAFUQAQABAwMBAwUIDQgJBAICAwABAgMEBQYRBwgSIQkTMUFRIjdhcXSBkbEUFSMyMzZUcnOTobLRFxg1OFJVdeEWGSQ0QoKSwdJDU1ZXJWJFlCZjov/EABwBAQACAgMBAAAAAAAAAAAAAAAFBgMEAQIHCP/EAD4RAQABAwICBQoFAwMFAQEBAAABAgMEBREhMRITQVFxBgciMjNhgZGhwRQVQlKxNHLRIzXhFhdUYpKCovH/2gAMAwEAAhEDEQA/ALUwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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';
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

function val_(o) {
  for(let i=1;i<arguments.length;i++){
    const k=norm_(arguments[i]);
    if(Object.prototype.hasOwnProperty.call(o,k) && o[k]!=='' && o[k]!=null) return String(o[k]);
  }
  return '';
}
function norm_(s){return String(s||'').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_');}
function required_(o,keys){keys.forEach(k=>{if(!String(o[k]||'').trim())throw new Error('Falta el campo '+k+'.');});}
function requireUserCreator_(s){if(!['USUARIO','ADMINISTRADOR'].includes(String(s.tipo||'').toUpperCase()))throw new Error('Tu perfil no puede generar pases.');}
function fmt_(v){if(!v)return ''; const d=new Date(v); return isNaN(d)?String(v):Utilities.formatDate(d,CFG.TZ,'dd/MM/yyyy HH:mm');}
function json_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}
function esc_(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
