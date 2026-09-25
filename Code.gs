/**
 * PASES Mobility ADO - Backend Google Apps Script
 * v1.0 - 25/09/2026
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
      case 'logout': result = logout_(body); break;
      case 'findDriver': result = findDriver_(body); break;
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
    correo: val_(found,'CORREO_USUARIO')
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

/* ========================= NO ADEUDO ========================= */

function saveNoAdeudo_(b) {
  const s=session_(b.token);
  requireUserCreator_(s);
  const d=b.data||{};
  required_(d,['recaudacion','marca','autobus','claveConductor','nombreConductor']);

  ensureDriver_(d.claveConductor,d.nombreConductor,d.marca);

  const folio=nextFolio_('NA',s.area,CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO);
  const now=new Date();
  const u=userRow_(s.usuario)||{};
  const correoDestino = val_(u,'CORREO_NO_ADEUDO','CORREO NO ADEUDO');
  if (!correoDestino) throw new Error('El usuario no tiene CORREO_NO_ADEUDO configurado.');

  const obj={
    ID:Utilities.getUuid(), FOLIO:folio, AREA:s.area, FECHA_CREACION:now,
    RECAUDACION:d.recaudacion, MARCA:d.marca, AUTOBUS:d.autobus,
    CLAVE_CONDUCTOR:d.claveConductor, NOMBRE_CONDUCTOR:d.nombreConductor,
    CREADO_POR:s.usuario, NOMBRE_CREADOR:s.nombre, CORREO_DESTINO:correoDestino,
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
  const emailKey = destino==='PRECEPTOR' ? ['CORREO_ACLARACION_PRECEPTOR','CORREO ACLARACION PRECEPTOR'] :
                   destino==='ADMINISTRADOR' ? ['CORREO_ACLARACION_ADMIN','CORREO ACLARACION ADMIN'] :
                   ['CORREO_ACLARACION_GERENTE','CORREO ACLARACION GERENTE'];
  const correoAut=val_.apply(null,[u].concat(emailKey));
  if (!correoAut) throw new Error('No está configurado el correo para '+destino+'.');

  const tokenAut=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  const obj={
    ID:Utilities.getUuid(), FOLIO:folio, AREA:s.area, FECHA_CREACION:now,
    FECHA_EVENTO:d.fechaEvento, MOTIVO_CONCEPTO:d.motivoConcepto, AUTOBUS:d.autobus,
    CLAVE_CONDUCTOR:d.claveConductor, NOMBRE_CONDUCTOR:d.nombreConductor,
    OBSERVACIONES:d.observaciones||'', CREADO_POR:s.usuario, NOMBRE_CREADOR:s.nombre,
    DESTINO_AUTORIZACION:destino, CORREO_AUTORIZADOR:correoAut, ESTATUS:'PENDIENTE',
    FECHA_ENVIO_AUTORIZACION:now, AUTORIZADO_POR:'', FECHA_AUTORIZACION:'',
    COMENTARIO_AUTORIZADOR:'', URL_DOCUMENTO:'', FECHA_ENVIO_FINAL:'',
    TOKEN_AUTORIZACION:tokenAut
  };
  const sh=sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION);
  appendObject_(sh,obj);

  const url=ScriptApp.getService().getUrl();
  const yes=url+'?action=decision&token='+encodeURIComponent(tokenAut)+'&decision=AUTORIZADO';
  const no=url+'?action=decision&token='+encodeURIComponent(tokenAut)+'&decision=RECHAZADO';
  const html='<div style="font-family:Arial;max-width:650px">'+
    '<h2>Pase de Aclaración pendiente</h2><p><b>Folio:</b> '+esc_(folio)+'</p>'+
    '<p><b>Área:</b> '+esc_(s.area)+' &nbsp; <b>Autobús:</b> '+esc_(d.autobus)+'</p>'+
    '<p><b>Conductor:</b> '+esc_(d.claveConductor+' - '+d.nombreConductor)+'</p>'+
    '<p><b>Motivo:</b> '+esc_(d.motivoConcepto)+'</p>'+
    '<p><a href="'+yes+'" style="background:#18864b;color:white;padding:12px 18px;text-decoration:none;border-radius:7px">AUTORIZAR</a> '+
    '<a href="'+no+'" style="background:#b42318;color:white;padding:12px 18px;text-decoration:none;border-radius:7px">RECHAZAR</a></p></div>';
  MailApp.sendEmail({to:correoAut,subject:'Autorización Pase de Aclaración '+folio,htmlBody:html,
    body:'Pase '+folio+' pendiente de autorización.'});
  return {folio, estatus:'PENDIENTE', enviadoA:destino};
}

