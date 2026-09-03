/* games/muehle.js - Mühle: Brettmodell, Regeln, KI, SVG-Brett und Animationen. Schnittstelle zur Hülle: window.GAMES.muehle */
(function(){
'use strict';
/* ---------- Brett ---------- */
const POS=[[0,0],[3,0],[6,0],[1,1],[3,1],[5,1],[2,2],[3,2],[4,2],[0,3],[1,3],[2,3],[4,3],[5,3],[6,3],[2,4],[3,4],[4,4],[1,5],[3,5],[5,5],[0,6],[3,6],[6,6]];
const ADJ=[[1,9],[0,2,4],[1,14],[4,10],[1,3,5,7],[4,13],[7,11],[4,6,8],[7,12],[0,10,21],[3,9,11,18],[6,10,15],[8,13,17],[5,12,14,20],[2,13,23],[11,16],[15,17,19],[12,16],[10,19],[16,18,20,22],[13,19],[9,22],[19,21,23],[14,22]];
const MILLS=[[0,1,2],[3,4,5],[6,7,8],[9,10,11],[12,13,14],[15,16,17],[18,19,20],[21,22,23],[0,9,21],[3,10,18],[6,11,15],[1,4,7],[16,19,22],[8,12,17],[5,13,20],[2,14,23]];
const MILLS_AT=POS.map((_,i)=>MILLS.filter(m=>m.includes(i)));
const P1=1, P2=2; // Senf, Petrol

/* ---------- Spiellogik ---------- */
function newState(turn){ return {b:new Array(24).fill(0), hand:[0,9,9], turn, nc:0}; } // nc = Züge ohne Schlag in der Ziehphase
function clone(s){ return {b:s.b.slice(), hand:s.hand.slice(), turn:s.turn, nc:s.nc}; }
function posKey(s){ return s.b.join('')+'|'+s.turn+'|'+s.hand[1]+'.'+s.hand[2]; }
function count(b,p){ let n=0; for(const v of b) if(v===p) n++; return n; }
function inMill(b,i,p){ return MILLS_AT[i].some(m=>b[m[0]]===p&&b[m[1]]===p&&b[m[2]]===p); }
function removable(b,opp){
  const all=[],free=[];
  for(let i=0;i<24;i++) if(b[i]===opp){ all.push(i); if(!inMill(b,i,opp)) free.push(i); }
  return free.length?free:all;
}
function phase(s,p){ return s.hand[p]>0?'place':count(s.b,p)===3?'fly':'move'; }
function genMoves(s,p){
  const b=s.b, opp=3-p, ph=phase(s,p), out=[];
  const push=(from,to)=>{
    b[to]=p; if(from>=0) b[from]=0;
    const mill=inMill(b,to,p);
    b[to]=0; if(from>=0) b[from]=p;
    const rem=mill?removable(b,opp):[];
    if(rem.length) for(const r of rem) out.push({from,to,remove:r});
    else out.push({from,to,remove:-1});
  };
  if(ph==='place'){ for(let i=0;i<24;i++) if(b[i]===0) push(-1,i); }
  else for(let f=0;f<24;f++) if(b[f]===p){
    if(ph==='fly'){ for(let t=0;t<24;t++) if(b[t]===0) push(f,t); }
    else for(const t of ADJ[f]) if(b[t]===0) push(f,t);
  }
  return out;
}
function apply(s,m,p){
  const n=clone(s);
  if(m.from>=0) n.b[m.from]=0; else n.hand[p]--;
  n.b[m.to]=p; if(m.remove>=0) n.b[m.remove]=0;
  n.nc=(m.from>=0&&m.remove<0&&n.hand[1]===0&&n.hand[2]===0)?n.nc+1:0;
  n.turn=3-p; return n;
}
function isLoss(s,p){
  if(s.hand[p]===0&&count(s.b,p)<3) return true;
  if(s.hand[p]>0) return false;
  return genMoves(s,p).length===0;
}
// Remis: 'rep' = Stellung zum dritten Mal, 'fifty' = 50 Züge ohne Schlag. reps = Map Stellungsschlüssel -> Anzahl
function drawReason(s,reps){
  if(s.nc>=50) return 'fifty';
  if((reps.get(posKey(s))||0)>=3) return 'rep';
  return null;
}

/* ---------- KI ---------- */
const LEVELS={1:{depth:2,budget:Infinity},2:{depth:4,budget:Infinity},3:{depth:12,budget:3000}};
// Doppelmühle: Stein in einer Mühle, der auf ein freies Nachbarfeld ziehen kann und dort eine zweite Mühle schließt
function doubleMills(b,p){
  let n=0;
  for(let i=0;i<24;i++){
    if(b[i]!==p||!inMill(b,i,p)) continue;
    b[i]=0;
    for(const j of ADJ[i]){ if(b[j]!==0) continue; b[j]=p; const hit=inMill(b,j,p); b[j]=0; if(hit){ n++; break; } }
    b[i]=p;
  }
  return n;
}
function evaluate(s,me,level){
  const b=s.b, opp=3-me;
  const mat=(count(b,me)+s.hand[me])-(count(b,opp)+s.hand[opp]);
  let mills=0,two=0,mob=0,blocked=0;
  for(const m of MILLS){
    let a=0,o=0; for(const i of m){ if(b[i]===me)a++; else if(b[i]===opp)o++; }
    if(a===3) mills++; else if(o===3) mills--;
    else if(a===2&&o===0) two++; else if(o===2&&a===0) two--;
  }
  if(level===1) return 30*mat+9*mills;
  // Beweglichkeit: Mittel erst ab der Ziehphase (unverändert), Schwer immer, damit Blockaden schon beim Setzen zählen
  let ownBlocked=0;
  if(level===3||s.hand[me]===0||s.hand[opp]===0){
    for(let i=0;i<24;i++){
      if(b[i]===0) continue;
      const free=ADJ[i].filter(j=>b[j]===0).length;
      if(b[i]===me){ mob+=free; if(free===0) ownBlocked++; } else { mob-=free; if(free===0) blocked++; }
    }
  }
  if(level!==3) return 30*mat+9*mills+4*two+2*mob+3*blocked;
  const placing=s.hand[1]>0||s.hand[2]>0;
  const dbl=doubleMills(b,me)-doubleMills(b,opp);
  return 30*mat+9*mills+(placing?6:3)*two+2*mob+5*(blocked-ownBlocked)+25*dbl;
}
// Zugsortierung: Schlagzüge, dann Züge, die eine offene gegnerische Zweierreihe blockieren, dann Rest
function orderMoves(b,p,moves){
  const opp=3-p;
  const rank=m=>m.remove>=0?2:MILLS_AT[m.to].some(ml=>ml.every(i=>i===m.to||b[i]===opp))?1:0;
  return moves.map(m=>({m,r:rank(m)})).sort((x,y)=>y.r-x.r).map(x=>x.m);
}
let nodes=0, deadline=0;
// K = Kontext der laufenden Zugberechnung: hist = Stellungen der Partie, path = Stellungen im Suchpfad,
// tt = Zugtabelle (Stellungsschlüssel -> {d: Tiefe, v: Wert, f: 0 exakt | 1 untere Schranke | 2 obere Schranke})
const K={me:P2,level:2,hist:new Map(),path:new Map(),tt:new Map(),repAdj:0};
function search(s,p,depth,alpha,beta){
  if((++nodes&511)===0&&Date.now()>deadline) throw 'timeout';
  const me=K.me;
  if(isLoss(s,p)) return p===me?-10000-depth:10000+depth;
  if(s.nc>=50) return 0;
  let key=null, adj=0;
  if(K.level===3){
    key=posKey(s);
    const seen=(K.hist.get(key)||0)+(K.path.get(key)||0);
    if(seen>=2) return 0;
    if(seen>0) adj=K.repAdj;
    const e=K.tt.get(key);
    if(e&&e.d>=depth){ if(e.f===0) return e.v; if(e.f===1&&e.v>=beta) return e.v; if(e.f===2&&e.v<=alpha) return e.v; }
  }
  if(depth===0) return evaluate(s,me,K.level)+adj;
  const moves=orderMoves(s.b,p,genMoves(s,p)), a0=alpha, b0=beta;
  if(key) K.path.set(key,(K.path.get(key)||0)+1);
  let best;
  if(p===me){
    best=-Infinity;
    for(const m of moves){ const v=search(apply(s,m,p),3-p,depth-1,alpha,beta); if(v>best)best=v; if(best>alpha)alpha=best; if(alpha>=beta)break; }
  } else {
    best=Infinity;
    for(const m of moves){ const v=search(apply(s,m,p),3-p,depth-1,alpha,beta); if(v<best)best=v; if(best<beta)beta=best; if(alpha>=beta)break; }
  }
  if(key){ K.path.set(key,K.path.get(key)-1); }
  best+=adj;
  if(key) K.tt.set(key,{d:depth,v:best,f:best<=a0?2:best>=b0?1:0});
  return best;
}
function bestMove(s,me,level,hist){
  let moves=genMoves(s,me);
  if(!moves.length) return null;
  const cfg=LEVELS[level]||LEVELS[2];
  K.me=me; K.level=level; K.hist=hist||new Map(); K.tt=new Map(); K.path=new Map();
  K.repAdj=level===3?(evaluate(s,me,3)>=0?-15:15):0; // bei Vorteil Wiederholung meiden, bei Nachteil anstreben
  deadline=Date.now()+cfg.budget; nodes=0;
  let best=moves[0];
  try{
    for(let d=level===3?1:cfg.depth;d<=cfg.depth;d++){
      K.path.clear();
      const scored=moves.map(m=>({m,v:search(apply(s,m,me),3-me,d-1,-Infinity,Infinity)}));
      scored.sort((x,y)=>y.v-x.v);
      moves=scored.map(x=>x.m); best=moves[0];
      if(scored[0].v>9000) break;
    }
  }catch(e){}
  if(level===1&&Math.random()<0.3) best=moves[Math.random()*Math.min(3,moves.length)|0];
  return best;
}

/* ---------- Oberfläche ---------- */
const META={
  id:'muehle', name:'MÜHLE', untertitel:'NAVIGATIONSRASTER 7x7',
  farben:[{name:'Senf',hex:'#e8a93a',dunkel:'#b07a22'},{name:'Petrol',hex:'#2f8a90',dunkel:'#123e42'}],
  akzent:{name:'Senf',hex:'#e8a93a'},
  stufen:['Leicht','Mittel','Schwer'],
  regeln:[
    {titel:'Setzphase.',text:'Beide Seiten setzen abwechselnd je 9 Steine auf freie Punkte des Bretts.'},
    {titel:'Ziehphase.',text:'Sind alle Steine gesetzt, wird ein eigener Stein entlang einer Linie auf einen freien Nachbarpunkt gezogen.'},
    {titel:'Springen.',text:'Wer nur noch 3 Steine hat, darf mit jedem Zug auf einen beliebigen freien Punkt springen.'},
    {titel:'Mühle.',text:'Drei eigene Steine in einer Reihe entlang einer Linie bilden eine Mühle. Wer eine Mühle schließt, nimmt einen gegnerischen Stein vom Brett.'},
    {titel:'Schutz.',text:'Steine in einer Mühle dürfen nicht geschlagen werden. Nur wenn alle gegnerischen Steine in Mühlen stehen, darf aus einer Mühle geschlagen werden.'},
    {titel:'Verlust.',text:'Wer nach der Setzphase weniger als 3 Steine hat oder am Zug keinen legalen Zug mehr hat, verliert.'},
    {titel:'Remis.',text:'Erscheint dieselbe Stellung zum dritten Mal oder vergehen in der Ziehphase 50 Züge ohne Schlag, endet die Partie unentschieden.'},
    {titel:'Bedienung.',text:'Stein antippen, dann den Zielpunkt. Kreuze zeigen mögliche Ziele, rote Ringe schlagbare Steine. „◀ Zug“ nimmt den letzten Zug zurück.'}
  ],
  // Vorschaugrafik für die Spielauswahl, in den eigenen Spielfarben
  vorschau(){ const [a,b]=META.farben;
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#0c0a0c"/>
      <g fill="none" stroke="#f0e2c4" stroke-width="1.2"><rect x="14" y="14" width="72" height="72"/><rect x="30" y="30" width="40" height="40"/><rect x="42" y="42" width="16" height="16"/>
      <path d="M50 14V42M50 58V86M14 50H42M58 50H86"/></g>
      <g fill="${a.hex}"><circle cx="14" cy="14" r="5"/><circle cx="50" cy="14" r="5"/><circle cx="86" cy="14" r="5"/></g>
      <g fill="${b.hex}"><circle cx="42" cy="50" r="5"/><circle cx="70" cy="70" r="5"/><circle cx="14" cy="86" r="5"/></g></svg>`; }
};
const CSS=`
.muehle .tray{display:flex;justify-content:space-between;align-items:center;padding:9px 4px;font-size:12px;color:var(--elf-40)}
.muehle .who{letter-spacing:.1em;margin-right:8px;padding-left:7px;border-left:3px solid var(--spieler1)}
.muehle .who.s{color:var(--spieler1-text);border-color:var(--spieler1)} .muehle .who.p{color:var(--spieler2-text);border-color:var(--spieler2)}
.muehle .stones{display:inline-flex;gap:3px;vertical-align:middle;margin-left:4px}
.muehle .stones i{width:9px;height:9px;display:inline-block;border-radius:1px}
.muehle .stones i.s{background:var(--spieler1)} .muehle .stones i.p{background:var(--spieler2)}
.muehle .wrap{width:100%;aspect-ratio:1;position:relative}
.muehle svg{width:100%;height:100%;display:block}
.muehle .grid{stroke:var(--spieler2-d);stroke-width:.25;fill:none}
.muehle .lines{stroke:var(--elf);stroke-width:.55;fill:none;opacity:.85}
.muehle .ring-coords text{fill:var(--elf-40);font-family:var(--mono);font-size:2.6px;letter-spacing:.2px}
.muehle .ring-coords line{stroke:var(--elf-40);stroke-width:.3}
.muehle .bracket{stroke:var(--akzent);stroke-width:.7;fill:none}
.muehle .pt{fill:var(--elf);opacity:.9}
.muehle .hit{fill:transparent;cursor:pointer}
.muehle .stone{stroke-width:.35}
.muehle .stone.s{fill:var(--spieler1);stroke:var(--spieler1-d)} .muehle .stone.p{fill:var(--spieler2);stroke:var(--spieler2-d)}
.muehle .core{fill:var(--schwarz);opacity:.55}
.muehle .sel{fill:none;stroke:var(--elf);stroke-width:.5;stroke-dasharray:1.4 1}
.muehle .go{stroke:var(--spieler1);stroke-width:.5;fill:none}
.muehle .go2{stroke:var(--spieler2);stroke-width:.5;fill:none}
.muehle .take{fill:none;stroke:var(--rot);stroke-width:.9}
.muehle .last{fill:none;stroke:var(--elf-40);stroke-width:.35}
.muehle .mill{stroke:var(--rot);stroke-width:1.1;opacity:.7}
.muehle .stone-g{transition:transform .18s ease-out;will-change:transform}
.muehle .stone-g.pop .inner{animation:mh-pop .12s ease-out}
@keyframes mh-pop{from{transform:scale(.6)}to{transform:scale(1)}}
.muehle .flash .stone,.muehle .mill.flash{animation:mh-flash .15s 2}
@keyframes mh-flash{0%,100%{opacity:1}50%{opacity:.15}}
.muehle .gone .stone{animation:mh-shrink .25s ease-in forwards}
.muehle .gone .core{display:none}
.muehle .ring{fill:none;stroke:var(--elf);stroke-width:.3;animation:mh-ringfade .25s ease-out forwards}
@keyframes mh-shrink{to{transform:scale(0)}}
@keyframes mh-ringfade{to{opacity:0;transform:scale(1.5)}}
@media (prefers-reduced-motion:reduce){
  .muehle .stone-g.pop .inner,.muehle .flash .stone,.muehle .mill.flash,.muehle .gone .stone,.muehle .ring{animation:none}
  .muehle .stone-g{transition:none}
}`;
const STEP=12.2, OFF=13.4;
const xy=i=>[OFF+POS[i][0]*STEP,OFF+POS[i][1]*STEP];
let H=null, root=null, styleEl=null, gen=0; // H = Hooks der Hülle, gen = Generation gegen verspätete Timer
let S, mode, selected=-1, lastTo=-1, over=false, thinking=false, cap=[0,0,0], history=[], moveNo=0, twoPlayer=false, reps=new Map(), started=false, level=2;
let stoneEls={}, flashMill=null; // stoneEls: Feldindex -> <g> des Steins; flashMill: Felder der gerade geschlossenen Mühle
const q=id=>root.querySelector('#'+id);
const isHumanTurn=()=>twoPlayer||S.turn===P1;
const farbe=p=>META.farben[p-1].name;
const nameOf=p=>p===P1?(twoPlayer?farbe(P1).toUpperCase():'DU'):(twoPlayer?farbe(P2).toUpperCase():'COMPUTER');
const reduceMotion=()=>!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const restartClass=(el,cls)=>{ el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); };
const millCells=(b,i,p)=>[...new Set(MILLS_AT[i].filter(m=>m.every(j=>b[j]===p)).flat())];

function drawBoard(){
  const G=q('grid'), R=q('ring'), B=q('brackets'), L=q('lines'), P=q('pts'), Hh=q('hits');
  for(let k=0;k<=6;k++){ const c=OFF+k*STEP; G.insertAdjacentHTML('beforeend',`<line x1="${c}" y1="${OFF}" x2="${c}" y2="${OFF+6*STEP}"/><line x1="${OFF}" y1="${c}" x2="${OFF+6*STEP}" y2="${c}"/>`); }
  const cols='ABCDEFG';
  for(let k=0;k<7;k++){ const c=OFF+k*STEP;
    R.insertAdjacentHTML('beforeend',`<text x="${c}" y="6.2" text-anchor="middle">${cols[k]}</text><line x1="${c}" y1="7.5" x2="${c}" y2="9.5"/>`);
    R.insertAdjacentHTML('beforeend',`<text x="${c}" y="96.4" text-anchor="middle">${cols[k]}</text><line x1="${c}" y1="90.5" x2="${c}" y2="92.5"/>`);
    R.insertAdjacentHTML('beforeend',`<text x="5" y="${c+0.9}" text-anchor="middle">${k+1}</text><line x1="7.5" y1="${c}" x2="9.5" y2="${c}"/>`);
    R.insertAdjacentHTML('beforeend',`<text x="95" y="${c+0.9}" text-anchor="middle">${k+1}</text><line x1="90.5" y1="${c}" x2="92.5" y2="${c}"/>`);
  }
  for(let k=0;k<60;k++){ if(k%10===0) continue; const t=2+k*1.6; if(t<8.5||t>91.5) continue;
    R.insertAdjacentHTML('beforeend',`<line x1="${t}" y1="8.8" x2="${t}" y2="9.5"/><line x1="${t}" y1="90.5" x2="${t}" y2="91.2"/><line x1="8.8" y1="${t}" x2="9.5" y2="${t}"/><line x1="90.5" y1="${t}" x2="91.2" y2="${t}"/>`);
  }
  [[1,1,1,1],[99,1,-1,1],[1,99,1,-1],[99,99,-1,-1]].forEach(([x,y,dx,dy])=>B.insertAdjacentHTML('beforeend',`<path d="M${x} ${y+dy*7} L${x} ${y} L${x+dx*7} ${y}"/>`));
  const sq=(a,c)=>{ const [x1,y1]=xy(a),[x2,y2]=xy(c); L.insertAdjacentHTML('beforeend',`<rect x="${x1}" y="${y1}" width="${x2-x1}" height="${y2-y1}"/>`); };
  sq(0,23); sq(3,20); sq(6,17);
  [[1,7],[9,11],[12,14],[16,22]].forEach(([a,b])=>{ const [x1,y1]=xy(a),[x2,y2]=xy(b); L.insertAdjacentHTML('beforeend',`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`); });
  for(let i=0;i<24;i++){ const [x,y]=xy(i);
    P.insertAdjacentHTML('beforeend',`<rect class="pt" x="${x-1.1}" y="${y-1.1}" width="2.2" height="2.2"/>`);
    Hh.insertAdjacentHTML('beforeend',`<circle class="hit" cx="${x}" cy="${y}" r="6" data-i="${i}"/>`);
  }
  Hh.addEventListener('click',e=>{ const i=e.target.dataset.i; if(i!==undefined) onTap(+i); });
}

/* Steine: Elemente werden je Feld wiederverwendet; Ziehen verschiebt nur das Element (CSS-Transition) */
function makeStone(i,p,pop){
  const [x,y]=xy(i), g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','stone-g'+(pop?' pop':'')); g.dataset.p=p;
  g.style.transform=`translate(${x}px,${y}px)`;
  g.innerHTML=`<g class="inner"><circle class="stone ${p===P1?'s':'p'}" r="4"/><circle class="core" r="1.1"/></g>`;
  return g;
}
function moveStone(g,i){ const [x,y]=xy(i); g.style.transform=`translate(${x}px,${y}px)`; }
function dissolveStone(g){
  if(reduceMotion()){ g.remove(); return; }
  g.classList.add('gone'); g.querySelector('.inner').insertAdjacentHTML('beforeend','<circle class="ring" r="4"/>');
  setTimeout(()=>g.remove(),260);
}
function renderStones(reset){
  const St=q('stones'), b=S.b;
  if(reset){ St.innerHTML=''; stoneEls={}; for(let i=0;i<24;i++) if(b[i]) St.appendChild(stoneEls[i]=makeStone(i,b[i],false)); return; }
  const gone=[], appeared=[];
  for(let i=0;i<24;i++){
    const el=stoneEls[i], p=el?+el.dataset.p:0;
    if(el&&b[i]!==p) gone.push({i,el,p});
    if(b[i]&&b[i]!==p) appeared.push(i);
  }
  for(const p of [P1,P2]){
    const g=gone.filter(x=>x.p===p), a=appeared.filter(i=>b[i]===p);
    if(g.length===1&&a.length===1){ delete stoneEls[g[0].i]; stoneEls[a[0]]=g[0].el; moveStone(g[0].el,a[0]); } // Ziehen oder Springen
    else {
      for(const x of g){ if(stoneEls[x.i]===x.el) delete stoneEls[x.i]; dissolveStone(x.el); }              // geschlagen
      for(const i of a) St.appendChild(stoneEls[i]=makeStone(i,p,true));                                      // gesetzt
    }
  }
  if(flashMill) for(const i of flashMill) if(stoneEls[i]) restartClass(stoneEls[i],'flash');
}
function render(opts){
  const M=q('marks'), Ml=q('mills'); M.innerHTML=''; Ml.innerHTML='';
  const fm=flashMill?new Set(flashMill):null;
  for(const m of MILLS){ const p=S.b[m[0]]; if(p&&S.b[m[1]]===p&&S.b[m[2]]===p){ const [x1,y1]=xy(m[0]),[x2,y2]=xy(m[2]);
    Ml.insertAdjacentHTML('beforeend',`<line class="mill${fm&&m.every(i=>fm.has(i))?' flash':''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`); } }
  renderStones(!!(opts&&opts.reset));
  flashMill=null;
  if(lastTo>=0){ const [x,y]=xy(lastTo); M.insertAdjacentHTML('beforeend',`<rect class="last" x="${x-5.2}" y="${y-5.2}" width="10.4" height="10.4"/>`); }
  if(started&&!over&&!thinking&&isHumanTurn()){
    const p=S.turn, gc=p===P1?'go':'go2';
    if(mode==='remove'){ for(const r of removable(S.b,3-p)){ const [x,y]=xy(r); M.insertAdjacentHTML('beforeend',`<circle class="take" cx="${x}" cy="${y}" r="5.4"/>`); } }
    else {
      const ph=phase(S,p);
      let targets=[];
      if(ph==='place') targets=[...Array(24).keys()].filter(t=>!S.b[t]);
      else if(selected>=0){ const [x,y]=xy(selected); M.insertAdjacentHTML('beforeend',`<circle class="sel" cx="${x}" cy="${y}" r="5.6"/>`);
        targets=ph==='fly'?[...Array(24).keys()].filter(t=>!S.b[t]):ADJ[selected].filter(t=>!S.b[t]); }
      for(const t of targets){ const [x,y]=xy(t); M.insertAdjacentHTML('beforeend',`<path class="${gc}" d="M${x-1.6} ${y}H${x+1.6}M${x} ${y-1.6}V${y+1.6}"/>`); }
    }
  }
  q('handS').innerHTML='<i class="s"></i>'.repeat(S.hand[P1]); q('handP').innerHTML='<i class="p"></i>'.repeat(S.hand[P2]);
  q('capS').textContent=cap[P1]; q('capP').textContent=cap[P2];
  q('nameS').textContent=nameOf(P1); q('nameP').textContent=nameOf(P2);
}
function hud(msg,cls){
  const ph={place:'SETZEN',move:'ZIEHEN',fly:'SPRINGEN'}[phase(S,S.turn)];
  let row=`ZUG ${String(moveNo).padStart(2,'0')} | PHASE ${ph} | ${nameOf(S.turn)} AM ZUG`;
  if(S.hand[P1]===0&&S.hand[P2]===0) row+=` | OHNE SCHLAG ${String(S.nc).padStart(2,'0')}`;
  H.hudRow(row); H.hud(msg,cls||'');
}
function statusForHuman(){
  const p=S.turn, who=twoPlayer?farbe(p):'Du';
  if(mode==='remove') return hud(`Mühle! ${who==='Du'?'Tipp':who+', tipp'} auf einen gegnerischen Stein.`,'alarm');
  const ph=phase(S,p);
  if(ph==='place') return hud(`${who}: Stein auf ein freies Feld setzen.`);
  if(ph==='fly') return hud(`${who}: nur noch 3 Steine - Springen erlaubt.`);
  hud(selected>=0?'Zielfeld wählen.':`${who}: Stein zum Ziehen wählen.`);
}
function snapshot(){ history.push({S:clone(S),cap:cap.slice(),lastTo,moveNo,reps:new Map(reps)}); if(history.length>60) history.shift(); }

function onTap(i){
  if(!started||over||thinking||!isHumanTurn()) return;
  const p=S.turn, b=S.b;
  if(mode==='remove'){
    if(removable(b,3-p).includes(i)){ b[i]=0; cap[p]++; S.nc=0; mode='play'; H.sfx.take(); endTurn(); }
    return;
  }
  const ph=phase(S,p);
  if(ph==='place'){
    if(b[i]!==0) return;
    snapshot(); b[i]=p; S.hand[p]--; S.nc=0; lastTo=i; H.sfx.place(); afterMove(i); return;
  }
  if(b[i]===p){ selected=(selected===i)?-1:i; render(); statusForHuman(); return; }
  if(selected>=0&&b[i]===0&&(ph==='fly'||ADJ[selected].includes(i))){
    snapshot(); b[selected]=0; b[i]=p; S.nc++; lastTo=i; selected=-1; H.sfx.move(); afterMove(i);
  }
}
function afterMove(i){
  const p=S.turn; moveNo++;
  if(inMill(S.b,i,p)&&count(S.b,3-p)>0){ mode='remove'; flashMill=millCells(S.b,i,p); H.sfx.mill(); render(); statusForHuman(); }
  else endTurn();
}
// Stellung eintragen, dann Verlust und Remis prüfen. Liefert true, wenn die Partie zu Ende ist.
function recordAndCheck(mover){
  const k=posKey(S); reps.set(k,(reps.get(k)||0)+1);
  if(isLoss(S,S.turn)){ finish({win:mover}); return true; }
  const d=drawReason(S,reps); if(d){ finish({draw:true,grund:d==='rep'?'Stellung dreimal wiederholt.':'50 Züge ohne Schlag.'}); return true; }
  return false;
}
function endTurn(){
  const p=S.turn; S.turn=3-p; render();
  if(recordAndCheck(p)) return;
  if(twoPlayer){ statusForHuman(); return; }
  aiTurn();
}
function aiTurn(){
  thinking=true; hud('Computer berechnet Zug …'); render();
  const lv=level, g=gen;
  H.progress(380+(lv===3?LEVELS[3].budget:0));
  setTimeout(()=>{
    if(g!==gen) return;
    const m=bestMove(S,P2,lv,reps), full=apply(S,m,P2);
    lastTo=m.to; moveNo++;
    const done=()=>{ H.progress(0); thinking=false; render(); if(recordAndCheck(P2)) return; statusForHuman(); };
    if(m.remove>=0){ // erst ziehen und Mühle blitzen, dann schlagen
      S=apply(S,{from:m.from,to:m.to,remove:-1},P2); flashMill=millCells(S.b,m.to,P2); render(); H.sfx.mill();
      setTimeout(()=>{ if(g!==gen) return; S=full; cap[P2]++; render(); H.sfx.take(); done(); },320);
    } else { S=full; render(); if(m.from<0) H.sfx.place(); else H.sfx.move(); done(); }
  },380);
}
function finish(result){ over=true; render(); H.onEnd(result); }

/* Schnittstelle zur Hülle */
function mount(container,hooks){
  H=hooks; root=container; root.classList.add('muehle');
  styleEl=document.createElement('style'); styleEl.textContent=CSS; document.head.appendChild(styleEl);
  root.innerHTML=`
<div class="tray"><span><span class="who p" id="nameP">COMPUTER</span>Vorrat <span class="stones" id="handP"></span></span><span>geschlagen <b id="capP">0</b></span></div>
<div class="wrap"><svg viewBox="0 0 100 100" aria-label="Mühlebrett">
  <rect width="100" height="100" fill="#0c0a0c"/>
  <g id="grid" class="grid"></g><g id="ring" class="ring-coords"></g><g id="brackets" class="bracket"></g>
  <g id="mills"></g><g id="lines" class="lines"></g><g id="pts"></g><g id="marks"></g><g id="stones"></g><g id="hits"></g>
</svg></div>
<div class="tray"><span><span class="who s" id="nameS">DU</span>Vorrat <span class="stones" id="handS"></span></span><span>geschlagen <b id="capS">0</b></span></div>`;
  drawBoard();
  S=newState(P1); started=false; over=false; thinking=false; history=[]; cap=[0,0,0]; moveNo=0; lastTo=-1; selected=-1; mode='play'; reps=new Map();
  render({reset:true});
}
function newGame(opts){
  gen++; twoPlayer=!!opts.twoPlayer; level=opts.level||2;
  S=newState(opts.starter===2?P2:P1); mode='play'; selected=-1; lastTo=-1; over=false; thinking=false; cap=[0,0,0]; history=[]; moveNo=0; reps=new Map(); started=true;
  reps.set(posKey(S),1); flashMill=null; H.progress(0);
  render({reset:true});
  if(!twoPlayer&&S.turn===P2) aiTurn(); else statusForHuman();
}
function undo(){
  if(!canUndo()) return;
  const h=history.pop(); S=h.S; cap=h.cap; lastTo=h.lastTo; moveNo=h.moveNo; reps=h.reps;
  mode='play'; selected=-1; flashMill=null; render({reset:true}); statusForHuman();
}
function canUndo(){ return started&&!over&&!thinking&&history.length>0; }
function setLevel(l){ level=l; }
function destroy(){
  gen++; H&&H.progress(0);
  if(styleEl){ styleEl.remove(); styleEl=null; }
  if(root){ root.innerHTML=''; root.classList.remove('muehle'); root=null; }
  stoneEls={}; started=false; H=null;
}
const api={meta:META,mount,newGame,undo,canUndo,setLevel,destroy,
  debug(){ return {S,mode,selected,lastTo,over,thinking,cap,history,moveNo,reps,stoneEls,xy,twoPlayer,started}; }};
if(typeof window!=='undefined'){ window.GAMES=window.GAMES||{}; window.GAMES.muehle=api; }
if(typeof module!=='undefined'&&module.exports) module.exports={POS,ADJ,MILLS,MILLS_AT,P1,P2,newState,clone,posKey,count,inMill,removable,phase,genMoves,apply,isLoss,drawReason,LEVELS,doubleMills,evaluate,orderMoves,search,bestMove,K,meta:META};
})();
