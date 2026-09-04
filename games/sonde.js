/* games/sonde.js - Sonde (Snake): Arcade-Modul. Schnittstelle zur Hülle: window.GAMES.sonde (meta.typ 'arcade').
   Unter Node exportiert module.exports die Spiellogik für Prüfungen. */
(function(){
'use strict';
/* ---------- Logik ---------- */
const N=20; // Sensorraster 20x20
const DIRS={links:[-1,0],rechts:[1,0],hoch:[0,-1],runter:[0,1]};
const OPP={links:'rechts',rechts:'links',hoch:'runter',runter:'hoch'};
const speedFor=sector=>Math.min(16,7+sector); // Schritte je Sekunde: Sektor 1 = 8, je Sektor +1, höchstens 16
function newGame(rng){
  const g={body:[[10,10],[9,10],[8,10]], dir:'rechts', queue:[], food:null, score:0, signals:0, sector:1, alive:true, moving:false, rng:rng||Math.random};
  placeFood(g); return g;
}
function onBody(g,x,y,len){ const n=len===undefined?g.body.length:len; for(let i=0;i<n;i++) if(g.body[i][0]===x&&g.body[i][1]===y) return true; return false; }
function placeFood(g){ // ein Signal, nie auf der Spur
  const free=[]; for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(!onBody(g,x,y)) free.push([x,y]);
  g.food=free.length?free[Math.floor(g.rng()*free.length)]:null;
}
// Eingabe in die Warteschlange (höchstens 2); Umkehr und Wiederholung der zuletzt gewählten Richtung werden ignoriert
function input(g,d){
  if(!DIRS[d]||!g.alive) return false;
  const last=g.queue.length?g.queue[g.queue.length-1]:g.dir;
  if(d===last||d===OPP[last]||g.queue.length>=2) return false;
  g.queue.push(d); g.moving=true; return true;
}
// Ein Schritt. Liefert {moved, ate, died, sectorUp}
function step(g){
  if(!g.alive||!g.moving) return {moved:false,ate:false,died:false,sectorUp:false};
  if(g.queue.length) g.dir=g.queue.shift();
  const [dx,dy]=DIRS[g.dir], [hx,hy]=g.body[0], nx=hx+dx, ny=hy+dy;
  if(nx<0||nx>=N||ny<0||ny>=N){ g.alive=false; return {moved:false,ate:false,died:true,sectorUp:false}; }
  const ate=!!g.food&&g.food[0]===nx&&g.food[1]===ny;
  if(onBody(g,nx,ny,ate?g.body.length:g.body.length-1)){ g.alive=false; return {moved:false,ate,died:true,sectorUp:false}; } // das Schwanzende rückt weg, wenn nicht gewachsen
  g.body.unshift([nx,ny]); if(!ate) g.body.pop();
  let sectorUp=false;
  if(ate){ g.signals++; g.score+=10*g.sector; const ns=1+Math.floor(g.signals/5); if(ns!==g.sector){ g.sector=ns; sectorUp=true; } placeFood(g); }
  return {moved:true,ate,died:false,sectorUp};
}

/* ---------- Oberfläche ---------- */
const META={
  id:'sonde', name:'SONDE', untertitel:'SNAKE | SENSORRASTER 20x20', typ:'arcade', endTitel:'SIGNALVERLUST',
  farben:[{name:'Nebelblau',hex:'#7fb2c9',dunkel:'#3f6f85'},{name:'Senf',hex:'#e8a93a',dunkel:'#b07a22'}], // Spur | Signale
  akzent:{name:'Nebelblau',hex:'#7fb2c9'},
  steuerung:[{id:'hoch',symbol:'▲',zeile:1,spalte:2},{id:'links',symbol:'◀',zeile:2,spalte:1},{id:'runter',symbol:'▼',zeile:2,spalte:2},{id:'rechts',symbol:'▶',zeile:2,spalte:3}],
  regeln:[
    {titel:'Auftrag.',text:'Die Sonde tastet ein Sensorraster von 20x20 Zellen ab und sammelt Signale ein.'},
    {titel:'Start.',text:'Die Sonde beginnt in der Mitte mit Länge 3 und bewegt sich nach rechts, sobald die erste Richtung gewählt ist.'},
    {titel:'Steuerung.',text:'Richtungstasten unter dem Feld oder Wischen auf dem Feld. Eine Umkehr in die Gegenrichtung wird ignoriert; zwei schnelle Eingaben werden nacheinander ausgeführt.'},
    {titel:'Signale.',text:'Jedes aufgenommene Signal verlängert die Spur um 1 und bringt 10 Punkte mal Sektor.'},
    {titel:'Sektoren.',text:'Alle 5 Signale steigt der Sektor, die Sonde wird schneller: Sektor 1 fährt 8 Schritte je Sekunde, jeder Sektor einen mehr, höchstens 16.'},
    {titel:'Signalverlust.',text:'Berührt die Sonde den Rand oder die eigene Spur, endet der Einsatz.'},
    {titel:'Logbuch.',text:'Die fünf besten Einsätze stehen im Logbuch. Pause hält die Sonde an; im Hintergrund pausiert sie von selbst.'}
  ],
  vorschau(){ const [spur,sig]=META.farben; let g='';
    for(let k=0;k<=8;k++){ const t=14+k*9; g+=`<line x1="${t}" y1="14" x2="${t}" y2="86"/><line x1="14" y1="${t}" x2="86" y2="${t}"/>`; }
    const cells=[[2,4],[3,4],[4,4],[4,3],[4,2],[5,2]].map(([x,y])=>`<rect x="${15+x*9}" y="${15+y*9}" width="7" height="7" fill="${spur.hex}"/>`).join('');
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#0c0a0c"/><g stroke="#f0e2c4" stroke-width=".6" opacity=".25">${g}</g>${cells}
      <rect x="${15+6*9}" y="${15+2*9}" width="7" height="7" fill="#f0e2c4"/><rect x="${17.5+6*9}" y="${17.5+2*9}" width="2" height="2" fill="#0c0a0c"/>
      <rect x="${15+1*9}" y="${15+6*9}" width="7" height="7" fill="${sig.hex}"/></svg>`; }
};
const CSS=`
.sonde .wrap{width:100%;aspect-ratio:1;position:relative;touch-action:none;user-select:none}
.sonde svg{width:100%;height:100%;display:block}
.sonde .grid{stroke:var(--elf-15);stroke-width:.2;fill:none}
.sonde .coords text{fill:var(--elf-40);font-family:var(--mono);font-size:2.2px}
.sonde .bracket{stroke:var(--akzent);stroke-width:.7;fill:none}
.sonde .seg{fill:var(--spieler1)}
.sonde .head{fill:var(--elf)} .sonde .core{fill:var(--schwarz);opacity:.7}
.sonde .food{fill:var(--spieler2);animation:sd-pulse 1s ease-in-out infinite}
@keyframes sd-pulse{0%,100%{opacity:1}50%{opacity:.6}} /* Blinken nur über die Deckkraft, Farbe bleibt Senf; nicht unter 60 % */
@media (prefers-reduced-motion:reduce){ .sonde .food{animation:none} }`;
const OFF=9, CELL=(100-2*OFF)/N;
const px=x=>OFF+x*CELL;
let H=null, root=null, styleEl=null, g=null, running=false, raf=0, last=0, acc=0, ended=false, started=false;
let segEls=[], headEl=null, coreEl=null, foodEl=null, swipe=null;
const q=id=>root.querySelector('#'+id);
const reduceMotion=()=>!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function drawBoard(){
  const G=q('grid'), C=q('coords'), B=q('brackets');
  for(let k=0;k<=N;k++){ const t=px(k); G.insertAdjacentHTML('beforeend',`<line x1="${t}" y1="${OFF}" x2="${t}" y2="${100-OFF}"/><line x1="${OFF}" y1="${t}" x2="${100-OFF}" y2="${t}"/>`); }
  for(let k=0;k<N;k++){ // Koordinatenring nur oben und links
    C.insertAdjacentHTML('beforeend',`<text x="${px(k)+CELL/2}" y="6.6" text-anchor="middle">${'ABCDEFGHIJKLMNOPQRST'[k]}</text>`);
    C.insertAdjacentHTML('beforeend',`<text x="6.4" y="${px(k)+CELL/2+0.8}" text-anchor="middle">${k+1}</text>`);
  }
  [[1,1,1,1],[99,1,-1,1],[1,99,1,-1],[99,99,-1,-1]].forEach(([x,y,dx,dy])=>B.insertAdjacentHTML('beforeend',`<path d="M${x} ${y+dy*7} L${x} ${y} L${x+dx*7} ${y}"/>`));
}
function rect(cls,size){ const r=document.createElementNS('http://www.w3.org/2000/svg','rect'); r.setAttribute('class',cls); r.setAttribute('width',size); r.setAttribute('height',size); return r; }
function place(el,x,y,size){ const m=(CELL-size)/2; el.setAttribute('x',px(x)+m); el.setAttribute('y',px(y)+m); }
function render(){ // Elemente werden wiederverwendet, nur Positionen ändern sich
  const St=q('stones');
  while(segEls.length<g.body.length-1){ const r=rect('seg',CELL-0.5); St.insertBefore(r,headEl); segEls.push(r); }
  while(segEls.length>g.body.length-1) segEls.pop().remove();
  for(let i=1;i<g.body.length;i++) place(segEls[i-1],g.body[i][0],g.body[i][1],CELL-0.5);
  place(headEl,g.body[0][0],g.body[0][1],CELL-0.3); place(coreEl,g.body[0][0],g.body[0][1],CELL*0.36);
  if(g.food){ foodEl.removeAttribute('display'); place(foodEl,g.food[0],g.food[1],CELL-0.7); } else foodEl.setAttribute('display','none');
}
function telemetry(){
  H.telemetry([{label:'PUNKTE',value:String(g.score).padStart(4,'0')},{label:'SEKTOR',value:g.sector},{label:'LÄNGE',value:g.body.length},{label:'BESTWERT',value:String(Math.max(H.bestwert?H.bestwert():0,g.score)).padStart(4,'0')}]);
}
function toneSignal(){ H.tone(520+g.sector*40,0.06,'square',0.05); H.vibrate(10); }
function toneSector(){ H.tone(660,0.08,'square',0.05); setTimeout(()=>H.tone(880,0.1,'square',0.05),100); H.vibrate([30,30]); }
function loop(now){
  if(!running) return;
  raf=requestAnimationFrame(loop);
  acc+=Math.min(now-last,250); last=now;
  const dt=1000/speedFor(g.sector);
  while(acc>=dt&&running){
    acc-=dt;
    const r=step(g);
    if(r.died){ finish(); return; }
    if(r.moved){ if(r.ate) toneSignal(); if(r.sectorUp) toneSector(); render(); telemetry(); }
  }
}
function finish(){
  running=false; ended=true; cancelAnimationFrame(raf); raf=0;
  render(); telemetry();
  const best=H.bestwert?H.bestwert():0;
  H.onEnd({score:g.score, felder:[{label:'Sektor',value:g.sector},{label:'Länge',value:g.body.length},{label:'Signale',value:g.signals}], bestwert:g.score>best});
}
function control(id,pressed){ if(!pressed||!g||!running) return; if(input(g,id)&&g.body.length===3&&g.signals===0&&g.queue.length===1) H.hud('Sonde unterwegs.'); }
function onKey(e){ const map={ArrowLeft:'links',ArrowRight:'rechts',ArrowUp:'hoch',ArrowDown:'runter',a:'links',d:'rechts',w:'hoch',s:'runter'}; const d=map[e.key]; if(d&&running){ e.preventDefault(); control(d,true); } }
function swipeStart(x,y){ swipe=[x,y]; }
function swipeEnd(x,y){ if(!swipe) return; const dx=x-swipe[0], dy=y-swipe[1]; swipe=null; if(Math.max(Math.abs(dx),Math.abs(dy))<18) return; control(Math.abs(dx)>Math.abs(dy)?(dx>0?'rechts':'links'):(dy>0?'runter':'hoch'),true); }

/* Schnittstelle zur Hülle */
function mount(container,hooks){
  H=hooks; root=container; root.classList.add('sonde');
  styleEl=document.createElement('style'); styleEl.textContent=CSS; document.head.appendChild(styleEl);
  root.innerHTML=`<div class="wrap"><svg viewBox="0 0 100 100" aria-label="Sensorraster">
  <rect width="100" height="100" fill="#0c0a0c"/><g id="grid" class="grid"></g><g id="coords" class="coords"></g><g id="brackets" class="bracket"></g><g id="stones"></g></svg></div>`;
  drawBoard();
  const St=q('stones'); headEl=rect('head',CELL-0.3); coreEl=rect('core',CELL*0.36); foodEl=rect('food',CELL-0.7); St.append(foodEl,headEl,coreEl);
  const wrap=root.querySelector('.wrap');
  wrap.addEventListener('touchstart',e=>{ const t=e.changedTouches[0]; swipeStart(t.clientX,t.clientY); },{passive:true});
  wrap.addEventListener('touchend',e=>{ const t=e.changedTouches[0]; swipeEnd(t.clientX,t.clientY); },{passive:true});
  wrap.addEventListener('pointerdown',e=>{ if(e.pointerType!=='touch') swipeStart(e.clientX,e.clientY); });
  wrap.addEventListener('pointerup',e=>{ if(e.pointerType!=='touch') swipeEnd(e.clientX,e.clientY); });
  document.addEventListener('keydown',onKey);
  H.onControl=control;
  g=newGame(); running=false; ended=false; started=false; segEls=[]; render(); telemetry();
}
function start(){
  g=newGame(); ended=false; started=true; acc=0; segEls.forEach(r=>r.remove()); segEls=[]; render(); telemetry();
  H.hud('Richtung wählen: die Sonde startet mit der ersten Eingabe.');
  running=true; last=performance.now(); raf=requestAnimationFrame(loop);
}
function pause(){ if(!running) return; running=false; cancelAnimationFrame(raf); raf=0; H.hud('Pause.'); }
function resume(){ if(running||ended||!started) return; running=true; acc=0; last=performance.now(); raf=requestAnimationFrame(loop); H.hud(g.moving?'Sonde unterwegs.':'Richtung wählen: die Sonde startet mit der ersten Eingabe.'); }
function isRunning(){ return running; }
function destroy(){
  running=false; cancelAnimationFrame(raf); raf=0; started=false;
  document.removeEventListener('keydown',onKey);
  if(styleEl){ styleEl.remove(); styleEl=null; }
  if(root){ root.innerHTML=''; root.classList.remove('sonde'); root=null; }
  segEls=[]; headEl=coreEl=foodEl=null; if(H) H.onControl=null; H=null;
}
const api={meta:META,mount,destroy,start,pause,resume,isRunning,newGame:start,
  debug(){ return {g,running,ended,started,raf,segEls,set:(body,food)=>{ g.body=body.map(c=>c.slice()); if(food) g.food=food.slice(); render(); }}; }};
if(typeof window!=='undefined'){ window.GAMES=window.GAMES||{}; window.GAMES.sonde=api; }
if(typeof module!=='undefined'&&module.exports) module.exports={N,DIRS,OPP,speedFor,newGame,placeFood,input,step,onBody,meta:META};
})();
