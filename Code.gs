/**
 * PASES Mobility ADO - Backend Google Apps Script
 * v1.2 - 25/09/2026
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
  if (!['VILLAHERMOSA','CARDENAS','CÁRDENAS'].includes(String(d.recaudacion||'').trim().toUpperCase())) throw new Error('Recaudación no válida.');
  if (!['SURO','TRT','ADO'].includes(String(d.marca||'').trim().toUpperCase())) throw new Error('Marca no válida.');

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
  // v1.2: pase horizontal ocupando prácticamente toda la hoja, con marco y logo.
  // Se usa 20 x 12 cm en ambos formatos para que el documento sea compacto,
  // horizontal y mucho más parecido a un pase físico.
  const folio=val_(r,'FOLIO');
  const doc=DocumentApp.create(tipo+' '+folio);
  const id=doc.getId();
  doc.saveAndClose();

  setDocPage_(id, 20, 12, 0.30);

  const d=DocumentApp.openById(id);
  const body=d.getBody();
  body.clear();
  body.setMarginTop(6).setMarginBottom(6).setMarginLeft(7).setMarginRight(7);

  if (tipo==='ACLARACION') buildAclaracionPass_(body,r);
  else buildNoAdeudoPass_(body,r);

  d.saveAndClose();
  Utilities.sleep(700);
  const f=DriveApp.getFileById(id);
  const pdf=f.getBlob().getAs(MimeType.PDF).setName(folio+'.pdf');
  f.setTrashed(true);
  return pdf;
}

function setDocPage_(docId,widthCm,heightCm,marginCm) {
  const pt = cm => cm * 28.3464567;
  const payload={requests:[{updateDocumentStyle:{documentStyle:{
    pageSize:{width:{magnitude:pt(widthCm),unit:'PT'},height:{magnitude:pt(heightCm),unit:'PT'}},
    marginTop:{magnitude:pt(marginCm),unit:'PT'},marginBottom:{magnitude:pt(marginCm),unit:'PT'},
    marginLeft:{magnitude:pt(marginCm),unit:'PT'},marginRight:{magnitude:pt(marginCm),unit:'PT'}
  },fields:'pageSize,marginTop,marginBottom,marginLeft,marginRight'}}]};
  const res=UrlFetchApp.fetch('https://docs.googleapis.com/v1/documents/'+docId+':batchUpdate',{
    method:'post',contentType:'application/json',payload:JSON.stringify(payload),
    headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true
  });
  if(res.getResponseCode()>=300) console.warn('No se pudo ajustar tamaño del pase: '+res.getContentText());
}

function logoBlob_() {
  const b64='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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH//2Q==';
  return Utilities.newBlob(Utilities.base64Decode(b64),'image/jpeg','mobility-ado.jpg');
}

function addLogoHeader_(body,title,folio) {
  // Tabla exterior = marco general del pase.
  const outer=body.appendTable([['']]);
  outer.setBorderWidth(2);
  outer.setBorderColor('#552583');
  const cell=outer.getCell(0,0);
  cell.setPaddingTop(5).setPaddingBottom(5).setPaddingLeft(7).setPaddingRight(7);
  cell.clear();

  const logoP=cell.appendParagraph('');
  logoP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const img=logoP.appendInlineImage(logoBlob_());
  img.setWidth(185).setHeight(118);

  const bar=cell.appendTable([[title,'FOLIO  '+folio]]);
  bar.setBorderWidth(0);
  bar.getCell(0,0).setBackgroundColor('#552583');
  bar.getCell(0,1).setBackgroundColor('#ED1C24');
  bar.getCell(0,0).getChild(0).asParagraph().setForegroundColor('#FFFFFF').setBold(true)
    .setFontSize(11).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  bar.getCell(0,1).getChild(0).asParagraph().setForegroundColor('#FFFFFF').setBold(true)
    .setFontSize(10).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  return cell;
}

function fieldTable_(cell,rows) {
  const t=cell.appendTable(rows);
  t.setBorderWidth(1);
  t.setBorderColor('#7A7A7A');
  for(let i=0;i<t.getNumRows();i++){
    const row=t.getRow(i);
    for(let j=0;j<row.getNumCells();j++){
      const c=row.getCell(j);
      c.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(4).setPaddingRight(4);
      const p=c.getChild(0).asParagraph();
      p.setFontSize(8);
      if(j%2===0){
        p.setBold(true).setForegroundColor('#552583');
        c.setBackgroundColor('#F4EFF8');
      }
    }
  }
  return t;
}

function buildNoAdeudoPass_(body,r) {
  const cell=addLogoHeader_(body,'PASE DE NO ADEUDO',val_(r,'FOLIO'));
  cell.appendParagraph('').setFontSize(2);
  fieldTable_(cell,[
    ['RECAUDACIÓN',val_(r,'RECAUDACION'),'MARCA',val_(r,'MARCA')],
    ['FECHA',fmtDate_(val_(r,'FECHA_CREACION')),'AUTOBÚS',val_(r,'AUTOBUS')],
    ['CLAVE',val_(r,'CLAVE_CONDUCTOR'),'CONDUCTOR',val_(r,'NOMBRE_CONDUCTOR')],
    ['OBSERVACIONES',val_(r,'OBSERVACIONES')||'','','']
  ]);
  cell.appendParagraph('\n_______________________________________________')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setFontSize(7);
  cell.appendParagraph('CLAVE Y NOMBRE COMPLETO DEL RECAUDADOR QUE AUTORIZÓ EL NO ADEUDO')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setBold(true).setFontSize(6)
    .setForegroundColor('#552583');
}

function buildAclaracionPass_(body,r) {
  const cell=addLogoHeader_(body,'PASE DE ACLARACIÓN',val_(r,'FOLIO'));
  cell.appendParagraph('').setFontSize(2);
  fieldTable_(cell,[
    ['ÁREA',val_(r,'AREA'),'FECHA ACTUAL',fmtDate_(val_(r,'FECHA_CREACION'))],
    ['FECHA EVENTO',fmtDate_(val_(r,'FECHA_EVENTO')),'AUTOBÚS',val_(r,'AUTOBUS')],
    ['CLAVE',val_(r,'CLAVE_CONDUCTOR'),'CONDUCTOR',val_(r,'NOMBRE_CONDUCTOR')],
    ['MOTIVO / CONCEPTO',val_(r,'MOTIVO_CONCEPTO'),'',''],
    ['OBSERVACIONES',val_(r,'OBSERVACIONES'),'','']
  ]);
  cell.appendParagraph('\n__________________       __________________       __________________')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setFontSize(6);
  cell.appendParagraph('FIRMA Y SELLO TACOGRAFÍA       NOMBRE Y FIRMA CONDUCTOR       NOMBRE, FIRMA Y SELLO AUTORIZADO')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setBold(true).setFontSize(5)
    .setForegroundColor('#552583');
}

function fmtDate_(v){
  if(!v)return '';
  const d=new Date(v);
  return isNaN(d)?String(v):Utilities.formatDate(d,CFG.TZ,'dd/MM/yyyy');
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
