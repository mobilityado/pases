/**
 * PASES Mobility ADO - Backend Google Apps Script
 * v1.4 - 25/09/2026
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
  required_(d,['recaudacion','autobus','claveConductor','nombreConductor']);
  if (!['VILLAHERMOSA','CARDENAS','CÁRDENAS'].includes(String(d.recaudacion||'').trim().toUpperCase())) throw new Error('Recaudación no válida.');

  // La hoja CONDUCTORES es la fuente oficial de la marca.
  // Si la clave existe, NO se valida contra una lista fija: se usa exactamente la marca registrada.
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
  let correoAut='';
  if (destino==='PRECEPTOR CRT') {
    const usuarios = objects_(sheet_(CFG.SS_USUARIOS, CFG.SH_USUARIOS));
    const preceptorCrt = usuarios.find(r =>
      val_(r,'TIPO_CUENTA','TIPO DE CUENTA').toUpperCase()==='PRECEPTOR CRT' &&
      val_(r,'ACTIVO').toUpperCase()!=='NO'
    );
    if (preceptorCrt) {
      correoAut = val_(preceptorCrt,
        'CORREO_USUARIO',
        'CORREO_ACLARACION_PRECEPTOR',
        'CORREO ACLARACION PRECEPTOR'
      );
    }
  } else {
    const emailKey = destino==='PRECEPTOR' ? ['CORREO_ACLARACION_PRECEPTOR','CORREO ACLARACION PRECEPTOR'] :
                     destino==='ADMINISTRADOR' ? ['CORREO_ACLARACION_ADMIN','CORREO ACLARACION ADMIN'] :
                     ['CORREO_ACLARACION_GERENTE','CORREO ACLARACION GERENTE'];
    correoAut=val_.apply(null,[u].concat(emailKey));
  }
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
  // v1.4 - Generador basado en Google Slides.
  // A diferencia de la conversión HTML/Docs, Slides incrusta la imagen directamente,
  // por lo que el logotipo sí viaja dentro del PDF final.
  const folio=val_(r,'FOLIO');
  const pres=SlidesApp.create('TMP_'+folio);
  const slide=pres.getSlides()[0];

  // Limpiar placeholders predeterminados.
  slide.getPageElements().forEach(function(el){ try{el.remove();}catch(e){} });

  // Medidas de una diapositiva widescreen 16:9 (720 x 405 pt aprox).
  const W=720, H=405;
  const purple='#552583', red='#ED1C24', ink='#202124', light='#F5F0F8', gray='#667085';

  // Fondo y marco.
  const frame=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,10,10,W-20,H-20);
  frame.getFill().setSolidFill('#FFFFFF');
  frame.getBorder().setWeight(3);
  frame.getBorder().getLineFill().setSolidFill(purple);

  // Logo real incrustado como PNG.
  const logo=slide.insertImage(logoBlob_());
  logo.setLeft(24).setTop(18).setWidth(150).setHeight(96);

  // Título y folio.
  addSlideText_(slide, tipo==='ACLARACION'?'PASE DE ACLARACIÓN':'PASE DE NO ADEUDO',
    190,31,330,32,17,true,purple,SlidesApp.ParagraphAlignment.CENTER);
  const fol=slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE,535,31,155,34);
  fol.getFill().setSolidFill(red); fol.getBorder().setTransparent();
  setShapeText_(fol,'FOLIO  '+folio,11,true,'#FFFFFF',SlidesApp.ParagraphAlignment.CENTER);

  // Línea corporativa.
  const line=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,190,72,500,4);
  line.getFill().setSolidFill(purple); line.getBorder().setTransparent();

  let rows;
  if(tipo==='ACLARACION'){
    rows=[
      ['ÁREA',val_(r,'AREA'),'FECHA ACTUAL',fmtDate_(val_(r,'FECHA_CREACION'))],
      ['FECHA EVENTO',fmtDate_(val_(r,'FECHA_EVENTO')),'AUTOBÚS',val_(r,'AUTOBUS')],
      ['CLAVE',val_(r,'CLAVE_CONDUCTOR'),'CONDUCTOR',val_(r,'NOMBRE_CONDUCTOR')],
      ['MOTIVO / CONCEPTO',val_(r,'MOTIVO_CONCEPTO'),'',''],
      ['OBSERVACIONES',val_(r,'OBSERVACIONES'),'','']
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
      // Campo ancho para motivo/observaciones.
      const wide=slide.insertShape(SlidesApp.ShapeType.RECTANGLE,24,y,672,h);
      wide.getFill().setSolidFill('#FFFFFF');
      wide.getBorder().setWeight(1);
      wide.getBorder().getLineFill().setSolidFill('#B8A7C5');
      setShapeText_(wide,row[0]+':  '+String(row[1]||''),8.5,false,ink,SlidesApp.ParagraphAlignment.START);
    }
    y+=h+7;
  });

  // Pie sin líneas de firma: usuarios responsables.
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
  const b64='/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAPXBgADASIAAhEBAxEB/8QAHQABAAIBBQEAAAAAAAAAAAAAAAgJBwEDBAUGAv/EAFUQAQABAwMBAwUIDQgJBAICAwABAgMEBQYRBwgSIQkTMUFRIjdhcXSBkbEUFSMyMzZUcnOTobLRFxg1OFJVdeEWGSQ0QoKSwdJDU1ZXJWJFlCZjov/EABwBAQACAgMBAAAAAAAAAAAAAAAFBgMEAQIHCP/EAD4RAQABAwICBQoFAwMFAQEBAAABAgMEBREhMRITQVFxBgciMjNhgZGhwRQVQlKxNHLRIzXhFhdUYpKCovH/2gAMAwEAAhEDEQA/ALUwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//Z';
  return Utilities.newBlob(Utilities.base64Decode(b64),'image/png','mobility-ado.png');
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