function decisionPage_(p) {
  try {
    const r=processDecision_(p.token,p.decision,p.comentario||'','ENLACE_CORREO');
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
  if (!['ADMINISTRADOR','PRECEPTOR','GERENTE'].includes(tipo))
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
    updateByFolio_(sh,folio,{ESTATUS:'RECHAZADO',AUTORIZADO_POR:actor,FECHA_AUTORIZACION:new Date(),
      COMENTARIO_AUTORIZADOR:comentario});
    return {folio,estatus:'RECHAZADO'};
  }

  updateByFolio_(sh,folio,{ESTATUS:'AUTORIZADO',AUTORIZADO_POR:actor,FECHA_AUTORIZACION:new Date(),
    COMENTARIO_AUTORIZADOR:comentario});
  const fresh=objects_(sh).find(x=>val_(x,'FOLIO')===folio);
  const pdf=createPdf_('ACLARACION',fresh);

  const creator=userRow_(val_(fresh,'CREADO_POR'))||{};
  const destinoFinal=val_(creator,'CORREO_USUARIO') || val_(creator,'CORREO_ACLARACION_PRECEPTOR');
  if (destinoFinal) {
    sendMail_(destinoFinal,'Pase de Aclaración AUTORIZADO '+folio,
      'El pase '+folio+' fue autorizado. Se adjunta el documento final.',pdf);
  }
  updateByFolio_(sh,folio,{ESTATUS:'ENVIADO',FECHA_ENVIO_FINAL:new Date()});
  return {folio,estatus:'ENVIADO'};
}

/* ========================= CONSULTA ========================= */

function listPasses_(b) {
  const s=session_(b.token);
  const q=String(b.q||'').trim().toUpperCase();
  const tipo=String(b.tipo||'TODOS').toUpperCase();
  const status=String(b.estatus||'').toUpperCase();

  let all=[];
  if (tipo==='TODOS'||tipo==='ACLARACION') all=all.concat(objects_(sheet_(CFG.SS_ACLARACION,CFG.SH_ACLARACION)).map(r=>normPass_(r,'ACLARACION')));
  if (tipo==='TODOS'||tipo==='NO_ADEUDO') all=all.concat(objects_(sheet_(CFG.SS_NO_ADEUDO,CFG.SH_NO_ADEUDO)).map(r=>normPass_(r,'NO_ADEUDO')));

  if (String(s.tipo).toUpperCase()!=='ADMINISTRADOR') {
    all=all.filter(x=>String(x.area).toUpperCase()===String(s.area).toUpperCase());
  }
  if (status) all=all.filter(x=>String(x.estatus).toUpperCase()===status);
  if (q) all=all.filter(x=>JSON.stringify(x).toUpperCase().includes(q));
  all.sort((a,b)=>new Date(b.fechaCreacion)-new Date(a.fechaCreacion));
  return all.slice(0,500);
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
  const doc=DocumentApp.create(tipo+' '+val_(r,'FOLIO'));
  const body=doc.getBody();
  body.setMarginTop(28).setMarginBottom(28).setMarginLeft(32).setMarginRight(32);
  let p=body.appendParagraph('MOBILITY ADO');
  p.setBold(true).setFontSize(18).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  p=body.appendParagraph(tipo==='ACLARACION'?'PASE DE ACLARACIÓN':'PASE DE NO ADEUDO');
  p.setBold(true).setFontSize(16).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendHorizontalRule();
  const folio=val_(r,'FOLIO');
  body.appendParagraph('FOLIO: '+folio).setBold(true);

  if (tipo==='ACLARACION') {
    addField_(body,'ÁREA',val_(r,'AREA'));
    addField_(body,'FECHA ACTUAL',fmt_(val_(r,'FECHA_CREACION')));
    addField_(body,'FECHA EVENTO',fmt_(val_(r,'FECHA_EVENTO')));
    addField_(body,'MOTIVO / CONCEPTO DE EVENTO',val_(r,'MOTIVO_CONCEPTO'));
    addField_(body,'AUTOBÚS',val_(r,'AUTOBUS'));
    addField_(body,'CONDUCTOR',val_(r,'CLAVE_CONDUCTOR')+' - '+val_(r,'NOMBRE_CONDUCTOR'));
    addField_(body,'OBSERVACIONES',val_(r,'OBSERVACIONES'));
    body.appendParagraph('\n\n________________________    ________________________    ________________________');
    body.appendParagraph('FIRMA TACOGRAFÍA              FIRMA CONDUCTOR               FIRMA AUTORIZADO').setFontSize(8);
  } else {
    addField_(body,'RECAUDACIÓN',val_(r,'RECAUDACION'));
    addField_(body,'MARCA',val_(r,'MARCA'));
    addField_(body,'FECHA',fmt_(val_(r,'FECHA_CREACION')));
    addField_(body,'AUTOBÚS',val_(r,'AUTOBUS'));
    addField_(body,'CONDUCTOR',val_(r,'CLAVE_CONDUCTOR')+' - '+val_(r,'NOMBRE_CONDUCTOR'));
    body.appendParagraph('\n\n_______________________________').setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph('NOMBRE Y FIRMA DEL RECAUDADOR QUE AUTORIZÓ EL NO ADEUDO')
      .setFontSize(8).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  }
  doc.saveAndClose();
  const f=DriveApp.getFileById(doc.getId());
  const pdf=f.getBlob().getAs(MimeType.PDF).setName(folio+'.pdf');
  f.setTrashed(true);
  return pdf;
}

function addField_(body,label,value) {
  const p=body.appendParagraph('');
  p.appendText(label+': ').setBold(true);
  p.appendText(String(value||''));
  body.appendParagraph('________________________________________________________________________________').setFontSize(7);
}

function sendMail_(to,subject,body,pdf) {
  MailApp.sendEmail({to,subject,body,attachments:[pdf]});
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
    estatus:val_(r,'ESTATUS'), creadoPor:val_(r,'CREADO_POR')
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
