/* Offline HTML annotations. No network requests, dependencies or extensions. */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
  function noteStorageKey(base) {
    let hash = 2166136261;
    for (let i=0;i<base.length;i++) hash = Math.imul(hash ^ base.charCodeAt(i), 16777619);
    return 'html-annotation-editor:notes:'+(hash>>>0).toString(36)+':'+base.length;
  }
  function validStoredNotes(value) {
    const types = ['字段说明','交互逻辑','业务规则','修改原型'];
    const ids = new Set();
    return Array.isArray(value) && value.every(note => note && typeof note === 'object' &&
      typeof note.id === 'string' && note.id.trim() && !ids.has(note.id) && ids.add(note.id) &&
      typeof note.body === 'string' && note.body.trim() && typeof note.selector === 'string' && note.selector.trim() &&
      (note.type === undefined || types.includes(note.type)));
  }
  function loadStoredState(storage, key, fallback, fallbackSavedAt = 0) {
    const embedded = {notes:clone(fallback),savedAt:fallbackSavedAt};
    try {
      const saved = JSON.parse(storage.getItem(key));
      if (validStoredNotes(saved) && !fallbackSavedAt) return {notes:clone(saved),savedAt:0};
      if (saved && validStoredNotes(saved.notes) && Number.isFinite(saved.savedAt) && saved.savedAt > fallbackSavedAt) return clone(saved);
    } catch {}
    return embedded;
  }
  function persistNotes(storage, key, notes, savedAt) {
    try {storage.setItem(key,JSON.stringify({notes,savedAt})); return true;} catch {return false;}
  }
  function buildAnnotatedHTML(base, data, runtime) {
    const bytes=Uint8Array.from(atob(base),character=>character.charCodeAt(0));
    const source=new TextDecoder().decode(bytes), serialized=safeJSON(data), closeScript='</scr'+'ipt>';
    const block='<!-- HTML-ANNOTATION-EDITOR:BEGIN -->\n<script id="hae-data" type="application/json">'+serialized+closeScript+'\n<script id="hae-runtime">'+runtime+closeScript+'\n<!-- HTML-ANNOTATION-EDITOR:END -->\n';
    const closings=[...source.matchAll(/<\/body\s*>/ig)], at=closings.length ? closings.at(-1).index : source.length;
    return source.slice(0,at)+block+source.slice(at);
  }
  const listHeaders = ['编号','菜单路径','目标区域','注记类型','注记内容'];
  function annotationTable(notes, menus, doc, exportType = 'simple') {
    if (!['simple','detailed'].includes(exportType)) throw Error('请选择导出类型。');
    const detailed = exportType === 'detailed';
    const rows = [];
    function visit(group,path) {
      const menuPath = [...path,group.label];
      for (const {note,number} of group.notes) {
        let area = note.targetArea && note.targetArea !== note.selector ? note.targetArea : '';
        if (!area) {
          let element; try {const found=doc.querySelectorAll(note.selector); if(found.length===1) element=found[0];} catch {}
          area = element?.getAttribute?.('aria-label') || element?.textContent || note.fingerprint?.text || '未识别区域';
          area = area.replace(/\s+/g,' ').trim().slice(0,100) || '未识别区域';
        }
        const row = [number,(group.id.startsWith('hae:') ? note.menuPath : '') || menuPath.join(' / '),area,note.type || '未设置类型',note.body];
        if (detailed) row.push(note.id,note.pageId || (group.id.startsWith('hae:') ? '' : group.id),note.context ?? '*',note.selector,note.source || '');
        rows.push(row);
      }
      group.children.forEach(child => visit(child,menuPath));
    }
    directoryGroups(notes,menus,doc).forEach(group => visit(group,[]));
    return [detailed ? [...listHeaders,'注记ID','页面ID','页面状态','定位选择器','来源依据'] : listHeaders,...rows.sort((a,b)=>a[0]-b[0])];
  }
  function listMarkdown(table) {
    const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'&#124;').replace(/\r\n?|\n/g,'<br>').replace(/\\/g,'&#92;').replace(/`/g,'&#96;');
    const row = values => '| '+values.map(escape).join(' | ')+' |';
    return '# 注记清单\n\n'+row(table[0])+'\n'+row(table[0].map(()=>'---'))+'\n'+table.slice(1).map(row).join('\n')+'\n';
  }
  // ponytail: a text-only XLSX sheet; add a spreadsheet library only for richer workbook editing.
  function listXLSX(table) {
    const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\r/g,'&#13;');
    if (table.length > 1048576 || table.some(row => row.some(value => String(value).length > 32767))) throw Error('清单超出 Excel 行数或单元格长度限制，请导出 Markdown。');
    const lastColumn = String.fromCharCode(64+table[0].length);
    const sheet = table.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>'<c r="'+String.fromCharCode(65+j)+(i+1)+'" t="inlineStr" s="'+(i===0?1:row[3]==='修改原型'?2:0)+'"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>').join('')+'</row>').join('');
    const files = {
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="注记清单" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font><font><color rgb="FFD92D20"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF20334F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+lastColumn+table.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+[8,32,28,16,80,28,28,24,40,40].slice(0,table[0].length).map((width,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>').join('')+'</cols><sheetData>'+sheet+'</sheetData><autoFilter ref="A1:'+lastColumn+table.length+'"/></worksheet>'
    };
    // ZIP STORE: UTF-8 XML, CRC-32 and central directory; no compression dependency.
    const encoder = new TextEncoder(), chunks = [], central = [];
    let offset = 0;
    const header = size => new Uint8Array(size);
    function crc32(bytes) {let crc = -1; for (const byte of bytes) {crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);} return (crc^-1)>>>0;}
    for (const [path,content] of Object.entries(files)) {
      const name=encoder.encode(path), data=encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+content), crc=crc32(data);
      const local=header(30), lv=new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);
      chunks.push(local,name,data);
      const record=header(46), rv=new DataView(record.buffer);
      rv.setUint32(0,0x02014b50,true);rv.setUint16(4,20,true);rv.setUint16(6,20,true);rv.setUint16(14,33,true);rv.setUint32(16,crc,true);rv.setUint32(20,data.length,true);rv.setUint32(24,data.length,true);rv.setUint16(28,name.length,true);rv.setUint32(42,offset,true);
      central.push(record,name);offset+=local.length+name.length+data.length;
    }
    const centralSize=central.reduce((n,bytes)=>n+bytes.length,0), end=header(22), ev=new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(8,Object.keys(files).length,true);ev.setUint16(10,Object.keys(files).length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);
    const result=new Uint8Array(offset+centralSize+end.length);let at=0;
    for(const bytes of [...chunks,...central,end]){result.set(bytes,at);at+=bytes.length;}
    return result;
  }
  // Array position is the display number; IDs remain stable through insert/delete.
  function insertNote(notes, note, number) {
    if (!Number.isInteger(number) || number < 1 || number > notes.length + 1) throw Error('编号超出范围');
    if (notes.some(item => item.id === note.id)) throw Error('标注 ID 重复');
    const next = clone(notes);
    next.splice(number - 1, 0, clone(note));
    return next;
  }
  function editNote(notes, note, number) {
    const index = notes.findIndex(item => item.id === note.id);
    if (index < 0) throw Error('标注不存在');
    return insertNote(removeNote(notes,note.id),note,number === undefined ? index+1 : number);
  }
  function removeNote(notes, id) { return notes.filter(note => note.id !== id).map(clone); }
  // Read real navigation only; custom JS routers supply the same records through config.menus.
  function discoverMenus(doc, baseURL, onMenu = () => {}) {
    const scope = 'nav,[role="navigation"],[role="menu"],.sidebar,.side-menu,.menu';
    const controls = [...doc.querySelectorAll('a[href],button,summary,[role="menuitem"],[data-page],[data-route],[aria-controls]')]
      .filter(el => el.closest(scope) && !el.closest('#hae-root'));
    const records = [], owners = new Map();
    for (const el of controls) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g,' ').trim();
      if (!label) continue;
      const page = el.getAttribute('data-page') || el.getAttribute('data-route');
      const controlled = el.getAttribute('aria-controls');
      const href = el.getAttribute('href');
      let selector, context;
      if (controlled && doc.getElementById(controlled)) selector = '[id='+JSON.stringify(controlled)+']';
      if (page) context = page;
      if (href && !href.startsWith('javascript:')) {
        let url; try {url = new URL(href, baseURL);} catch {continue;}
        const base = new URL(baseURL);
        if (url.origin !== base.origin || url.pathname !== base.pathname || url.search !== base.search) continue;
        if (url.hash) {
          let anchor; try {anchor = decodeURIComponent(url.hash.slice(1));} catch {anchor = '';}
          if (anchor && doc.getElementById(anchor)) selector = '[id='+JSON.stringify(anchor)+']';
          else context = url.hash;
        }
      }
      const container = el.closest('li,details,[role="menuitem"],.menu-item');
      const isGroup = container && container.querySelector('ul,ol,[role="menu"],.submenu');
      if (!selector && context === undefined && !isGroup) continue;
      let parentId = null;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (owners.has(p)) {parentId = owners.get(p); break;}
      }
      const id = selector ? 'target:'+selector : context !== undefined ? 'route:'+context : 'group:'+parentId+'/'+label;
      if (records.some(item => item.id === id)) continue;
      records.push({id,label,parentId,...(selector ? {selector} : {}),...(context !== undefined ? {context} : {})});
      onMenu(id,el);
      if (container) owners.set(container,id);
    }
    return records;
  }
  function menuForNote(note, menus, doc) {
    if (note.pageId) return menus.find(menu => menu.id === note.pageId) || null;
    if (note.context !== undefined && note.context !== '*') {
      const matching = menus.filter(menu => menu.context === note.context);
      if (matching.length === 1) return matching[0];
    }
    // Never infer a different page from a selector reused by a router.
    if (note.context && note.context !== '*') return null;
    let targets; try {targets = doc.querySelectorAll(note.selector);} catch {return null;}
    if (targets.length !== 1) return null;
    let best = null, bestElement = null;
    for (const menu of menus) {
      if (!menu.selector) continue;
      let areas; try {areas = doc.querySelectorAll(menu.selector);} catch {continue;}
      if (areas.length !== 1 || !areas[0].contains(targets[0])) continue;
      if (!bestElement || bestElement.contains(areas[0])) {best = menu; bestElement = areas[0];}
    }
    return best;
  }
  function directoryGroups(notes, menus, doc) {
    const groups = menus.map(menu => ({...menu,children:[],notes:[]}));
    const map = new Map(groups.map(group => [group.id,group]));
    const roots = [];
    for (const group of groups) {
      let parent = map.get(group.parentId), cursor = parent, seen = new Set([group.id]);
      while (cursor) {if (seen.has(cursor.id)) {parent = null; break;} seen.add(cursor.id); cursor = map.get(cursor.parentId);}
      (parent ? parent.children : roots).push(group);
    }
    const fallback = {id:'hae:unmatched',label:menus.length ? '未匹配页面' : (doc.title || '当前页面'),children:[],notes:[]};
    notes.forEach((note,index) => {
      const menu = menuForNote(note,menus,doc);
      (map.get(menu?.id) || fallback).notes.push({note,number:index+1});
    });
    if (fallback.notes.length || !roots.length) roots.push(fallback);
    return roots;
  }
  function placePopover(rect, width, height, viewport, reserved = {left:0,right:0}) {
    const minX = reserved.left + 12, maxX = Math.max(minX, viewport.width - reserved.right - width - 12);
    const x = Math.min(maxX, Math.max(minX, rect ? rect.left + rect.width/2 - width/2 : (minX+maxX)/2));
    let y = rect ? rect.bottom + 4 : (viewport.height-height)/2;
    if (rect && y + height > viewport.height - 12) y = rect.top-height-4;
    return {x, y:Math.max(12, Math.min(y, viewport.height-height-12))};
  }
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = {insertNote, editNote, removeNote, safeJSON, noteStorageKey, validStoredNotes, loadStoredState, persistNotes, buildAnnotatedHTML, placePopover, discoverMenus, menuForNote, directoryGroups, annotationTable, listMarkdown, listXLSX};
    return;
  }
  if (document.getElementById('hae-root')) return;

  const config = JSON.parse(document.getElementById('hae-data').textContent);
  const storageKey = noteStorageKey(config.base || '');
  const handleKey = storageKey+':'+location.pathname;
  let noteStorage = null; try {noteStorage = window.localStorage;} catch {}
  const stored = loadStoredState(noteStorage,storageKey,config.notes,config.savedAt || 0);
  let notes = stored.notes, hasPageChanges = JSON.stringify(stored.notes) !== JSON.stringify(config.notes), fileHandle = null;
  config.notes = clone(notes); config.savedAt = stored.savedAt;
  document.getElementById('hae-data').textContent = safeJSON(config);
  let selected = null, formNote = null, picking = false, candidate = null, chain = [], depth = 0;
  let shown = true, mode = 'number', dock = 'right', panelView = null, queued = false;
  let restoreFocus = null, acquiringHandle = null, fileWriteQueue = Promise.resolve();
  function openHandleDB() {
    return new Promise((resolve,reject) => {
      const request=indexedDB.open('html-annotation-editor',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('files');
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
  }
  async function readFileHandle() {
    const db=await openHandleDB();
    try {return await new Promise((resolve,reject)=>{const request=db.transaction('files').objectStore('files').get(handleKey);request.onsuccess=()=>resolve(request.result || null);request.onerror=()=>reject(request.error);});}
    finally {db.close();}
  }
  async function rememberFileHandle(handle) {
    const db=await openHandleDB();
    try {await new Promise((resolve,reject)=>{const transaction=db.transaction('files','readwrite');transaction.objectStore('files').put(handle,handleKey);transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);});}
    finally {db.close();}
  }
  readFileHandle().then(handle=>{if (!fileHandle) fileHandle=handle;}).catch(()=>{});
  function writableFileHandle() {
    if (acquiringHandle) return acquiringHandle;
    acquiringHandle=(async()=>{
      if (fileHandle) {
        let permission=await fileHandle.queryPermission({mode:'readwrite'});
        if (permission === 'prompt') permission=await fileHandle.requestPermission({mode:'readwrite'});
        if (permission === 'granted') return fileHandle;
      }
      if (typeof window.showSaveFilePicker !== 'function') throw Error('当前浏览器不支持直接写入 HTML，请使用 Chrome 或 Edge。');
      const suggestedName=decodeURIComponent(location.pathname.split('/').pop() || '已标注.html');
      fileHandle=await window.showSaveFilePicker({suggestedName,types:[{description:'HTML 文件',accept:{'text/html':['.html']}}]});
      rememberFileHandle(fileHandle).catch(()=>{});
      return fileHandle;
    })().finally(()=>{acquiringHandle=null;});
    return acquiringHandle;
  }
  function writeHTMLFile(data) {
    const handle=writableFileHandle(), html=buildAnnotatedHTML(data.base,data,document.getElementById('hae-runtime').textContent);
    fileWriteQueue=fileWriteQueue.catch(()=>{}).then(async()=>{const writable=await (await handle).createWritable();await writable.write(html);await writable.close();});
    return fileWriteQueue;
  }
  const root = document.createElement('div');
  root.id = 'hae-root';
  root.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif!important;color:#172b4d!important;color-scheme:light!important;';
  document.body.append(root);
  const shadow = root.attachShadow({mode: 'open'});
  shadow.innerHTML = `<style>
    :host{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#172b4d;color-scheme:light}
    *{box-sizing:border-box}button,input,textarea,select{font:inherit}button,input,textarea,select,a{pointer-events:auto}
    button{border:1px solid #d7e0ee;background:#fff;color:#264366;border-radius:8px;padding:7px 10px;cursor:pointer}button:hover{background:#eef4ff}button:disabled{opacity:.45;cursor:not-allowed}
    :focus-visible{outline:3px solid #85b0ff;outline-offset:2px}.primary{background:#245eea;color:white;border-color:#245eea}.primary:hover{background:#174bc7}.danger{color:#ba263c}
    .panel{pointer-events:auto;position:fixed;top:50%;right:50px;transform:translateY(-50%);width:280px;max-width:calc(100vw - 64px);max-height:calc(100dvh - 24px);overflow:auto;border:1px solid #e5e5e8;border-radius:10px;background:#fff;box-shadow:0 8px 28px #00000012;z-index:3;font-size:12px}
    .panel.directory{top:0;right:0;bottom:0;transform:none;width:224px;max-height:100dvh;border-radius:0;box-shadow:none}
    header{padding:12px 16px;border-bottom:1px solid #e5e5e8;display:flex;align-items:center;gap:8px}header strong{flex:1;font-size:13px;font-weight:500}
    .section{padding:12px 16px;border-bottom:1px solid #e5ebf3}.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.row>*{min-width:0}label{display:block;color:#52647e;font-size:12px;margin:10px 0 5px}select,input,textarea{width:100%;border:1px solid #ccd7e5;border-radius:8px;padding:8px;background:white;color:#172b4d}textarea{min-height:110px;resize:vertical}input[type=checkbox]{width:auto}
    .help{font-size:12px;color:#8a8a94;margin:7px 0}.status{font-size:12px;color:#656570;white-space:pre-wrap}.list{max-height:calc(100dvh - 95px);overflow:auto;padding:8px}.entry{display:block;width:100%;border:0;border-radius:5px;text-align:left;padding:9px 10px;background:white;color:#494952;font-size:12px}.entry[aria-pressed=true]{background:#d8eee5;color:#202c27}.entry small{display:block;font-size:10px;color:#9999a3;margin-left:24px}.entry b{display:inline-block;width:24px;color:#e76f00;font-weight:500}.body{white-space:pre-wrap;overflow-wrap:anywhere;color:#333;font-size:13px;line-height:1.6}.title{font-size:15px;margin:0 0 8px}.empty{padding:16px;color:#888892;font-size:12px}.foot{font-size:11px;color:#95959e;padding:10px 16px}.actions{margin-top:12px}
    .marker{position:fixed;pointer-events:auto;background:#e76f00;color:white;border:1px solid white;box-shadow:none;border-radius:20px;min-width:28px;min-height:28px;padding:0 6px;font-size:14px;font-weight:600;line-height:26px;max-width:240px;white-space:nowrap;z-index:1}.marker::before{content:'';position:absolute;inset:-4px}.marker:hover,.marker.active{background:#ce6200}.marker.dot{min-width:12px;min-height:12px;width:12px;height:12px;padding:0;font-size:0}.marker.label{overflow:hidden;text-overflow:ellipsis}
    #highlight{position:fixed;border:2px solid #00925b;background:transparent;pointer-events:none;display:none;border-radius:0}#highlight.selecting{background:#00925b09}#targetLabel{position:fixed;max-width:80vw;padding:4px 8px;background:#00764a;color:white;border-radius:4px;font-size:12px;pointer-events:none;z-index:1}
    .popover{position:fixed;pointer-events:auto;width:380px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;border:1px solid #e6e6e8;border-radius:15px;background:#fffffff5;box-shadow:0 18px 48px #00000024;z-index:2;color:#333}.popover header{height:41px;padding:0 16px;justify-content:flex-end;gap:8px}.popover .section{border:0;padding:20px 16px 16px}.note-dot{width:12px;height:12px;background:#e76f00;border-radius:50%}.note-number{font-size:13px;color:#9999a3;font-weight:600}.icon-close{border:0;background:transparent;padding:3px 6px;font-size:19px;line-height:24px;color:#27272d}.popover .body{max-height:45dvh;overflow:auto}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    .popover .actions{justify-content:flex-end;margin-top:8px}.popover .actions button{border:0;background:transparent;padding:2px 6px;font-size:12px;color:#777782}.popover .actions button:hover{background:#f2f2f4}.popover .actions .danger{color:#ba263c}
    .note-fields{display:grid;grid-template-columns:minmax(72px,1fr) minmax(0,2fr);gap:12px}.note-fields label{min-width:0;margin:0}.note-fields input,.note-fields select{display:block;margin-top:5px}
    .form-target-actions,.form-submit-actions{display:grid;gap:8px;margin-top:10px}.form-target-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.form-submit-actions{grid-template-columns:repeat(2,minmax(0,1fr))}.form-target-actions button,.form-submit-actions button{width:100%;min-height:36px;padding:7px 8px;white-space:nowrap}
    .note-type{margin-right:auto;padding:2px 7px;border-radius:4px;background:#f3f4f6;color:#737784;font-size:11px;line-height:18px}
    .menu-group{border-bottom:1px solid #eff0f3}.menu-group summary{cursor:pointer;padding:11px 8px;color:#42464f;overflow-wrap:anywhere}.menu-group summary::marker{color:#9ba1ac}.menu-count{float:right;color:#a1a5af;font-size:11px;margin-left:6px}.menu-children{padding-left:10px;border-left:1px solid #eceef1;margin-left:8px}.entry{margin:3px 0 7px}.entry-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}.entry-head b{width:auto;font-size:14px;font-weight:600}.entry-head span{font-size:11px;color:#808691;background:#f2f3f5;border-radius:4px;padding:1px 5px}.entry-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;color:#626975}.menu-empty{padding:4px 10px 12px;margin:0;color:#a1a5af;font-size:11px}
    .marker[data-type="修改原型"]{background:#d92d20}.marker[data-type="修改原型"]:hover,.marker[data-type="修改原型"].active{background:#b42318}
    .popover[data-type="修改原型"] .note-dot{background:#d92d20}.popover[data-type="修改原型"] .note-number,.entry[data-type="修改原型"] b{color:#d92d20}
    .popover[data-type="修改原型"] .note-type,.entry[data-type="修改原型"] .entry-head span{color:#b42318;background:#fef3f2}.entry[data-type="修改原型"][aria-pressed=true]{background:#fee4e2}
    .tools{position:fixed;right:0;top:50%;transform:translateY(-50%);pointer-events:auto;width:38px;padding:4px 2px;background:white;border:1px solid #e5e5e8;border-right:0;border-radius:12px 0 0 12px;box-shadow:0 3px 16px #00000007;z-index:4}.tools button{display:flex;align-items:center;justify-content:center;width:32px;height:34px;padding:0;border:0;border-radius:6px;background:white}.tools button:hover,.tools button[aria-expanded=true]{background:#f0f5f3}.tools button[aria-pressed=false]{opacity:.45}.tools img{object-fit:contain;pointer-events:none;width:20px;height:20px}
    .hide{display:none!important}
    @media(max-width:600px){.panel{max-height:calc(100dvh - 24px)}.panel.directory{width:224px;max-height:100dvh}.popover .body{max-height:35dvh}}@media(max-width:360px){.form-target-actions{grid-template-columns:repeat(2,minmax(0,1fr))}.form-target-actions #relocate{grid-column:1/-1}}
  </style>
  <div id="markers"></div><div id="highlight"></div><div id="targetLabel" class="hide"></div>
  <aside class="panel hide" aria-label="网页标注控制面板">
    <header><strong id="panelTitle">标注设置</strong><button id="collapse" class="icon-close" aria-label="关闭控制面板">×</button></header>
    <div id="settings" class="section"><div class="row"><label style="margin:0;flex:1"><input id="shown" type="checkbox" checked> 显示标记</label></div>
    <label>展示方式<select id="mode"><option value="number">编号</option><option value="type">编号 + 类型</option><option value="dot">圆点</option></select></label>
    <label>面板位置<select id="dock"><option value="right">右侧</option><option value="left">左侧</option></select></label>
    <label>导出类型<select id="exportType"><option value="simple">简洁（默认）</option><option value="detailed">详细</option></select></label>
    <label>注记清单格式<select id="exportFormat"><option value="md">Markdown（.md）</option><option value="xlsx">Excel（.xlsx）</option></select></label>
    <div class="row actions"><button id="exportList">导出清单</button><button id="hideAll" title="隐藏所有注记和工具栏，刷新页面后恢复">完全隐藏</button></div></div>
    <div id="list" class="list" aria-label="标注目录"></div>
    <div class="foot">本地 HTML · 无需插件</div>
  </aside>
  <article id="popover" class="popover hide" role="dialog" aria-label="标注详情" aria-modal="false">
    <header><span id="noteType" class="note-type" title="注记类型"></span><span class="note-dot" aria-hidden="true"></span><span id="noteNumber" class="note-number"></span><button id="closeNote" class="icon-close" aria-label="关闭注记">×</button></header>
    <section id="detail" class="section hide"></section>
    <form id="form" class="section hide"><h3 id="formTitle" class="title"></h3><div class="note-fields"><label id="numberLabel">编号<input id="number" type="number" min="1" step="1" required></label><label>类型<select id="type" required><option value="" disabled>请选择类型</option><option value="字段说明">字段说明</option><option value="交互逻辑">交互逻辑</option><option value="业务规则">业务规则</option><option value="修改原型">修改原型</option></select></label></div><p id="numberHint" class="help"></p><label>注记内容<textarea id="body" maxlength="20000" required></textarea></label><p id="location" class="help"></p><div id="targetActions" class="form-target-actions"><button type="button" id="parent">上一级区域</button><button type="button" id="child">下一级区域</button><button type="button" id="relocate">重新选择位置</button></div><div id="submitActions" class="form-submit-actions"><button type="button" id="cancelNote">取消</button><button id="confirmNote" type="submit" class="primary">确认添加</button></div></form>
  </article>
  <nav id="tools" class="tools" aria-label="标注工具栏"><button id="add" title="添加标注" aria-label="添加标注"><span style="font-size:24px;font-weight:300;line-height:1;color:#555562" aria-hidden="true">＋</span></button><button id="toolDirectory" title="标注目录" aria-label="标注目录" aria-expanded="false" aria-controls="list"><img id="directoryIcon" alt=""></button><button id="toolNotes" title="显示／隐藏标注" aria-label="显示／隐藏标注" aria-pressed="true"><img id="notesIcon" alt=""></button><button id="toolSettings" title="标注设置" aria-label="标注设置" aria-expanded="false" aria-controls="settings"><img id="settingsIcon" alt=""></button><button id="toolSave" title="保存到 HTML 文件" aria-label="保存到 HTML 文件" style="font-size:11px;border-top:1px solid #e5e5e8;border-radius:0 0 6px 6px">保存</button></nav>
  <p id="status" class="visually-hidden" role="status" aria-live="polite"></p>
  `;
  const $ = id => shadow.getElementById(id);
  const panel = shadow.querySelector('.panel');
  // Toolbar glyphs cropped from the user's second reference screenshot (1892 × 912).
  const icons = {
    directory:'iVBORw0KGgoAAAANSUhEUgAAABMAAAASCAYAAAC5DOVpAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAfUlEQVQ4jcWU0QnAIAxE3SyfHTMfDnTdqEXoFWvRNFHowUE0+IhGTcdCpXoA7G53YSJbyLigN6xMlIRq/lyVah7D2tJHQrNmCGPcOyd4YBxzO3QIZgkeWN2MEtNhGHPTMBhbxm8NQBNPXQ1LsGBLn5METD1+DUKj39ALNqMTN6aCeBUAGmoAAAAASUVORK5CYII=',
    notes:'iVBORw0KGgoAAAANSUhEUgAAABUAAAASCAYAAAC0EpUuAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAv0lEQVQ4jbWUSw6AMAhEuVmXHqcb7+PCA+GNajBOMsHST1QS0qrDA+lHyg8mPYHqUbZtv8bX0JzXktLycEswDVU9LqC5r86A5j24+BcWYMCWARzBpSYeMW6PB4sXjvQMBUBvYG6VsJCzmghCHnmOv8IahFClICTgRDwHFFV/8vvphnKCVwvFrfJx0hJH5iHYvyE0u6bXDkatyi403QcAIxzPvH38IlWhECGYjyYWEt95PnVLlSBh6x6Ygo7aL9ATPH81sZkuA7YAAAAASUVORK5CYII=',
    settings:'iVBORw0KGgoAAAANSUhEUgAAABUAAAAVCAYAAACpF6WWAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAyElEQVQ4jdWUTQ6EIAyFezOWHoeN92ExB8IbYZ6ZmpeXKmg0k2nSiEA/Sn+w9oLYz6A5zy2laVOMH4GmNLVSPptifAta67J/3Us9QPeeQsvXG74uG7LHrnxICOWrMgxjhfscbHjNGOgeKIwTFa2rt6aeKhhANsA/V0BUEaZQP5mNeuuaLBuBaiwvQ7OUkEM8MRyOKJ5DieJ5je9QoiqVB1QBuveoy0w3R4WtHaQl1i1+SC8x3GVDbfrag6ICmBf9Y09fuyj/A10BjqMgrWXbedgAAAAASUVORK5CYII='
  };
  for (const [name,data] of Object.entries(icons)) $(name+'Icon').src = 'data:image/png;base64,'+data;
  const context = () => String(typeof window.htmlAnnotationContext === 'function' ? window.htmlAnnotationContext() : location.hash);
  const expandedMenus = new Set();
  const menuElements = new Map();
  let navigationRequest = 0;
  let directorySignature = '';
  const hostMenus = () => {
    menuElements.clear();
    const menus = discoverMenus(document,location.href,(id,el)=>menuElements.set(id,el));
    for (const menu of config.menus || []) {
      const index = menus.findIndex(item => item.id === menu.id);
      if (index < 0) menus.push(menu); else menus[index] = {...menus[index],...menu};
    }
    return menus;
  };
  const normalize = text => text.replace(/\s+/g, ' ').trim().slice(0, 100);
  const fingerprint = element => ({tag: element.localName, text: normalize(element.textContent || '')});
  function resolve(note) {
    if (note.context !== undefined && note.context !== '*' && note.context !== context()) return null;
    try {
      const found = [...document.querySelectorAll(note.selector)];
      if (found.length !== 1 || found[0] === root || root.contains(found[0])) return null;
      const element = found[0], fp = note.fingerprint;
      if (fp && (fp.tag !== element.localName || (fp.text && fp.text !== normalize(element.textContent || '')))) return null;
      return element;
    } catch { return null; }
  }
  function visibleRect(element) {
    if (!element || !element.isConnected || !element.getClientRects().length) return null;
    const css = getComputedStyle(element), rect = element.getBoundingClientRect();
    if (css.visibility === 'hidden' || css.display === 'none' || +css.opacity === 0 || rect.width < 1 || rect.height < 1) return null;
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (+style.opacity === 0 || style.visibility === 'hidden') return null;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {left = Math.max(left, box.left); right = Math.min(right, box.right);}
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);}
    }
    return right > left && bottom > top ? {left, top, right, bottom, width:right-left, height:bottom-top} : null;
  }
  function selectorFor(element) {
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    for (const attr of ['data-annotation-id', 'data-testid']) {
      const value = element.getAttribute(attr);
      if (value) {
        const selector = '[' + attr + '="' + CSS.escape(value) + '"]';
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
    }
    const parts = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const siblings = [...node.parentElement.children].filter(s => s.localName === node.localName);
      parts.unshift(node.localName + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    }
    return 'body > ' + parts.join(' > ');
  }
  let statusTimer;
  function say(message) {
    $('status').textContent = message;
    $('status').style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);width:max-content;height:auto;clip-path:none;overflow:visible;padding:10px 16px;border:1px solid #e5e5e8;border-radius:8px;background:white;color:#555;font-size:12px;box-shadow:0 6px 24px #00000012;z-index:6;pointer-events:none';
    clearTimeout(statusTimer); statusTimer = setTimeout(() => $('status').removeAttribute('style'), 6000);
  }
  function newButton(text, handler, className = '') {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.className = className; button.onclick = handler; return button;
  }
  function setPanel(view) {
    panelView = view; panel.classList.toggle('hide', !view || picking); panel.classList.toggle('directory',view==='directory');
    $('settings').classList.toggle('hide',view!=='settings'); $('list').classList.toggle('hide',view!=='directory');
    $('panelTitle').textContent = view==='directory' ? '标注目录' : '标注设置';
    $('toolDirectory').setAttribute('aria-expanded',String(view==='directory')); $('toolSettings').setAttribute('aria-expanded',String(view==='settings'));
    panel.style.left = dock==='left' ? (view==='directory' ? '0' : '50px') : 'auto';
    panel.style.right = dock==='right' ? (view==='directory' ? '0' : '50px') : 'auto';
    const offset = view==='directory' && !picking ? panel.getBoundingClientRect().width : 0;
    $('tools').style.right = dock==='right' ? offset+'px' : 'auto'; $('tools').style.left = dock==='left' ? offset+'px' : 'auto';
    $('tools').style.borderRadius = dock==='right' ? '12px 0 0 12px' : '0 12px 12px 0';
    schedule();
  }
  async function navigateToMenu(menu, note) {
    if (!menu) throw Error('未识别所属页面，请重新选择注记位置。');
    if (typeof window.htmlAnnotationNavigate === 'function') {
      await window.htmlAnnotationNavigate(menu.id,note || {context:menu.context});
      return;
    }
    const control = menuElements.get(menu.id);
    if (control && control.localName !== 'summary' && !control.disabled) {control.click(); return;}
    throw Error('此页面尚未配置跳转，请补充原型的页面导航适配。');
  }
  async function openPage(menu) {
    if (formNote || picking) {say('请先保存或取消当前注记。'); return;}
    ++navigationRequest; selected = null; render();
    try {hostMenus(); await navigateToMenu(menu); schedule();}
    catch (error) {say(error.message);}
  }
  async function openNote(id, forceNavigation = false) {
    if (formNote || picking) {say('请先保存或取消当前注记。'); return;}
    const note = notes.find(item => item.id===id); if (!note) return;
    const request = ++navigationRequest;
    const cancelled = () => request !== navigationRequest || !!formNote || picking || root.style.display === 'none';
    let target = resolve(note);
    selected = null; render();
    try {
      if (forceNavigation || !target || !target.getClientRects().length) {
        const menu = menuForNote(note,hostMenus(),document);
        await navigateToMenu(menu,note);
      }
      // Wait for host routing/re-rendering; the latest directory click wins.
      const deadline = Date.now()+2000;
      do {
        await new Promise(done=>setTimeout(done,25));
        if (cancelled()) return;
        target = resolve(note);
        if (target && target.getClientRects().length) break;
      } while (Date.now()<deadline);
      if (target && target.getClientRects().length) target.scrollIntoView({block:'center',behavior:'instant'});
      else say('页面已切换，但目标尚不可见；已打开注记内容，请检查页面状态或位置。');
    } catch (error) {if (!cancelled()) say(error.message);}
    if (cancelled()) return;
    selected = id; shown = true; $('shown').checked = true; $('toolNotes').setAttribute('aria-pressed','true');
    if (innerWidth < 700) setPanel(null);
    render();
  }
  function commitNotes(next) {
    const updated = {...config, notes:clone(next), savedAt:Date.now()};
    document.getElementById('hae-data').textContent = safeJSON(updated);
    notes = next; config.notes = updated.notes; config.savedAt = updated.savedAt;
    persistNotes(noteStorage,storageKey,updated.notes,updated.savedAt);
    hasPageChanges = true;
  }
  async function saveFile() {
    if (formNote || picking) {say('请先确认或取消当前注记，再保存文件。'); return;}
    const button = $('toolSave');
    if (button.disabled) return;
    const snapshot = clone(config);
    button.disabled = true;
    say('正在保存文件…');
    try {
      await writeHTMLFile(snapshot);
      hasPageChanges = JSON.stringify(config.notes) !== JSON.stringify(snapshot.notes);
      window.alert(hasPageChanges ? '保存成功。保存期间产生的新修改尚未保存，请再次点击保存。' : '保存成功，注记已写入所选 HTML 文件。');
      say(hasPageChanges ? '有新的修改尚未保存。' : '保存成功。');
    } catch (error) {
      const message = error.name === 'AbortError' ? '已取消保存，修改尚未写入文件。' : '保存失败：'+error.message;
      say(message); window.alert(message);
    } finally {button.disabled = false;}
  }
  function renderDetail() {
    const note = notes.find(item => item.id === selected), detail = $('detail');
    detail.replaceChildren(); detail.classList.toggle('hide', !note || !!formNote || picking);
    if (!note) return;
    const body = document.createElement('div'); body.className = 'body'; body.textContent = note.body;
    detail.append(body);
    if (!visibleRect(resolve(note))) {const warning = document.createElement('p'); warning.className = 'help'; warning.textContent = '目标当前不可见，请检查页面状态或重新选择位置。'; detail.prepend(warning);}
    const row = document.createElement('div'); row.className = 'row actions';
    row.append(newButton('编辑', () => startEdit(note)));
    row.append(newButton('删除', () => {
      const confirmRow = document.createElement('div'); confirmRow.className = 'row actions';
      confirmRow.append('删除后后续编号补齐。', newButton('确认删除', () => {commitNotes(removeNote(notes, note.id)); selected = null; render(); say('注记已删除，请点击工具栏底部的保存写入文件。');}, 'danger'), newButton('保留', renderDetail));
      row.replaceWith(confirmRow);
    }, 'danger'));
    detail.append(row);
  }
  function renderDirectory() {
    const groups = directoryGroups(notes,hostMenus(),document);
    const signature = JSON.stringify([groups,selected]);
    if (signature === directorySignature) return;
    directorySignature = signature;
    const list = $('list'); list.replaceChildren();
    const countNotes = group => group.notes.length + group.children.reduce((sum,child) => sum+countNotes(child),0);
    function appendGroup(group, parent) {
      const details = document.createElement('details'); details.className = 'menu-group'; details.open = expandedMenus.has(group.id);
      const summary = document.createElement('summary'); summary.append(group.label);
      const count = document.createElement('span'); count.className = 'menu-count'; count.textContent = countNotes(group);
      summary.append(count); details.append(summary);
      summary.onclick = event => {
        if (formNote || picking) {event.preventDefault(); say('请先保存或取消当前注记。'); return;}
        if (details.open) return;
        expandedMenus.add(group.id);
        if (group.notes.length) openNote(group.notes[0].note.id,true);
        else if (group.selector || group.context !== undefined) openPage(group);
      };
      details.ontoggle = () => {if (details.open) expandedMenus.add(group.id); else expandedMenus.delete(group.id);};
      for (const {note,number} of group.notes) {
        const entry = newButton('', () => openNote(note.id), 'entry'); entry.setAttribute('aria-pressed',String(selected === note.id)); entry.setAttribute('data-type',note.type || '');
        const header = document.createElement('div'); header.className = 'entry-head';
        const num = document.createElement('b'); num.textContent = number;
        const type = document.createElement('span'); type.textContent = note.type || '未设置类型';
        header.append(num,type);
        const body = document.createElement('div'); body.className = 'entry-body'; body.textContent = note.body;
        entry.append(header,body); details.append(entry);
      }
      if (group.children.length) {
        const children = document.createElement('div'); children.className = 'menu-children';
        group.children.forEach(child => appendGroup(child,children)); details.append(children);
      } else if (!group.notes.length) {
        const empty = document.createElement('p'); empty.className = 'menu-empty'; empty.textContent = '暂无注记'; details.append(empty);
      }
      parent.append(details);
    }
    groups.forEach(group => appendGroup(group,list));
  }
  function render() {
    $('add').disabled = !!formNote || picking;
    $('exportList').disabled = !!formNote || picking;
    $('form').classList.toggle('hide', !formNote || picking);
    $('popover').classList.toggle('hide', picking || (!formNote && (!selected || !shown)));
    $('noteNumber').textContent = '#' + (formNote ? $('number').value : notes.findIndex(note=>note.id===selected)+1);
    $('noteType').textContent = (formNote ? $('type').value : notes.find(note=>note.id===selected)?.type) || '未设置类型';
    $('popover').setAttribute('data-type',$('noteType').textContent);
    renderDirectory();
    renderDetail(); schedule();
  }
  function layout() {
    queued = false;
    const markers = $('markers'); markers.replaceChildren();
    if (shown && !picking) {
      const occupied = [];
      notes.forEach((note,index) => {
        const target = resolve(note), rect = visibleRect(target); if (!rect) return;
        // Check the host stack before adding a marker so overlays do not leak background notes.
        const hit = document.elementsFromPoint(rect.left + Math.min(8, rect.width/2), rect.top + Math.min(8, rect.height/2)).find(el => el !== root);
        if (hit && !target.contains(hit) && !hit.contains(target)) return;
        const type = note.type || '未设置类型';
        const text = mode === 'type' ? (index+1) + ' ' + type : String(index+1);
        const marker = newButton(text, () => openNote(note.id), 'marker' + (mode === 'dot' ? ' dot' : mode==='type' ? ' label' : '') + (selected === note.id ? ' active' : ''));
        marker.setAttribute('aria-label', '标注 ' + (index+1) + '：' + type); marker.title = type; marker.setAttribute('data-type',type);
        let x = Math.min(innerWidth - 30, Math.max(2, rect.left - 12)), y = Math.max(2, rect.top - 14);
        // ponytail: local marker stacking; use a spatial layout engine only for very dense review pages.
        while (occupied.some(p => Math.abs(p.x-x)<32 && Math.abs(p.y-y)<32)) y += 32;
        y = Math.min(innerHeight-30, y); occupied.push({x,y}); marker.style.left = x+'px'; marker.style.top = y+'px'; markers.append(marker);
        const width = marker.getBoundingClientRect().width; marker.style.left = Math.max(2, Math.min(x, innerWidth-width-4))+'px';
      });
    }
    paintTarget();
    positionPopover();
    renderDirectory();
  }
  function schedule() {if (root.style.display !== 'none' && !queued) {queued = true; requestAnimationFrame(layout);}}
  function positionPopover() {
    const popup = $('popover'); if (popup.classList.contains('hide')) return;
    const note = formNote || notes.find(note=>note.id===selected);
    const rect = visibleRect(candidate || (note && resolve(note)));
    const reserved = {left:0,right:0};
    if (panelView && innerWidth >= 900 && !picking) reserved[dock] = panel.getBoundingClientRect().width + (panelView==='directory' ? 38 : 62);
    popup.style.maxWidth = Math.max(1,innerWidth-reserved.left-reserved.right-24)+'px';
    const box = popup.getBoundingClientRect();
    const point = placePopover(rect,box.width,box.height,{width:innerWidth,height:innerHeight},reserved);
    popup.style.left = point.x+'px'; popup.style.top = point.y+'px';
  }
  function paintTarget() {
    const note = notes.find(note=>note.id===selected);
    const target = picking || formNote ? candidate : (shown && note && resolve(note));
    const rect = visibleRect(target), high = $('highlight'), label = $('targetLabel');
    high.classList.toggle('selecting',picking || !!formNote);
    high.style.display = rect ? 'block' : 'none'; label.classList.toggle('hide', !rect || (!picking && !formNote));
    if (!rect) return;
    high.style.cssText = `display:block;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    label.textContent = target.localName + (target.id ? ' #' + target.id : '') + ' · ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
    label.style.left = rect.left+'px'; label.style.top = Math.max(0,rect.top-28)+'px';
  }
  function chooseChain(element) {
    chain = [];
    for (let node = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (node !== root && !['script','style','meta','link'].includes(node.localName) && visibleRect(node)) chain.push(node);
    }
    depth = 0; candidate = chain[0] || null; paintTarget(); updateTargetControls();
  }
  function updateTargetControls() {
    $('parent').disabled = !formNote || !candidate || depth >= chain.length-1;
    $('child').disabled = !formNote || !candidate || depth === 0;
  }
  function beginPick() {
    ++navigationRequest;
    picking = true; candidate = null; chain = []; restoreFocus = shadow.activeElement;
    panel.classList.add('hide'); $('tools').classList.add('hide'); $('popover').classList.add('hide');
    say('移动鼠标识别区域，单击后直接填写注记；Esc 取消。'); schedule();
  }
  function endPick() {picking = false; $('tools').classList.remove('hide'); setPanel(null); updateTargetControls(); render();}
  function cancelPick() {candidate = null; endPick(); if (restoreFocus && restoreFocus.isConnected) restoreFocus.focus();}
  function startEdit(note) {
    ++navigationRequest;
    setPanel(null);
    formNote = clone(note); candidate = null; chain = []; depth = 0;
    const target = resolve(note); if (target) chooseChain(target);
    $('formTitle').textContent = '编辑注记'; $('body').value = note.body; $('type').value = note.type || '';
    $('confirmNote').textContent = '保存修改';
    configureNumber(note);
    $('location').textContent = '位置：' + note.selector;
    render(); $('body').focus();
  }
  function configureNumber(note) {
    $('number').value = note ? notes.findIndex(n => n.id === note.id)+1 : notes.length+1;
    $('number').max = notes.length+(note ? 0 : 1);
    $('number').disabled = false;
    $('numberHint').textContent = note ? '可输入 1～'+notes.length+'；保存后其他注记编号自动前移或顺延。' : '插入到此编号，原编号及后续标注自动顺延。';
  }
  function acceptTarget() {
    if (!candidate || !visibleRect(candidate)) {say('选区已失效，请重新选择。'); return;}
    const selector = selectorFor(candidate);
    if (!formNote) {
      formNote = {id:'note-'+crypto.randomUUID(), body:'', selector, context:context(), fingerprint:fingerprint(candidate), source:'手动添加'};
      $('formTitle').textContent = '添加注记'; $('body').value = ''; $('type').value = ''; configureNumber(null);
      $('confirmNote').textContent = '确认添加';
    } else Object.assign(formNote, {selector, context:context(), fingerprint:fingerprint(candidate)});
    const menus = hostMenus();
    const page = menuForNote({selector,context:context()},menus,document) || menuForNote({selector},menus,document);
    delete formNote.pageId;
    if (page) {formNote.pageId = page.id; if (page.selector && page.context === undefined) formNote.context = '*';}
    $('location').textContent = '位置：' + selector;
    endPick(); $('body').focus();
  }
  $('parent').onclick = () => {if (depth < chain.length-1) {candidate = chain[++depth]; acceptTarget();}};
  $('child').onclick = () => {if (depth > 0) {candidate = chain[--depth]; acceptTarget();}};
  $('form').onsubmit = event => {
    event.preventDefault();
    const body = $('body').value.trim(), type = $('type').value;
    if (!['字段说明','交互逻辑','业务规则','修改原型'].includes(type)) {say('请选择注记类型。'); return;}
    if (!body) {say('注记内容不能为空。'); return;}
    const note = {...formNote, body, type};
    delete note.title;
    if (!resolve(note)) {say('目标已变化或不唯一，请重新选择位置。'); return;}
    const exists = notes.some(n => n.id === note.id);
    try {commitNotes(exists ? editNote(notes,note,Number($('number').value)) : insertNote(notes,note,Number($('number').value)));}
    catch (error) {say(error.message); return;}
    selected = null; formNote = null; candidate = null; chain = []; render();
    say((exists ? '注记已更新' : '注记已添加')+'，请点击工具栏底部的保存写入文件。');
  };
  $('cancelNote').onclick = () => {formNote = null; candidate = null; chain = []; render();};
  $('relocate').onclick = beginPick;
  $('add').onclick = beginPick;
  $('exportList').onclick = () => {
    if (formNote || picking) return;
    try {
      const table = annotationTable(notes,hostMenus(),document,$('exportType').value), format = $('exportFormat').value;
      if (!['md','xlsx'].includes(format)) throw Error('请选择导出格式。');
      const content = format === 'md' ? listMarkdown(table) : listXLSX(table);
      const blob = new Blob([content],{type:format==='md'?'text/markdown;charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = (document.title || '网页').replace(/[\\/:*?"<>|]/g,'-')+'-注记清单.'+format;
      shadow.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
      say('已发起注记清单下载，请确认文件已落盘。');
    } catch (error) {say('清单导出失败：'+error.message);}
  };
  $('shown').onchange = () => {shown = $('shown').checked; $('toolNotes').setAttribute('aria-pressed',String(shown)); render();};
  $('mode').onchange = () => {mode = $('mode').value; schedule();};
  $('dock').onchange = () => {dock = $('dock').value; setPanel(panelView);};
  $('collapse').onclick = () => setPanel(null);
  $('hideAll').onclick = () => {
    ++navigationRequest;
    picking = false;
    shadow.activeElement?.blur();
    root.style.setProperty('display', 'none', 'important');
  };
  $('toolDirectory').onclick = () => setPanel(panelView==='directory' ? null : 'directory');
  $('toolSettings').onclick = () => {setPanel(panelView==='settings' ? null : 'settings'); if (innerWidth<900 && !formNote) {selected=null;render();}};
  $('toolNotes').onclick = () => {$('shown').checked=!shown; $('shown').onchange();};
  $('toolSave').onclick = saveFile;
  $('closeNote').onclick = () => {if (formNote && !confirm('取消当前注记的未保存修改？')) return; ++navigationRequest;selected=null;formNote=null;candidate=null;render();};
  $('number').oninput = () => {$('noteNumber').textContent = '#'+$('number').value;};
  $('type').onchange = () => {$('noteType').textContent = $('type').value || '未设置类型'; $('popover').setAttribute('data-type',$('type').value);};
  new ResizeObserver(schedule).observe($('popover'));
  const ownEvent = event => event.composedPath().includes(root);
  const pointerTarget = (x,y) => document.elementsFromPoint(x,y).find(el => el !== root && !root.contains(el));
  document.addEventListener('pointermove', event => {if (picking && !ownEvent(event)) {chooseChain(pointerTarget(event.clientX,event.clientY));}}, true);
  for (const type of ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','contextmenu']) document.addEventListener(type, event => {
    if (!picking || ownEvent(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (type === 'click') {chooseChain(pointerTarget(event.clientX,event.clientY)); if (candidate) acceptTarget();}
  }, true);
  document.addEventListener('keydown', event => {
    if (!picking) return;
    if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); cancelPick(); return;}
    if (ownEvent(event)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopImmediatePropagation();
      chooseChain(document.activeElement); if (candidate) acceptTarget();
    }
  }, true);
  window.addEventListener('beforeunload', event => {if (hasPageChanges || formNote) {event.preventDefault(); event.returnValue = '';}});
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
  window.addEventListener('hashchange', schedule); window.addEventListener('popstate', schedule);
  document.addEventListener('transitionend', schedule, true); document.addEventListener('animationend', schedule, true);
  const observer = new MutationObserver(records => {if (records.some(r => r.target !== root && !root.contains(r.target))) schedule();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  window.HTMLAnnotationEditor = {refresh: schedule};
  render();
})();
