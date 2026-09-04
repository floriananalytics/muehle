/* games/vier-gewinnt.js - Vier gewinnt: Regeln, KI, SVG-Brett und Animationen. Schnittstelle zur Hülle: window.GAMES['vier-gewinnt'].
   Dieselbe Datei läuft auch als Web Worker (Stufe Schwer) und unter Node (Prüfungen). */
(function(){
'use strict';
/* ---------- Brett ---------- */
// 7 Spalten x 6 Reihen, Index = Spalte*6 + Reihe, Reihe 0 unten. Zustand {b: Array(42), h: [7 Füllhöhen], turn, n: Zahl der Züge}
const COLS=7, ROWS=6, P1=1, P2=2;
const ORDER=[3,2,4,1,5,0,6]; // Zugsortierung: mittlere Spalten zuerst
const WINDOWS=[]; // alle Vierer-Fenster (waagerecht, senkrecht, beide Diagonalen)
for(let c=0;c<COLS;c++) for(let r=0;r<ROWS;r++){
  const w=[[1,0],[0,1],[1,1],[1,-1]];
  for(const [dc,dr] of w){ const cells=[]; for(let k=0;k<4;k++){ const cc=c+dc*k, rr=r+dr*k; if(cc<0||cc>=COLS||rr<0||rr>=ROWS) break; cells.push(cc*ROWS+rr); } if(cells.length===4) WINDOWS.push(cells); }
}
const WIN_AT=Array.from({length:42},(_,i)=>WINDOWS.filter(w=>w.includes(i)));
function newState(turn){ return {b:new Array(42).fill(0), h:new Array(7).fill(0), turn, n:0}; }
function clone(s){ return {b:s.b.slice(), h:s.h.slice(), turn:s.turn, n:s.n}; }
function legal(s){ return ORDER.filter(c=>s.h[c]<ROWS); }
function drop(s,c,p){ const r=s.h[c]; s.b[c*ROWS+r]=p; s.h[c]++; s.n++; s.turn=3-p; return c*ROWS+r; }
function undrop(s,c){ s.h[c]--; s.b[c*ROWS+s.h[c]]=0; s.n--; s.turn=3-s.turn; }
// Gewinnreihe durch das zuletzt besetzte Feld: vier Feldindizes oder null
function winLine(b,i){
  const p=b[i]; if(!p) return null;
  const c=(i/ROWS)|0, r=i%ROWS;
  for(const [dc,dr] of [[1,0],[0,1],[1,1],[1,-1]]){
    const line=[i];
    for(const dir of [1,-1]){ let cc=c+dc*dir, rr=r+dr*dir;
      while(cc>=0&&cc<COLS&&rr>=0&&rr<ROWS&&b[cc*ROWS+rr]===p){ line.push(cc*ROWS+rr); cc+=dc*dir; rr+=dr*dir; } }
    if(line.length>=4) return line.sort((x,y)=>x-y).slice(0,4);
  }
  return null;
}
function isFull(s){ return s.n>=42; }

/* ---------- KI ---------- */
const LEVELS={1:{depth:2,budget:Infinity},2:{depth:6,budget:Infinity},3:{depth:14,budget:2000}};
// Bewertung aus Sicht von me: Fenster mit 3 eigenen + 1 leer +50, 2 eigene + 2 leer +10, gegnerisch gespiegelt (-80 / -10), Mittelspalte +3 je Stein
function evaluate(s,me){
  const b=s.b, opp=3-me; let v=0;
  for(const w of WINDOWS){
    let a=0,o=0; for(let k=0;k<4;k++){ const x=b[w[k]]; if(x===me)a++; else if(x===opp)o++; }
    if(a&&o) continue;
    if(a===3) v+=50; else if(a===2) v+=10; else if(o===3) v-=80; else if(o===2) v-=10;
  }
  for(let r=0;r<ROWS;r++){ const x=b[3*ROWS+r]; if(x===me) v+=3; else if(x===opp) v-=3; }
  return v;
}
// Zugtabelle: Stellungsschlüssel -> {d: Tiefe, v: Wert, f: 0 exakt | 1 untere | 2 obere Schranke, m: bester Zug}
let nodes=0, deadline=0;
const K={tt:new Map(),colVal:new Array(7).fill(0)};
const POW3=[1,3,9,27,81,243];
function keyOf(s){ let k=''; for(let c=0;c<COLS;c++){ let v=0; for(let r=0;r<s.h[c];r++) v+=s.b[c*ROWS+r]*POW3[r]; k+=v+','; } return k; }
function immediateWins(s,p){ const out=[]; for(const c of legal(s)){ const i=drop(s,c,p); if(winLine(s.b,i)) out.push(c); undrop(s,c); } return out; }
// Negamax mit Alpha-Beta aus Sicht des Spielers am Zug
function search(s,depth,alpha,beta){
  if((++nodes&1023)===0&&Date.now()>deadline) throw 'timeout';
  if(isFull(s)) return 0;
  const p=s.turn;
  const key=keyOf(s), e=K.tt.get(key), a0=alpha;
  if(e&&e.d>=depth){ if(e.f===0) return e.v; if(e.f===1&&e.v>=beta) return e.v; if(e.f===2&&e.v<=alpha) return e.v; }
  if(depth===0) return evaluate(s,p);
  let moves=legal(s); if(e&&e.m>=0&&moves.includes(e.m)) moves=[e.m,...moves.filter(c=>c!==e.m)];
  let best=-Infinity, bm=-1;
  for(const c of moves){
    const i=drop(s,c,p);
    const v=winLine(s.b,i)?10000+depth:-search(s,depth-1,-beta,-alpha);
    undrop(s,c);
    if(v>best){ best=v; bm=c; }
    if(best>alpha) alpha=best;
    if(alpha>=beta) break;
  }
  K.tt.set(key,{d:depth,v:best,f:best<=a0?2:best>=beta?1:0,m:bm});
  return best;
}
// Zugwahl: liefert die Spalte. Unmittelbare Gewinn- und Verlustzüge werden vor der Suche erkannt.
function bestMove(s0,me,level){
  const s=clone(s0); s.turn=me;
  const moves=legal(s); if(!moves.length) return -1;
  const win=immediateWins(s,me); if(win.length) return win[0];
  const threats=immediateWins(s,3-me); if(threats.length) return threats[0];
  const cfg=LEVELS[level]||LEVELS[2];
  K.tt=new Map(); deadline=Date.now()+cfg.budget; nodes=0;
  let order=moves.slice(), best=order[0];
  try{
    for(let d=level===3?1:cfg.depth; d<=cfg.depth; d++){
      const scored=order.map(c=>{ const i=drop(s,c,me); const v=winLine(s.b,i)?10000+d:-search(s,d-1,-Infinity,Infinity); undrop(s,c); return {c,v}; });
      scored.sort((x,y)=>y.v-x.v); order=scored.map(x=>x.c); best=order[0];
      if(level===1&&Math.random()<0.3) best=order[Math.random()*Math.min(3,order.length)|0];
      if(scored[0].v>9000) break;
    }
  }catch(e){}
  return best;
}

/* ---------- Web Worker (Stufe Schwer) ---------- */
if(typeof importScripts==='function'){
  self.onmessage=e=>{ const {b,h,turn,n,me,level,budget,id}=e.data; if(budget) LEVELS[3].budget=budget; const col=bestMove({b,h,turn,n},me,level); self.postMessage({id,col}); };
}

/* ---------- Oberfläche ---------- */
const META={
  id:'vier-gewinnt', name:'VIER GEWINNT', untertitel:'SCHACHT 7x6',
  farben:[{name:'Zinnober',hex:'#d4552e',dunkel:'#8f3419'},{name:'Nebelblau',hex:'#7fb2c9',dunkel:'#3f6f85'}],
  akzent:{name:'Nebelblau',hex:'#7fb2c9'},
  stufen:['Leicht','Mittel','Schwer'],
  regeln:[
    {titel:'Ziel.',text:'Vier eigene Steine in einer Reihe: waagerecht, senkrecht oder diagonal.'},
    {titel:'Setzen.',text:'Beide Seiten werfen abwechselnd einen Stein in eine der 7 Spalten. Der Stein fällt in die unterste freie Reihe.'},
    {titel:'Anfang.',text:'Wer beginnt, ist im Menü wählbar. Zinnober ist Spieler 1, Nebelblau Spieler 2.'},
    {titel:'Remis.',text:'Sind alle 42 Felder belegt und keine Vierer-Reihe entstanden, endet die Partie unentschieden.'},
    {titel:'Bedienung.',text:'Auf eine Spalte tippen. Ein Kreuz zeigt vorher, wo der Stein landen würde: erstes Tippen wählt die Spalte, zweites Tippen auf dieselbe Spalte setzt. Am Rechner reicht Zeigen und Klicken.'},
    {titel:'Rückgängig.',text:'„◀ Zug“ nimmt gegen den Computer den eigenen Zug samt Antwort zurück, zu zweit einen Zug.'}
  ],
  vorschau(){ const [a,b]=META.farben; const cx=c=>14+c*12, cy=r=>86-r*12;
    const st=[[3,0,a],[2,0,b],[3,1,b],[4,0,a],[3,2,a],[2,1,b],[3,3,a]];
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#0c0a0c"/>
      <g fill="none" stroke="#f0e2c4" stroke-width="1" opacity=".6">${[0,1,2,3,4,5,6].map(c=>`<rect x="${cx(c)-5}" y="20" width="10" height="72"/>`).join('')}</g>
      ${st.map(([c,r,f])=>`<circle cx="${cx(c)}" cy="${cy(r)}" r="4.6" fill="${f.hex}"/>`).join('')}</svg>`; }
};
const CSS=`
.vier .wrap{width:100%;aspect-ratio:100/92;position:relative}
.vier svg{width:100%;height:100%;display:block}
.vier .shaft{fill:none;stroke:var(--elf-40);stroke-width:.35}
.vier .coords text{fill:var(--elf-40);font-family:var(--mono);font-size:2.6px;letter-spacing:.2px}
.vier .coords line{stroke:var(--elf-40);stroke-width:.3}
.vier .bracket{stroke:var(--akzent);stroke-width:.7;fill:none}
.vier .pt{fill:var(--elf);opacity:.9}
.vier .hit{fill:transparent;cursor:pointer}
.vier .stone{stroke-width:.35}
.vier .stone.s{fill:var(--spieler1);stroke:var(--spieler1-d)} .vier .stone.p{fill:var(--spieler2);stroke:var(--spieler2-d)}
.vier .core{fill:var(--schwarz);opacity:.55}
.vier .go{stroke:var(--spieler1);stroke-width:.5;fill:none} .vier .go2{stroke:var(--spieler2);stroke-width:.5;fill:none}
.vier .last{fill:none;stroke:var(--elf-40);stroke-width:.35}
.vier .winline{stroke:var(--rot);stroke-width:1.1;opacity:.7;animation:vg-flash .15s 2}
.vier .stone-g{transition:transform .25s ease-in;will-change:transform}
.vier .flash .stone{animation:vg-flash .15s 2}
@keyframes vg-flash{0%,100%{opacity:1}50%{opacity:.15}}
.vier .hint .go,.vier .hint .go2{animation:vg-blink .7s steps(1) infinite}
@keyframes vg-blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){ .vier .stone-g{transition:none} .vier .flash .stone,.vier .winline,.vier .hint *{animation:none} }`;
const STEP=12.2, OFFX=13.4, TOPY=11.5, Y0=80; // Spalten x, Vorschau y, unterste Reihe y
const cx=c=>OFFX+c*STEP, cy=r=>Y0-r*STEP;
let H=null, root=null, styleEl=null, gen=0, worker=null, workerId=0;
let S, over=false, thinking=false, history=[], twoPlayer=false, started=false, level=2, lastIdx=-1, selCol=-1, hoverCol=-1, pointerType='mouse';
let stoneEls={}, winCells=null, hinting=false;
const q=id=>root.querySelector('#'+id);
const isHumanTurn=()=>twoPlayer||S.turn===P1;
const farbe=p=>META.farben[p-1].name;
const nameOf=p=>p===P1?(twoPlayer?farbe(P1).toUpperCase():'DU'):(twoPlayer?farbe(P2).toUpperCase():'COMPUTER');
const restartClass=(el,cls)=>{ el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); };

function drawBoard(){
  const C=q('coords'), B=q('brackets'), Sh=q('shafts'), P=q('pts'), Hh=q('hits');
  const cols='ABCDEFG';
  for(let c=0;c<COLS;c++){ const x=cx(c);
    C.insertAdjacentHTML('beforeend',`<text x="${x}" y="5.4" text-anchor="middle">${cols[c]}</text><line x1="${x}" y1="6.6" x2="${x}" y2="8.2"/>`);
    C.insertAdjacentHTML('beforeend',`<text x="${x}" y="90.2" text-anchor="middle">${cols[c]}</text><line x1="${x}" y1="84.4" x2="${x}" y2="86"/>`);
    Sh.insertAdjacentHTML('beforeend',`<rect class="shaft" x="${x-4.8}" y="${cy(ROWS-1)-5.2}" width="9.6" height="${ROWS*STEP-2}" rx=".6"/>`);
    for(let r=0;r<ROWS;r++){ const y=cy(r); P.insertAdjacentHTML('beforeend',`<rect class="pt" x="${x-1.1}" y="${y-1.1}" width="2.2" height="2.2"/>`); }
    Hh.insertAdjacentHTML('beforeend',`<rect class="hit" x="${x-STEP/2}" y="8" width="${STEP}" height="78" data-c="${c}"/>`);
  }
  [[1,1,1,1],[99,1,-1,1],[1,91,1,-1],[99,91,-1,-1]].forEach(([x,y,dx,dy])=>B.insertAdjacentHTML('beforeend',`<path d="M${x} ${y+dy*7} L${x} ${y} L${x+dx*7} ${y}"/>`));
  const svg=root.querySelector('svg');
  svg.addEventListener('pointerdown',e=>{ pointerType=e.pointerType||'mouse'; });
  svg.addEventListener('pointermove',e=>{ if((e.pointerType||'mouse')!=='mouse') return; const c=e.target.dataset&&e.target.dataset.c; const n=c===undefined?-1:+c; if(n!==hoverCol){ hoverCol=n; renderMarks(); } });
  svg.addEventListener('pointerleave',()=>{ if(hoverCol>=0){ hoverCol=-1; renderMarks(); } });
  Hh.addEventListener('click',e=>{ const c=e.target.dataset.c; if(c!==undefined) onTap(+c); });
}
function makeStone(i,p,animate){
  const c=(i/ROWS)|0, r=i%ROWS, g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','stone-g'); g.dataset.p=p;
  g.style.transform=`translate(${cx(c)}px,${animate?TOPY-6:cy(r)}px)`;
  g.innerHTML=`<g class="inner"><circle class="stone ${p===P1?'s':'p'}" r="4"/><circle class="core" r="1.1"/></g>`;
  return g;
}
function renderStones(reset){
  const St=q('stones'), b=S.b;
  if(reset){ St.innerHTML=''; stoneEls={}; for(let i=0;i<42;i++) if(b[i]) St.appendChild(stoneEls[i]=makeStone(i,b[i],false)); return; }
  for(let i=0;i<42;i++){
    if(stoneEls[i]&&!b[i]){ stoneEls[i].remove(); delete stoneEls[i]; }
    else if(b[i]&&!stoneEls[i]){ const g=makeStone(i,b[i],true); St.appendChild(g); stoneEls[i]=g; void g.getBoundingClientRect(); g.style.transform=`translate(${cx((i/ROWS)|0)}px,${cy(i%ROWS)}px)`; } // fällt von oben
  }
  if(winCells) for(const i of winCells) if(stoneEls[i]) restartClass(stoneEls[i],'flash');
}
function renderMarks(){
  const M=q('marks'); M.innerHTML='';
  if(lastIdx>=0){ const x=cx((lastIdx/ROWS)|0), y=cy(lastIdx%ROWS); M.insertAdjacentHTML('beforeend',`<rect class="last" x="${x-5.2}" y="${y-5.2}" width="10.4" height="10.4"/>`); }
  if(started&&!over&&!thinking&&!hinting&&isHumanTurn()){
    const c=selCol>=0?selCol:hoverCol;
    if(c>=0&&S.h[c]<ROWS){ const gc=S.turn===P1?'go':'go2', x=cx(c), y=cy(S.h[c]);
      M.insertAdjacentHTML('beforeend',`<path class="${gc}" d="M${x-1.6} ${y}H${x+1.6}M${x} ${y-1.6}V${y+1.6}"/><path class="${gc}" d="M${x-1.6} ${TOPY}H${x+1.6}M${x} ${TOPY-1.6}V${TOPY+1.6}"/>`); }
  }
  if(winCells){ const W=q('win'); W.innerHTML=''; const a=winCells[0], z=winCells[3];
    W.insertAdjacentHTML('beforeend',`<line class="winline" x1="${cx((a/ROWS)|0)}" y1="${cy(a%ROWS)}" x2="${cx((z/ROWS)|0)}" y2="${cy(z%ROWS)}"/>`); }
  else q('win').innerHTML='';
}
function render(opts){ renderStones(!!(opts&&opts.reset)); renderMarks(); }
function hud(msg,cls){ H.hudRow(`ZUG ${String(S.n).padStart(2,'0')} | ${nameOf(S.turn)} AM ZUG`); H.hud(msg,cls||''); }
function statusForHuman(){ hud(`${twoPlayer?farbe(S.turn):'Du'}: Spalte wählen.`); }
function snapshot(){ history.push({S:clone(S),lastIdx}); if(history.length>60) history.shift(); }

function onTap(c){
  clearHint();
  if(!started||over||thinking||hinting||!isHumanTurn()||S.h[c]>=ROWS) return;
  if(pointerType!=='mouse'&&selCol!==c){ selCol=c; renderMarks(); return; } // auf Handys: erstes Tippen zeigt Vorschau
  snapshot(); play(c);
}
function play(c){
  const p=S.turn, i=drop(S,c,p); lastIdx=i; selCol=-1; hoverCol=-1;
  H.sfx.place(); render();
  const line=winLine(S.b,i);
  if(line){ winCells=line; render(); H.sfx.mill(); over=true; const g=gen; setTimeout(()=>{ if(g===gen) H.onEnd({win:p}); },350); return; }
  if(isFull(S)){ over=true; render(); H.onEnd({draw:true,grund:'Brett voll.'}); return; }
  if(twoPlayer||S.turn===P1){ statusForHuman(); return; }
  aiTurn();
}
function askWorker(lv,me,budget){
  return new Promise((resolve,reject)=>{
    try{
      if(!worker){ worker=new Worker('./games/vier-gewinnt.js'); worker.onerror=e=>{ const w=worker; worker=null; if(w) w.terminate(); reject(e); }; }
      const id=++workerId, w=worker;
      w.onmessage=e=>{ if(e.data.id===id) resolve(e.data.col); };
      w.postMessage({b:S.b,h:S.h,turn:S.turn,n:S.n,me,level:lv,budget:budget||LEVELS[3].budget,id});
    }catch(e){ reject(e); }
  });
}
function aiTurn(){
  thinking=true; hud('Computer berechnet Zug …'); render();
  const lv=level, g=gen;
  H.progress(380+(lv===3?LEVELS[3].budget:0));
  const finish=col=>{ if(g!==gen) return; H.progress(0); thinking=false; play(col); };
  setTimeout(()=>{
    if(g!==gen) return;
    if(lv===3&&typeof Worker!=='undefined') askWorker(lv,P2).then(finish).catch(()=>finish(bestMove(S,P2,lv))); // Rückfall auf den Hauptthread
    else finish(bestMove(S,P2,lv));
  },380);
}

/* Schnittstelle zur Hülle */
function mount(container,hooks){
  H=hooks; root=container; root.classList.add('vier');
  styleEl=document.createElement('style'); styleEl.textContent=CSS; document.head.appendChild(styleEl);
  root.innerHTML=`<div class="wrap"><svg viewBox="0 0 100 92" aria-label="Vier-gewinnt-Brett">
  <rect width="100" height="92" fill="#0c0a0c"/>
  <g id="coords" class="coords"></g><g id="brackets" class="bracket"></g><g id="shafts"></g><g id="pts"></g><g id="marks"></g><g id="stones"></g><g id="win"></g><g id="hint" class="hint"></g><g id="hits"></g>
</svg></div>`;
  drawBoard();
  S=newState(P1); started=false; over=false; thinking=false; history=[]; lastIdx=-1; selCol=-1; hoverCol=-1; winCells=null;
  render({reset:true});
}
function newGame(opts){
  gen++; twoPlayer=!!opts.twoPlayer; level=opts.level||2;
  S=newState(opts.starter===2?P2:P1); over=false; thinking=false; history=[]; lastIdx=-1; selCol=-1; hoverCol=-1; winCells=null; started=true;
  hinting=false; H.progress(0); clearHint(); render({reset:true});
  if(!twoPlayer&&S.turn===P2) aiTurn(); else statusForHuman();
}
function undo(){
  if(!canUndo()) return;
  const h=history.pop(); S=h.S; lastIdx=h.lastIdx; selCol=-1; winCells=null; clearHint();
  render({reset:true}); statusForHuman();
}
function canUndo(){ return started&&!over&&!thinking&&!hinting&&history.length>0; }
/* Zugvorschlag: Stufe Schwer mit 1500 ms für den Menschen, im Worker wenn möglich */
function canHint(){ return started&&!over&&!thinking&&!hinting&&!twoPlayer&&isHumanTurn(); }
function hint(cb){
  if(!canHint()){ cb(null); return; }
  hinting=true; const g=gen; render();
  const done=c=>{ if(g!==gen) return; hinting=false; render(); cb(c>=0?c:null); };
  const sync=()=>{ const old=LEVELS[3].budget; LEVELS[3].budget=1500; try{ return bestMove(S,P1,3); } finally{ LEVELS[3].budget=old; } };
  if(typeof Worker!=='undefined') askWorker(3,P1,1500).then(done).catch(()=>done(sync()));
  else setTimeout(()=>done(sync()),30);
}
function showHint(c){
  clearHint(); if(c===null||c===undefined||S.h[c]>=ROWS) return;
  const Hn=q('hint'), gc=S.turn===P1?'go':'go2', x=cx(c), y=cy(S.h[c]);
  const cross=(x,y,r)=>Hn.insertAdjacentHTML('beforeend',`<path class="${gc}" d="M${x-r} ${y-r}L${x+r} ${y+r}M${x-r} ${y+r}L${x+r} ${y-r}"/>`);
  cross(x,y,2.2); cross(x,TOPY,2.2);
  statusForHuman();
}
function clearHint(){ if(root) q('hint').innerHTML=''; }
function setLevel(l){ level=l; }
function destroy(){
  gen++; H&&H.progress(0);
  if(worker){ worker.terminate(); worker=null; }
  if(styleEl){ styleEl.remove(); styleEl=null; }
  if(root){ root.innerHTML=''; root.classList.remove('vier'); root=null; }
  stoneEls={}; started=false; H=null;
}
const api={meta:META,mount,newGame,undo,canUndo,setLevel,destroy,canHint,hint,showHint,clearHint,
  debug(){ return {S,over,thinking,hinting,history,lastIdx,selCol,stoneEls,twoPlayer,started,cx,cy,winCells,setPointer:t=>{pointerType=t;}}; }};
if(typeof window!=='undefined'){ window.GAMES=window.GAMES||{}; window.GAMES['vier-gewinnt']=api; }
if(typeof module!=='undefined'&&module.exports) module.exports={COLS,ROWS,P1,P2,ORDER,WINDOWS,newState,clone,legal,drop,undrop,winLine,isFull,LEVELS,evaluate,immediateWins,search,bestMove,K,meta:META};
})();
