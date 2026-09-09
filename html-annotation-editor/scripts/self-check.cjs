/* Run with Node.js; only standard libraries. Temporary artifacts are removed. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const vm = require('node:vm');
const {insertNote, editNote, removeNote, safeJSON, noteStorageKey, validStoredNotes, loadStoredState, persistNotes, buildAnnotatedHTML, placePopover, discoverMenus, menuForNote, directoryGroups, annotationTable, listMarkdown, listXLSX} = require('../assets/editor.js');

// This skill uses only plain scalar frontmatter, so validate it without PyYAML.
const skill = fs.readFileSync(path.join(__dirname,'../SKILL.md'),'utf8');
const frontmatter = skill.match(/^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---/);
assert(frontmatter, 'Skill frontmatter must declare a plain name and description');
assert.equal(frontmatter[1], 'html-annotation-editor');
assert(frontmatter[1].length <= 64 && frontmatter[2].length <= 1024 && !/[<>]/.test(frontmatter[2]));
for (const match of skill.matchAll(/\]\((references\/[^)]+)\)/g)) assert(fs.existsSync(path.join(__dirname,'..',match[1].split('#')[0])));

const original = [{id:'a',title:'A'}, {id:'b',title:'B'}, {id:'c',title:'C'}];
const inserted = insertNote(original,{id:'new',title:'新标注'},2);
assert.deepEqual(inserted.map(n=>n.id), ['a','new','b','c']);
assert.deepEqual(original.map(n=>n.id), ['a','b','c']);
assert.deepEqual(removeNote(inserted,'new'),original);
assert.deepEqual(removeNote(original,'a').map(n=>n.id),['b','c']);
assert.equal(insertNote([], {id:'first'},1).length,1);
for (const invalid of [0,-1,5,1.1,NaN,Infinity]) assert.throws(()=>insertNote(original,{id:'x'},invalid));
assert.throws(()=>insertNote(original,{id:'a'},1));
const edited = editNote(original,{id:'b',title:'修改后的标题'});
assert.deepEqual(edited.map(n=>n.id),['a','b','c']);
assert.equal(edited[1].title,'修改后的标题');
assert.equal(original[1].title,'B');
assert.throws(()=>editNote(original,{id:'missing'}));
for (const item of original) for (const number of [1,2,3]) {
  const moved=editNote(original,{...item,body:'更新内容',selector:'#target'},number);
  assert.equal(moved.length,original.length);
  assert.equal(moved[number-1].id,item.id);assert.equal(moved[number-1].body,'更新内容');
  assert.deepEqual(moved.filter(n=>n.id!==item.id),original.filter(n=>n.id!==item.id));
  assert.deepEqual(original.map(n=>n.id),['a','b','c']);
}
for(const invalid of [0,-1,4,1.5,NaN,Infinity,null]) assert.throws(()=>editNote(original,original[1],invalid));
assert.equal(editNote([{id:'only'}],{id:'only',body:'一条'},1)[0].body,'一条');


for (const vw of [1892,1440,1200,1024,768,390,375]) {
  const vh=800;
  for (const reserved of [{left:0,right:0}, ...(vw>=900 ? [{left:262,right:0},{left:0,right:342}] : [])]) {
    const width=Math.min(380,vw-reserved.left-reserved.right-24), height=250;
    for (const rect of [null,{left:0,top:0,bottom:35,width:45},{left:vw-50,top:750,bottom:780,width:50},{left:vw/4,top:150,bottom:240,width:vw/2}]) {
      const p=placePopover(rect,width,height,{width:vw,height:vh},reserved);
      assert(p.x>=reserved.left+12 && p.x+width<=vw-reserved.right-12);
      assert(p.y>=12 && p.y+height<=vh-12);
    }
  }
}
const anchored=placePopover({left:100,top:100,bottom:180,width:600},380,140,{width:1200,height:800});
assert.deepEqual(anchored,{x:210,y:184});
const editorSource=fs.readFileSync(path.join(__dirname,'../assets/editor.js'),'utf8');
const embeddedNotes=[{id:'embedded',body:'内嵌注记',selector:'#target'}];
const savedNotes=[{id:'saved',body:'已保存注记',selector:'#target',type:'交互逻辑'}];
const savedStorage={value:JSON.stringify(savedNotes),getItem(){return this.value;},setItem(key,value){this.key=key;this.value=value;}};
assert.equal(noteStorageKey('same-base'),noteStorageKey('same-base'));
assert.notEqual(noteStorageKey('same-base'),noteStorageKey('other-base'));
assert.deepEqual(loadStoredState(savedStorage,noteStorageKey('same-base'),embeddedNotes),{notes:savedNotes,savedAt:0});
savedStorage.value='{broken';
assert.deepEqual(loadStoredState(savedStorage,noteStorageKey('same-base'),embeddedNotes),{notes:embeddedNotes,savedAt:0});
savedStorage.value=JSON.stringify([{id:'bad',body:'',selector:'#target'}]);
assert.equal(validStoredNotes(JSON.parse(savedStorage.value)),false);
assert.deepEqual(loadStoredState(savedStorage,noteStorageKey('same-base'),embeddedNotes),{notes:embeddedNotes,savedAt:0});
savedStorage.value=JSON.stringify({notes:savedNotes,savedAt:20});
assert.deepEqual(loadStoredState(savedStorage,'key',embeddedNotes,10),{notes:savedNotes,savedAt:20});
assert.deepEqual(loadStoredState(savedStorage,'key',embeddedNotes,30),{notes:embeddedNotes,savedAt:30});
assert.equal(persistNotes(savedStorage,'key',savedNotes,40),true);
assert.deepEqual(JSON.parse(savedStorage.value),{notes:savedNotes,savedAt:40});
assert.equal(persistNotes({setItem(){throw Error('quota');}},'key',savedNotes,40),false);
const sourceHTML='<!doctype html><html><body><p>原型</p></body></html>', runtime='console.log("runtime")';
const fileData={version:1,base:Buffer.from(sourceHTML).toString('base64'),notes:savedNotes,savedAt:40};
const rebuilt=buildAnnotatedHTML(fileData.base,fileData,runtime);
assert(rebuilt.includes('<p>原型</p><!-- HTML-ANNOTATION-EDITOR:BEGIN -->'));
assert.deepEqual(JSON.parse(rebuilt.match(/<script id="hae-data" type="application\/json">([\s\S]*?)<\/script>/)[1]),fileData);
assert.equal(rebuilt.match(/<script id="hae-runtime">([\s\S]*?)<\/script>/)[1],runtime);
const unloadBody=editorSource.match(/window\.addEventListener\('beforeunload', event => \{([\s\S]*?)\}\);/)[1];
function unloadProtected(hasPageChanges,formNote) {
  const event={prevented:false,preventDefault(){this.prevented=true;},returnValue:null};
  vm.runInNewContext('(function(){'+unloadBody+'})()', {hasPageChanges,formNote,event});
  return event.prevented;
}
assert.equal(unloadProtected(false,null),false);
assert.equal(unloadProtected(false,{body:'尚未确认'}),true);
assert.equal(unloadProtected(true,null),true);
// Exercise the actual asynchronous save boundary, including edits made during a write.
const saveSource=editorSource.match(/async function saveFile\(\) \{[\s\S]*?\n  \}/)[0];
execFileSync(process.execPath,['-e',`
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(0,'utf8');
(async()=>{
 const button={disabled:false},alerts=[];
 let finish,writes=0;
 const state={config:{notes:[{id:'a',body:'new'}]},hasPageChanges:true,formNote:null,picking:false,
 clone:structuredClone,$:()=>button,say(){},window:{alert:message=>alerts.push(message)},
 writeHTMLFile:()=>{writes++;return new Promise(resolve=>{finish=resolve;});}};
 vm.createContext(state);vm.runInContext(source,state);
 let pending=state.saveFile();assert(button.disabled);assert(state.hasPageChanges);assert.equal(alerts.length,0);
 await state.saveFile();assert.equal(writes,1);
 finish();await pending;assert.equal(state.hasPageChanges,false);assert(!button.disabled);assert(alerts.at(-1).includes('保存成功'));
 state.hasPageChanges=true;pending=state.saveFile();state.config.notes[0].body='newer';finish();await pending;assert(state.hasPageChanges);
 state.writeHTMLFile=async()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'});};
 await state.saveFile();assert(state.hasPageChanges);assert(!button.disabled);assert(alerts.at(-1).includes('取消保存'));
 state.writeHTMLFile=async()=>{throw Error('disk full');};await state.saveFile();assert(state.hasPageChanges);assert(alerts.at(-1).includes('保存失败'));
 state.formNote={};state.writeHTMLFile=()=>{throw Error('must not save incomplete form');};await state.saveFile();
 console.log('PASS: manual save, pending/failed writes, repeat-click guard and edits during save.');
})().catch(error=>{console.error(error);process.exitCode=1;});
`],{input:saveSource,stdio:['pipe','inherit','inherit']});
// Verify the delivered demo's actual menu DOM, route switching and note grouping.
const demoPath=path.join(__dirname,'../../网页标注编辑器-交互示例.html');
if (fs.existsSync(demoPath)) {
  const demo=fs.readFileSync(demoPath,'utf8');
  const payload=JSON.parse(demo.match(/<script id="hae-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const base=Buffer.from(payload.base,'base64').toString();
  const records=JSON.parse(execFileSync('python3',['-c',`
from html.parser import HTMLParser
import sys,json
class Read(HTMLParser):
 def __init__(self):super().__init__();self.nodes=[];self.stack=[]
 def handle_starttag(self,tag,attrs):
  self.nodes.append(dict(tag=tag,attrs=dict(attrs),parent=self.stack[-1] if self.stack else None,text=''))
  if tag not in ('input','img','br','hr','meta','link'):self.stack.append(len(self.nodes)-1)
 def handle_endtag(self,tag):
  if self.stack and self.nodes[self.stack[-1]]['tag']==tag:self.stack.pop()
 def handle_data(self,text):
  for i in self.stack:self.nodes[i]['text']+=text
p=Read();p.feed(sys.stdin.read());print(json.dumps(p.nodes))
`],{input:base,encoding:'utf8'}));
  const nodes=records.map(r=>({...r,textContent:r.text,dataset:{page:r.attrs['data-page'],demoPage:r.attrs['data-demo-page']},
    getAttribute(key){return this.attrs[key]??null;},setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];}}));
  for(const node of nodes){
    node.parentElement=node.parent===null?null:nodes[node.parent];
    node.contains=other=>{for(let p=other;p;p=p.parentElement)if(p===node)return true;return false;};
    node.closest=selector=>{for(let p=node;p;p=p.parentElement){
      if(selector==='#hae-root')return null;
      if(selector.startsWith('nav') && p.tag==='nav')return p;
      if(selector.startsWith('li,') && ['li','details'].includes(p.tag))return p;
    }return null;};
    node.querySelector=()=>nodes.find(n=>['ul','ol'].includes(n.tag)&&node.contains(n))||null;
  }
  const pages=nodes.filter(n=>n.dataset.demoPage),links=nodes.filter(n=>n.tag==='a'&&n.dataset.page);
  const doc={title:'网页标注交互示例',getElementById:id=>nodes.find(n=>n.attrs.id===id),querySelectorAll(selector){
    if(selector==='[data-demo-page]')return pages;
    if(selector==='.sidebar a[data-page]')return links;
    if(selector.startsWith('a[href]'))return nodes.filter(n=>['a','summary','button'].includes(n.tag));
    const id=selector.startsWith('#')?selector.slice(1):selector.match(/^\[id="(.+)"\]$/)?.[1];
    return nodes.filter(n=>n.attrs.id===id);
  }};
  const detected=discoverMenus(doc,'file:///demo.html');
  assert.deepEqual(detected.map(m=>m.label),['项目管理','项目概览','项目列表','交互说明']);
  const groups=directoryGroups(payload.notes,detected,doc);
  assert.deepEqual(groups[0].children.map(g=>g.notes.map(n=>n.number)),[[1],[2,3]]);
  assert.deepEqual(groups[1].notes.map(n=>n.number),[4]);
  const hostScript=base.match(/<script>([\s\S]*?)<\/script>/)[1];
  execFileSync('node',['--check'],{input:hostScript});
  const state={document:doc,location:{hash:''},window:{HTMLAnnotationEditor:{refresh(){}}}};
  vm.createContext(state);
  vm.runInContext(hostScript.match(/function showDemoPage\(\) \{[\s\S]*?\n\}/)[0],state);
  for(const [hash,expected] of [['','#/projects'],['#/overview','#/overview'],['#/guide','#/guide'],['#/projects','#/projects'],['#missing','#/projects']]){
    state.location.hash=hash;vm.runInContext('showDemoPage()',state);
    assert.deepEqual(pages.filter(p=>!p.hidden).map(p=>p.dataset.demoPage),[expected]);
    assert.deepEqual(links.filter(l=>l.attrs['aria-current']==='page').map(l=>l.dataset.page),[expected]);
    assert.equal(state.window.htmlAnnotationContext(),expected);
  }
  assert.equal(demo.match(/<script id="hae-runtime">([\s\S]*?)<\/script>/)[1],editorSource);
}
// Minimal host fixture: nested navigation, same-label routes, deepest anchor, unrelated link.
const area={contains:el=>[area,inner,target].includes(el)};
const inner={contains:el=>[inner,target].includes(el)};
const target={};
const nav={};
const groupContainer={parentElement:nav};
function control(label,attrs,container=groupContainer,group=false,inNav=true) {
  return {textContent:label,parentElement:container,
    getAttribute:key=>attrs[key] ?? null,
    closest(selector){if(selector==='#hae-root')return null;if(selector.startsWith('nav'))return inNav?nav:null;return {...container,querySelector:()=>group?{}:null};}};
}
// closest() must return the actual container so parent hierarchy uses stable DOM identity.
const group=control('项目管理',{},groupContainer,true);
groupContainer.querySelector=()=>({});group.closest=s=>s==='#hae-root'?null:s.startsWith('nav')?nav:groupContainer;
const listContainer={parentElement:groupContainer};
const listControl=control('列表',{href:'#area'},listContainer);
const detailControl=control('详情',{href:'#inner'},listContainer);
const routeA=control('配置',{'data-route':'#route-a'},listContainer);
const routeB=control('配置',{'data-route':'#route-b'},listContainer);
const outside=control('站外',{href:'https://example.com/'},listContainer);
const unrelated=control('删除',{},listContainer,false,false);
const host={title:'示例页面',getElementById:id=>({area,inner}[id]),querySelectorAll(selector){
  if(selector.startsWith('a[href]'))return [group,listControl,detailControl,routeA,routeB,outside,unrelated];
  return {'[id="area"]':[area],'[id="inner"]':[inner],'#target':[target],'#missing':[]}[selector] || [];
}};
const menus=discoverMenus(host,'file:///demo.html');
assert.deepEqual(menus.map(m=>m.label),['项目管理','列表','详情','配置','配置']);
assert.equal(menus[1].parentId,menus[0].id);assert.equal(menus[4].parentId,menus[0].id);
assert.notEqual(menus[3].id,menus[4].id);
assert.equal(menuForNote({selector:'#target'},menus,host).id,menus[2].id);
assert.equal(menuForNote({selector:'#target',context:'#route-a'},menus,host).id,menus[3].id);
assert.equal(menuForNote({selector:'#target',context:'#unknown'},menus,host),null);
assert.equal(menuForNote({selector:'#target',pageId:'missing'},menus,host),null);
const directoryNotes=[{id:'a',selector:'#target',body:'完整内容\n第二行',type:'字段说明'},
  {id:'b',selector:'#target',context:'#route-b',body:'待产研修改原型',type:'修改原型'},
  {id:'c',selector:'#missing',body:'保留未匹配注记'}];
const tree=directoryGroups(directoryNotes,menus,host);
assert.equal(tree[0].children[1].notes[0].number,1);
assert.equal(tree[0].children[3].notes[0].note.id,'b');
assert.equal(tree[1].label,'未匹配页面');assert.equal(tree[1].notes[0].number,3);
assert.equal(directoryGroups(directoryNotes,[],host)[0].label,'示例页面');
assert.equal(directoryGroups([],menus,host)[0].children.length,4);
assert.equal(directoryGroups(removeNote(directoryNotes,'a'),menus,host)[0].children[3].notes[0].number,1);
assert.equal(directoryGroups(insertNote(directoryNotes,{id:'new',selector:'#target',body:'新增'},1),menus,host)[0].children[1].notes.length,2);
const targetBody=editorSource.match(/function acceptTarget\(\) \{([\s\S]*?)\n  \}/)[1];
const pickFields=Object.fromEntries(['formTitle','body','type','confirmNote','location'].map(id=>[id,{focus(){}}]));
const pickState={candidate:target,formNote:null,visibleRect:()=>true,selectorFor:()=>'#target',context:()=>'#inner',
  fingerprint:()=>({tag:'button'}),crypto:{randomUUID:()=>'new-id'},hostMenus:()=>menus,menuForNote,document:host,
  $:id=>pickFields[id],configureNumber(){},endPick(){},say(){}};
vm.runInNewContext('(function(){'+targetBody+'})()',pickState);
assert.equal(pickState.formNote.pageId,menus[2].id);
assert.equal(pickState.formNote.context,'*'); // Section navigation must not hide a freshly added note.
assert.equal(pickState.formNote.title,undefined);
assert(!editorSource.includes('confirmTarget'));
assert(!editorSource.includes('id="picker"'));
assert(editorSource.includes("if (type === 'click') {chooseChain(pointerTarget(event.clientX,event.clientY)); if (candidate) acceptTarget();}"));
// Run the actual directory renderer and native details toggle handlers.
function uiNode(tag){return {tag,children:[],append(...items){this.children.push(...items);},
  replaceChildren(){this.children=[];},setAttribute(key,value){this[key]=value;}};}
const listNode=uiNode('div'),opened=[];
const directoryState={notes:directoryNotes,selected:null,formNote:null,picking:false,say(){},openPage:group=>opened.push(group.id),directorySignature:'',expandedMenus:new Set(),hostMenus:()=>menus,
  directoryGroups,document:{...host,createElement:uiNode},$:()=>listNode,
  newButton:(text,onclick,className)=>({...uiNode('button'),text,onclick,className}),openNote:id=>opened.push(id)};
vm.createContext(directoryState);
vm.runInContext(editorSource.match(/function renderDirectory\(\) \{[\s\S]*?\n  \}/)[0]+';renderDirectory();',directoryState);
assert.equal(listNode.children[0].tag,'details');assert.equal(listNode.children[0].open,false);
listNode.children[0].open=true;listNode.children[0].ontoggle();
directoryState.selected='a';vm.runInContext('renderDirectory()',directoryState);
assert.equal(listNode.children[0].open,true);
const allNodes=node=>[node,...(node.children||[]).filter(n=>typeof n==='object').flatMap(allNodes)];
const entries=allNodes(listNode).filter(n=>n.className==='entry');
assert.equal(entries.length,3);
assert.equal(entries[0].children.length,2);
assert.equal(entries[0].children[0].children[0].textContent,1);
assert.equal(entries[0].children[0].children[1].textContent,'字段说明');
assert.equal(entries[0].children[1].textContent,'完整内容\n第二行');
assert.equal(entries[1]['data-type'],'修改原型');
entries[1].onclick();assert.deepEqual(opened,['b']);
listNode.children[0].open=false;listNode.children[0].ontoggle();assert.equal(directoryState.expandedMenus.size,0);
const detailGroup=allNodes(listNode).find(n=>n.tag==='details'&&n.children[0].children[0]==='详情');
detailGroup.children[0].onclick({preventDefault(){}});assert.equal(opened.at(-1),'a');
const emptyGroup=allNodes(listNode).find(n=>n.tag==='details'&&n.children[0].children[0]==='列表');
emptyGroup.children[0].onclick({preventDefault(){}});assert.equal(opened.at(-1),menus[1].id);

assert(!editorSource.includes('textContent = note.title'));assert(!editorSource.includes("mode === 'title'"));
// Execute real navigation handlers with delayed rendering, rapid clicks and failures.
const navigationFunctions=['navigateToMenu','openPage','openNote'].map(name=>editorSource.match(new RegExp('  async function '+name+'\\([^]*?\\n  \\}'))[0]).join('\n');
execFileSync(process.execPath,['-e',`
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(0,'utf8');
(async()=>{
 let page='a',ticks=0,scrolled=[],renders=[],calls=[];
 const menus=[{id:'a',context:'a'},{id:'b',context:'b'}];
 const notes=menus.map(m=>({id:'note-'+m.id,pageId:m.id,body:'内容'+m.id}));
 const nodes=Object.fromEntries(menus.map(m=>[m.id,{getClientRects(){return page===m.id&&ticks>=2?[{}]:[];},scrollIntoView(){scrolled.push(m.id);}}]));
 const fields={shown:{checked:false},toolNotes:{setAttribute(key,value){this[key]=value;}}};
 const state={notes,formNote:null,picking:false,selected:null,shown:false,navigationRequest:0,root:{style:{display:''}},
  window:{},document:{},innerWidth:1200,menuElements:new Map(menus.map(m=>[m.id,{localName:'a',click(){page=m.id;calls.push(m.id);}}])),
  hostMenus:()=>menus,menuForNote:(note,items)=>items.find(m=>m.id===note.pageId),resolve:note=>page===note.pageId?nodes[page]:null,
  setTimeout:done=>{ticks++;setImmediate(done);},Date:{now:()=>ticks*1000},$:id=>fields[id],
  render(){if(state.selected)renders.push(state.selected);},schedule(){},setPanel(){},say(message){state.message=message;}};
 vm.createContext(state);vm.runInContext(source,state);
 await state.openNote('note-b');assert.equal(page,'b');assert.equal(state.selected,'note-b');assert.equal(state.shown,true);assert.deepEqual(scrolled,['b']);
 await state.openNote('note-b');assert.deepEqual(calls,['b']); // Same page only scrolls.
 await Promise.all([state.openNote('note-a'),state.openNote('note-b')]);assert.equal(state.selected,'note-b');assert.equal(renders.at(-1),'note-b');
 state.formNote={body:'未保存'};const before=calls.length;await state.openNote('note-a');assert.equal(calls.length,before);state.formNote=null;
 state.window.htmlAnnotationNavigate=async(id)=>{await Promise.resolve();page=id;};
 await state.openNote('note-a');assert.equal(page,'a');assert.equal(state.selected,'note-a');
 await state.openPage(menus[1]);assert.equal(page,'b');assert.equal(state.selected,null);
 state.window.htmlAnnotationNavigate=()=>{throw Error('跳转失败');};
 await state.openNote('note-a');assert.equal(state.selected,'note-a');assert.equal(state.message,'跳转失败');
 state.window.htmlAnnotationNavigate=()=>{page='missing';};
 await state.openNote('note-a');assert.equal(state.selected,'note-a');assert(state.message.includes('目标尚不可见'));
 console.log('PASS: cross-page navigation, delayed targets, latest selection, edit guard, custom adapter and fallback content.');
})().catch(error=>{console.error(error);process.exitCode=1;});
`],{input:navigationFunctions});

const template=editorSource.match(/shadow\.innerHTML = `([\s\S]*?)`;/)[1];
execFileSync('python3',['-c',`
from html.parser import HTMLParser
import sys
class Check(HTMLParser):
    def __init__(self): super().__init__(); self.stack=[]; self.ids={}; self.tool_buttons=[]
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if 'id' in attrs:
            assert attrs['id'] not in self.ids
            self.ids[attrs['id']]=list(self.stack)
        if tag=='button' and 'tools' in self.stack: self.tool_buttons.append(attrs.get('id'))
        if tag not in ('img','input','br','hr','meta','link'): self.stack.append(attrs.get('id',tag))
    def handle_endtag(self, tag):
        if self.stack: self.stack.pop()
p=Check();p.feed(sys.stdin.read())
assert 'popover' in p.ids['form'] and 'aside' not in p.ids['form']
assert 'title' not in p.ids
assert 'form' in p.ids['type'] and 'popover' in p.ids['noteType']
assert 'editMode' not in p.ids and 'state' not in p.ids
assert 'cancelAll' not in p.ids and 'fileActions' not in p.ids
assert 'tools' in p.ids['add'] and 'aside' not in p.ids['add']
assert 'popover' in p.ids['cancelNote'] and 'popover' in p.ids['closeNote']
assert 'form' in p.ids['parent'] and 'form' in p.ids['child'] and 'form' in p.ids['relocate']
assert 'confirmTarget' not in p.ids and 'picker' not in p.ids
assert 'targetActions' in p.ids['parent'] and 'targetActions' in p.ids['child'] and 'targetActions' in p.ids['relocate']
assert 'submitActions' in p.ids['cancelNote'] and 'submitActions' in p.ids['confirmNote']
assert 'aside' in p.ids['settings'] and 'popover' not in p.ids['settings']
assert 'settings' in p.ids['hideAll'] and 'settings' in p.ids['exportList'] and 'settings' in p.ids['exportType']
assert 'saveAll' not in p.ids
assert p.tool_buttons==['add','toolDirectory','toolNotes','toolSettings','toolSave']
`],{input:template});
const templateIds=new Set([...template.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for (const match of editorSource.matchAll(/\$\('([^']+)'\)/g)) assert(templateIds.has(match[1]),'Missing editor element: '+match[1]);

// Hide the whole overlay without changing notes, form input or download state.
const hideBody=editorSource.match(/\$\('hideAll'\)\.onclick = \(\) => \{([\s\S]*?)\n  \};/)[1];
let blurred=false,frames=0;
const hidden={root:{style:{display:'',setProperty(name,value,priority){this[name]=value;this.priority=priority;}}},
  shadow:{activeElement:{blur(){blurred=true;}}},navigationRequest:0,picking:true,queued:false,
  notes:[{id:'keep'}],config:{notes:[{id:'keep'}]},formNote:{body:'未确认输入'},hasPageChanges:true,
  requestAnimationFrame(){frames++;},layout(){}};
vm.createContext(hidden);
vm.runInContext('(function(){'+hideBody+'})()',hidden);
assert.equal(hidden.root.style.display,'none');assert.equal(hidden.root.style.priority,'important');
assert.equal(hidden.picking,false);assert(blurred);
assert.deepEqual(hidden.notes,[{id:'keep'}]);assert.deepEqual(hidden.config,{notes:[{id:'keep'}]});
assert.equal(hidden.formNote.body,'未确认输入');assert(hidden.hasPageChanges);
const scheduleSource=editorSource.match(/function schedule\(\) \{[^\n]+\}/)[0];
vm.runInContext(scheduleSource+';schedule();',hidden);assert.equal(frames,0);
// A freshly created root has no display override, so ordinary positioning resumes.
hidden.root.style.display='';
vm.runInContext('schedule();',hidden);assert.equal(frames,1);

// Exercise the real save handler with no title input, for both new and existing notes.
const submitBody=editorSource.match(/\$\('form'\)\.onsubmit = event => \{([\s\S]*?)\n  \};/)[1];
const commitSource=editorSource.match(/function commitNotes\(next\) \{[\s\S]*?\n  \}/)[0];
const persistSource=editorSource.match(/function persistNotes\(storage, key, notes, savedAt\) \{[\s\S]*?\n  \}/)[0];
function submitContent(existing, body, type='字段说明', number='1', items=existing ? [existing] : [], fileError=null) {
  const fields={body:{value:body},number:{value:number},type:{value:type}};
  const dataElement={textContent:''};
  const state={notes:items,formNote:existing || {id:'new',selector:'#target'},
    $:id=>{assert(fields[id],'Unexpected form field: '+id);return fields[id]},event:{preventDefault(){}},
    config:{notes:items,base:'base'},document:{getElementById:()=>dataElement},dataElement,noteStorage:{setItem(){}},storageKey:'test-key',hasPageChanges:false,
    Date:{now:()=>40},writeHTMLFile(){throw Error('单条编辑不得触发文件写入');},
    clone:structuredClone,safeJSON,resolve:()=>true,editNote,insertNote,render(){},say(message){state.message=message}};
  vm.runInNewContext(persistSource+';'+commitSource+';(function(){'+submitBody+'})()',state);return state;
}
const created=submitContent(null,'  新的注记内容  ');
assert.equal(created.notes[0].body,'新的注记内容');
assert.equal(created.notes[0].title,undefined);
assert.equal(created.notes[0].type,'字段说明');
assert.equal(created.formNote,null);
assert.equal(created.config.notes[0].body,'新的注记内容');
assert.equal(JSON.parse(created.dataElement.textContent).notes[0].type,'字段说明');
assert.equal(created.message,'注记已添加，请点击工具栏底部的保存写入文件。');
assert.equal(created.hasPageChanges,true);
assert.equal(JSON.parse(created.dataElement.textContent).savedAt,40);
const changed=submitContent({id:'old',title:'已有目录名称',body:'旧内容',selector:'#target',type:'业务规则'},'新内容','交互逻辑');
assert.equal(changed.notes[0].title,undefined);
assert.equal(changed.notes[0].body,'新内容');
assert.equal(changed.notes[0].type,'交互逻辑');
assert.equal(JSON.parse(changed.dataElement.textContent).notes[0].body,'新内容');
assert.equal(changed.message,'注记已更新，请点击工具栏底部的保存写入文件。');
const failedSave=submitContent(null,'当前操作仍保留','字段说明','1',[],Error('用户取消'));
assert.equal(failedSave.notes[0].body,'当前操作仍保留');
assert.equal(failedSave.hasPageChanges,true);
assert(failedSave.message.includes('请点击工具栏底部的保存'));
const movedByForm=submitContent(original[0],'编辑并后移','字段说明','3',original);
assert.deepEqual(movedByForm.notes.map(n=>n.id),['b','c','a']);
assert.deepEqual(JSON.parse(movedByForm.dataElement.textContent).notes.map(n=>n.id),['b','c','a']);
for(const number of ['0','4','1.5','']) {
 const invalid=submitContent(original[0],'不能提交','字段说明',number,original);
 assert.deepEqual(invalid.notes,original);assert(invalid.formNote);assert.equal(invalid.dataElement.textContent,'');
}
const numberFields={number:{disabled:true},numberHint:{}};
const numberState={notes:original,$:id=>numberFields[id]};
vm.createContext(numberState);
vm.runInContext(editorSource.match(/function configureNumber\(note\) \{[\s\S]*?\n  \}/)[0]+';configureNumber(notes[1]);',numberState);
assert.equal(numberFields.number.disabled,false);assert.equal(numberFields.number.max,3);assert.equal(numberFields.number.value,2);
vm.runInContext('configureNumber(null);',numberState);assert.equal(numberFields.number.max,4);

assert.equal(submitContent(null,'规则内容','业务规则').notes[0].type,'业务规则');
const revision=submitContent(null,'待产研调整查询区域','修改原型');
assert.equal(revision.notes[0].type,'修改原型');
assert.equal(JSON.parse(revision.dataElement.textContent).notes[0].type,'修改原型');
const restored=submitContent(revision.notes[0],'已有字段含义','字段说明');
assert.equal(restored.notes[0].type,'字段说明');
const typeFields={type:{value:'修改原型'},noteType:{},popover:{setAttribute(name,value){this[name]=value;}}};
const changeType=editorSource.match(/\$\('type'\)\.onchange = \(\) => \{([^\n]+)\};/)[1];
vm.runInNewContext('(function(){'+changeType+'})()',{$:id=>typeFields[id]});
assert.equal(typeFields.popover['data-type'],'修改原型');
assert.equal(typeFields.noteType.textContent,'修改原型');
typeFields.type.value='交互逻辑';
vm.runInNewContext('(function(){'+changeType+'})()',{$:id=>typeFields[id]});
assert.equal(typeFields.popover['data-type'],'交互逻辑');
for(const selector of ['.marker[data-type="修改原型"]{background:#d92d20}', '.marker[data-type="修改原型"]:hover', '.popover[data-type="修改原型"] .note-dot', '.entry[data-type="修改原型"] b']) assert(editorSource.includes(selector));
assert(editorSource.includes("marker.setAttribute('data-type',type)"));

for (const type of ['', '其他']) {
  const invalid=submitContent(null,'有内容',type);
  assert.equal(invalid.notes.length,0);
  assert(invalid.formNote);
}
const empty=submitContent(null,'  \n ');
assert.equal(empty.notes.length,0);
assert(empty.formNote);

// Direct delete updates the embedded data; cancel only discards the open form.
const buttons=[];
const node=()=>({append(){},prepend(){},replaceChildren(){},replaceWith(){},classList:{toggle(){}}});
const baseline=[{id:'first',title:'原注记',body:'内容'}];
const deletedData={textContent:''};
const deletion={notes:structuredClone(baseline),config:{notes:structuredClone(baseline)},selected:'first',formNote:null,picking:false,hasPageChanges:false,
  $:()=>node(),document:{createElement:node,getElementById:()=>deletedData},visibleRect:()=>true,resolve:()=>true,
  noteStorage:{setItem(){}},storageKey:'test-key',Date:{now:()=>40},writeHTMLFile(){throw Error('删除不得触发文件写入');},newButton:(text,onclick)=>{const button={text,onclick};buttons.push(button);return button;},
  startEdit(){},removeNote,render(){},say(){},clone:structuredClone,safeJSON};
vm.createContext(deletion);
vm.runInContext(persistSource+';'+commitSource+';'+editorSource.match(/function renderDetail\(\) \{[\s\S]*?\n  \}/)[0]+';renderDetail();',deletion);
assert.deepEqual(buttons.map(button=>button.text),['编辑','删除']);
buttons.find(button=>button.text==='删除').onclick();
buttons.find(button=>button.text==='确认删除').onclick();
assert.equal(deletion.notes.length,0);
assert.equal(deletion.hasPageChanges,true);
assert.equal(deletion.config.notes.length,0);
assert.equal(JSON.parse(deletedData.textContent).notes.length,0);
const cancelBody=editorSource.match(/\$\('cancelNote'\)\.onclick = \(\) => \{([^\n]+)\};/)[1];
changed.formNote={...changed.notes[0],body:'尚未确认的输入'};
vm.runInNewContext('(function(){'+cancelBody+'})()',changed);
assert.equal(changed.notes[0].body,'新内容');
assert.equal(JSON.parse(changed.dataElement.textContent).notes[0].body,'新内容');
assert.equal(changed.formNote,null);

const temp = fs.mkdtempSync(path.join(os.tmpdir(),'html-annotation-check-'));
try {
  const source = '<!doctype html><html lang="zh"><head><title>验证</title></head><body><button id="save" onclick="this.textContent=\'成功\'">保存</button><script>window.hostInit=(window.hostInit||0)+1</script></body></html>';
  const hostileText = '</script><img src=x onerror=alert(1)> & "中文"\n第二行';
  const data = {version:1,menus:[{id:'work',label:'工作台'},{id:'page',label:'示例页面',parentId:'work',selector:'#save'}],notes:[{id:'n1',pageId:'page',body:hostileText,selector:'#save',type:'修改原型'}]};
  const input = path.join(temp,'input.html'), json = path.join(temp,'notes.json'), output = path.join(temp,'annotated.html');
  fs.writeFileSync(input,source); fs.writeFileSync(json,JSON.stringify(data));
  const inject = path.join(__dirname,'inject.py');
  const listNotes=directoryNotes.map((note,index)=>({...note,type:note.type || '字段说明',source:'原型事件',
    body:index===0?'=SUM(1,2) & <b>原文</b> | \\ `\n第二行，字面 <br>':note.body}));
  const table=annotationTable(listNotes,menus,host);
  const detailed=annotationTable(listNotes,menus,host,'detailed');
  assert.deepEqual(detailed[0],[...table[0],'注记ID','页面ID','页面状态','定位选择器','来源依据']);
  assert.deepEqual(detailed.slice(1).map(row=>row.slice(0,5)),table.slice(1));
  assert.deepEqual(detailed[1].slice(5),['a',menus[2].id,'*','#target','原型事件']);
  assert.equal(detailed[2][7],'#route-b');
  assert.equal(detailed[3][6],'');
  assert.equal(annotationTable([{...listNotes[0],pageId:'explicit-page',source:undefined}],menus,host,'detailed')[1][6],'explicit-page');
  assert.equal(annotationTable([{...listNotes[0],source:undefined}],menus,host,'detailed')[1][9],'');
  assert.equal(annotationTable([],[],host,'detailed')[0].length,10);
  assert.throws(()=>annotationTable(listNotes,menus,host,'invalid'));
  assert(listMarkdown(detailed).includes('| 注记ID | 页面ID | 页面状态 | 定位选择器 | 来源依据 |'));
  assert.equal(table.length,4);assert.deepEqual(table[0],['编号','菜单路径','目标区域','注记类型','注记内容']);assert(!table[0].includes('确认状态'));assert(!table[0].includes('待确认'));assert.equal(table[1][1],'项目管理 / 详情');assert.equal(table[2][3],'修改原型');
  const markdown=listMarkdown(table), markdownPath=path.join(temp,'list.md'), workbookPath=path.join(temp,'list.xlsx');
  fs.writeFileSync(markdownPath,markdown);fs.writeFileSync(workbookPath,listXLSX(table));
  const decoded=JSON.parse(execFileSync('python3',['-c',`
import sys,zipfile,json,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 for name in z.namelist():
  if name.endswith(('.xml','.rels')): E.fromstring(z.read(name))
 root=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 assert root.find('.//s:f',ns) is None
 assert root.find('.//s:pane',ns).attrib['state']=='frozen'
 print(json.dumps([[c.find('s:is/s:t',ns).text or '' for c in row] for row in root.findall('s:sheetData/s:row',ns)]))
` ,workbookPath],{encoding:'utf8'}));
  assert.deepEqual(decoded,table.map(row=>row.map(String)));
  const detailedPath=path.join(temp,'detailed.xlsx');fs.writeFileSync(detailedPath,listXLSX(detailed));
  const detailedRows=JSON.parse(execFileSync('python3',['-c',`
import sys,zipfile,json,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 root=E.fromstring(z.read('xl/worksheets/sheet1.xml')); ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 assert root.find('s:dimension',ns).attrib['ref']=='A1:J4'
 assert root.find('s:autoFilter',ns).attrib['ref']=='A1:J4'
 assert len(root.findall('s:cols/s:col',ns))==10 and root.find('.//s:f',ns) is None
 assert root.find('.//s:c[@r="D3"]',ns).attrib['s']=='2'
 print(json.dumps([[c.find('s:is/s:t',ns).text or '' for c in row] for row in root.findall('s:sheetData/s:row',ns)]))
`,detailedPath],{encoding:'utf8'}));
  assert.deepEqual(detailedRows,detailed.map(row=>row.map(String)));
  // If available, verify with an independent Excel reader as well as ZIP/XML parsing.
  if(spawnSync('python3',['-c','import openpyxl']).status===0){
    const excel=JSON.parse(execFileSync('python3',['-c',`
import sys,json,openpyxl
w=openpyxl.load_workbook(sys.argv[1]);s=w.active
assert s.freeze_panes=='A2' and s.auto_filter.ref=='A1:E4'
assert s['E2'].data_type=='s' and s['D3'].font.color.rgb=='FFD92D20'
print(json.dumps([[v if v is not None else '' for v in row] for row in s.values]))
`,workbookPath],{encoding:'utf8'}));assert.deepEqual(excel,decoded);
  }
  const fromList=path.join(temp,'from-list.html');
  const mappingPath=path.join(temp,'mapping.json');
  const mapping={version:1,menus,notes:listNotes.map((note,i)=>({...note,menuPath:table[i+1][1],targetArea:table[i+1][2],body:'不得替代清单正文'}))};
  fs.writeFileSync(mappingPath,JSON.stringify(mapping));
  execFileSync('python3',[inject,input,markdownPath,fromList,'--mapping',mappingPath]);
  const listData=JSON.parse(fs.readFileSync(fromList,'utf8').match(/<script id="hae-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(listData.notes.map(n=>n.body),listNotes.map(n=>n.body));
  assert.deepEqual(listData.notes.map(n=>n.id),listNotes.map(n=>n.id));assert(listData.notes.every(n=>n.confirmationStatus===undefined));
  assert.equal(listData.notes[1].type,'修改原型');assert.equal(fs.readFileSync(input,'utf8'),source);
  for(const invalid of [markdown.replace('| 1 |','| 8 |'),markdown.replace('菜单路径','未知列')]){
    fs.writeFileSync(markdownPath,invalid);assert.notEqual(spawnSync('python3',[inject,input,markdownPath,path.join(temp,'bad-list.html'),'--mapping',mappingPath]).status,0);
    assert(!fs.existsSync(path.join(temp,'bad-list.html')));
  }
  fs.writeFileSync(markdownPath,markdown);
  assert.notEqual(spawnSync('python3',[inject,input,markdownPath,path.join(temp,'no-map.html')]).status,0);
  const mismatch=structuredClone(mapping);mismatch.notes[0].targetArea='不匹配区域';
  fs.writeFileSync(mappingPath,JSON.stringify(mismatch));
  assert.notEqual(spawnSync('python3',[inject,input,markdownPath,path.join(temp,'bad-map.html'),'--mapping',mappingPath]).status,0);
  assert(!fs.existsSync(path.join(temp,'bad-map.html')));
  assert.equal(table[1][2],'未识别区域'); // No selector fallback in the human-readable list.
  assert.equal(annotationTable([],[],host).length,1);
  assert(listMarkdown(annotationTable([],[],host)).includes('目标区域'));
  assert.throws(()=>listXLSX([table[0],table[1].map((v,i)=>i===4?'x'.repeat(32768):v)]));
  const exportBody=editorSource.match(/\$\('exportList'\)\.onclick = \(\) => \{([\s\S]*?)\n  \};/)[1];
  for(const format of ['md','xlsx']) for(const exportType of ['simple','detailed']){
    const download={notes:listNotes,hasPageChanges:true,formNote:null,picking:false,
      annotationTable,listMarkdown:rows=>{assert.equal(rows[0].length,exportType==='simple'?5:10);return listMarkdown(rows);},listXLSX:rows=>{assert.equal(rows[0].length,exportType==='simple'?5:10);return listXLSX(rows);},hostMenus:()=>menus,Blob,URL:{createObjectURL(blob){download.blob=blob;return 'blob:test';},revokeObjectURL(){}},
      document:{...host,createElement(){return {click(){download.filename=this.download;},remove(){}};}},
      shadow:{append(){}},$:id=>({value:id==='exportType'?exportType:format}),setTimeout(){},say(message){download.message=message;}};
    vm.runInNewContext('(function(){'+exportBody+'})()',download);
    assert(download.filename.endsWith('.'+format));assert(download.blob.size>0);assert(download.hasPageChanges);
    delete download.filename;download.formNote={body:'未确认内容'};
    vm.runInNewContext('(function(){'+exportBody+'})()',download);assert.equal(download.filename,undefined);
  }
  execFileSync('python3',[inject,input,json,output]);
  const html = fs.readFileSync(output,'utf8');
  const config = JSON.parse(html.match(/<script id="hae-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(Buffer.from(config.base,'base64').toString(),source);
  assert.equal(config.notes[0].body,hostileText);
  assert.equal(config.notes[0].type,'修改原型');
  assert.deepEqual(config.menus,data.menus);assert.equal(config.notes[0].pageId,'page');
  assert(!safeJSON(data).includes('<'));
  assert(html.includes('onclick="this.textContent=\'成功\'"'));
  const reinjected = path.join(temp,'updated.html');
  execFileSync('python3',[inject,output,json,reinjected]);
  const again = fs.readFileSync(reinjected,'utf8');
  assert.equal(again,html, 'Reopening and reinjecting must not accumulate runtime wrappers');
  const legacy=structuredClone(data);delete legacy.notes[0].type;legacy.notes[0].title='旧标题';
  fs.writeFileSync(json,JSON.stringify(legacy));
  const legacyPath=path.join(temp,'legacy.html');
  execFileSync('python3',[inject,input,json,legacyPath]);
  const legacyData=JSON.parse(fs.readFileSync(legacyPath,'utf8').match(/<script id="hae-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(legacyData.notes[0].type,undefined);
  assert.equal(legacyData.notes[0].title,'旧标题');
  for (const menus of [{},[{id:'x',label:'X',parentId:'missing'}],
    [{id:'x',label:'X',parentId:'y'},{id:'y',label:'Y',parentId:'x'}],
    [{id:'x',label:'X'},{id:'x',label:'duplicate'}]]) {
    fs.writeFileSync(json,JSON.stringify({...data,menus}));
    assert.notEqual(spawnSync('python3',[inject,input,json,path.join(temp,'invalid-menu.html')]).status,0);
    assert(!fs.existsSync(path.join(temp,'invalid-menu.html')));
  }
  for (const type of ['', '其他', null]) {
    fs.writeFileSync(json,JSON.stringify({version:1,notes:[{...data.notes[0],type}]}));
    assert.notEqual(spawnSync('python3',[inject,input,json,path.join(temp,'invalid-type.html')]).status,0);
    assert(!fs.existsSync(path.join(temp,'invalid-type.html')));
  }
  fs.writeFileSync(json,JSON.stringify(data));
  assert.notEqual(spawnSync('python3',[inject,input,json,input]).status,0);
  assert.equal(fs.readFileSync(input,'utf8'),source);
  assert.notEqual(spawnSync('python3',[inject,input,json,output]).status,0);
  assert.equal(fs.readFileSync(output,'utf8'),html);
  fs.writeFileSync(json,JSON.stringify({version:1,notes:[{...data.notes[0]}, {...data.notes[0]}]}));
  assert.notEqual(spawnSync('python3',[inject,input,json,path.join(temp,'invalid.html')]).status,0);
  assert(!fs.existsSync(path.join(temp,'invalid.html')));
  fs.writeFileSync(input,'<script>AxhubAnnotation.createAnnotationViewer({})</script>');
  fs.writeFileSync(json,JSON.stringify(data));
  assert.notEqual(spawnSync('python3',[inject,input,json,path.join(temp,'old.html')]).status,0);
  console.log('PASS: automatic nested menus, distinct same-label pages, deepest region and route matching, unmatched/single-page fallback, expand/collapse persistence, number/type/full-body rows, manual page association, menu validation and export retention; toolbar, CRUD, popup bounds, safe text, source preservation and export/reinject regression checks.');
  console.log('Browser pointer geometry, list download completion and visual layout require a real browser.');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
