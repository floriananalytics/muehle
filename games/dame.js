/* games/dame.js - Dame nach deutschen Regeln: Brettmodell, Zuggenerator, KI, SVG-Brett und Animationen.
   Schnittstelle zur Hülle: window.GAMES.dame. Dieselbe Datei läuft als Web Worker (Stufe Schwer) und unter Node (Prüfungen). */
(function(){
'use strict';
/* ---------- Brett ---------- */
// 32 dunkle Felder, Index 0-31: Reihe 0 unten, innerhalb der Reihe von links nach rechts. a1 (Reihe 0, Spalte 0) ist dunkel.
// Werte: 0 leer, 1 Olive Stein, 2 Pflaume Stein, 3 Olive Dame, 4 Pflaume Dame. Olive zieht nach oben (Reihe +1), Pflaume nach unten.
const P1=1, P2=2;
const RC=[], IDX={};
for(let i=0;i<32;i++){ const r=i>>2, c=2*(i&3)+(r%2===0?0:1); RC.push([r,c]); IDX[r*8+c]=i; }
const at=(r,c)=>(r<0||r>7||c<0||c>7||IDX[r*8+c]===undefined)?-1:IDX[r*8+c];
const DIRS=[[1,1],[1,-1],[-1,1],[-1,-1]]; // 0,1 = vorwärts für Olive; 2,3 = vorwärts für Pflaume
const NB=RC.map(([r,c])=>DIRS.map(([dr,dc])=>at(r+dr,c+dc)));
const COORD=i=>'abcdefgh'[RC[i][1]]+(RC[i][0]+1);
const CENTER=new Set(RC.map((rc,i)=>i).filter(i=>RC[i][0]>=2&&RC[i][0]<=5&&RC[i][1]>=2&&RC[i][1]<=5));
const owner=v=>v===1||v===3?1:v===2||v===4?2:0;
const isKing=v=>v>=3;
const lastRow=p=>p===P1?7:0;
function newState(){ const b=new Array(32).fill(0); for(let i=0;i<12;i++) b[i]=P1; for(let i=20;i<32;i++) b[i]=P2; return {b, turn:P1, nc:0}; } // nc = Züge ohne Schlag und ohne Steinzug
function clone(s){ return {b:s.b.slice(), turn:s.turn, nc:s.nc}; }
function posKey(s){ return s.b.join('')+'|'+s.turn; }
function count(b,p){ let n=0; for(const v of b) if(owner(v)===p) n++; return n; }
function countMen(b,p){ let n=0; for(const v of b) if(v===p) n++; return n; }

/* ---------- Züge ---------- */
// Alle vollständigen Schlagfolgen des Steins auf i. Geschlagene Steine bleiben bis zum Ende stehen und dürfen nicht zweimal übersprungen werden.
function captures(b,i,p,out){
  const v=b[i], king=isKing(v), opp=3-p, dirs=king?[0,1,2,3]:(p===P1?[0,1]:[2,3]), last=lastRow(p);
  const path=[i], caps=[];
  b[i]=0; // das Ausgangsfeld ist während des Zugs frei
  const rec=pos=>{
    let found=false;
    for(const d of dirs){
      if(!king){
        const j=NB[pos][d]; if(j<0||owner(b[j])!==opp||caps.includes(j)) continue;
        const k=NB[j][d]; if(k<0||b[k]!==0) continue;
        found=true; path.push(k); caps.push(j);
        if(RC[k][0]===last) out.push({path:path.slice(),captured:caps.slice(),promote:true}); // Umwandlung beendet den Zug
        else rec(k);
        path.pop(); caps.pop();
      } else {
        let j=NB[pos][d]; while(j>=0&&b[j]===0) j=NB[j][d];
        if(j<0||owner(b[j])!==opp||caps.includes(j)) continue;
        let k=NB[j][d]; if(k<0||b[k]!==0) continue;
        found=true; caps.push(j);
        while(k>=0&&b[k]===0){ path.push(k); rec(k); path.pop(); k=NB[k][d]; } // jedes freie Feld hinter dem Stein ist ein Landefeld
        caps.pop();
      }
    }
    if(!found&&path.length>1) out.push({path:path.slice(),captured:caps.slice(),promote:false});
  };
  rec(i); b[i]=v;
}
function simpleMoves(b,i,p,out){
  const v=b[i], king=isKing(v), dirs=king?[0,1,2,3]:(p===P1?[0,1]:[2,3]), last=lastRow(p);
  for(const d of dirs){
    let j=NB[i][d];
    if(!king){ if(j>=0&&b[j]===0) out.push({path:[i,j],captured:[],promote:RC[j][0]===last}); }
    else while(j>=0&&b[j]===0){ out.push({path:[i,j],captured:[],promote:false}); j=NB[j][d]; }
  }
}
// Nur vollständige, legale Züge: bei Schlagzwang ausschließlich Schlagfolgen (freie Wahl, kein Mehrheitsschlag)
function genMoves(s,p){
  const b=s.b, out=[];
  for(let i=0;i<32;i++) if(owner(b[i])===p) captures(b,i,p,out);
  if(out.length) return out;
  for(let i=0;i<32;i++) if(owner(b[i])===p) simpleMoves(b,i,p,out);
  return out;
}
function apply(s,m){
  const n={b:s.b.slice(), turn:3-s.turn, nc:0};
  const from=m.path[0], to=m.path[m.path.length-1], v=s.b[from];
  n.b[from]=0; for(const c of m.captured) n.b[c]=0;
  n.b[to]=m.promote?v+2:v;
  n.nc=(m.captured.length||!isKing(v))?0:s.nc+1;
  return n;
}
function isLoss(s,p){ return count(s.b,p)===0||genMoves(s,p).length===0; }
function drawReason(s,reps){
  if(s.nc>=30) return 'thirty';
  if((reps.get(posKey(s))||0)>=3) return 'rep';
  return null;
}

/* ---------- KI ---------- */
const LEVELS={1:{depth:2,budget:Infinity},2:{depth:5,budget:Infinity},3:{depth:14,budget:3000}};
// Bewertung aus Sicht des Spielers p
function evaluate(s,p){
  const b=s.b, opp=3-p, men=[0,0,0], kings=[0,0,0], adv=[0,0,0], back=[0,0,0], cen=[0,0,0];
  let total=0;
  for(let i=0;i<32;i++){ const x=b[i]; if(!x) continue; const o=owner(x), r=RC[i][0]; total++;
    if(isKing(x)) kings[o]++;
    else { men[o]++; adv[o]+=2*(o===P1?r:7-r); if(r===(o===P1?0:7)) back[o]+=8; }
    if(CENTER.has(i)) cen[o]+=4;
  }
  const mat=100*(men[p]-men[opp])+300*(kings[p]-kings[opp]);
  let v=mat+(adv[p]-adv[opp])+(cen[p]-cen[opp]);
  if(men[opp]>0) v+=back[p]; if(men[p]>0) v-=back[opp]; // Grundreihe schützt nur, solange der Gegner noch Steine hat
  if(mat>0) v+=(24-total)*2; else if(mat<0) v-=(24-total)*2; // bei Vorteil Abtausch fördern
  v+=genMoves(s,p).length-genMoves(s,opp).length;
  return v;
}
let nodes=0, deadline=0;
const moveKey=m=>m.path.join('-');
// K = Kontext der laufenden Zugberechnung; tt: Stellungsschlüssel -> {d, v, f: 0 exakt | 1 untere | 2 obere Schranke, m: bester Zug}
const K={me:P2,level:2,hist:new Map(),path:new Map(),tt:new Map(),repAdj:0};
function orderMoves(moves,ttMove){
  const rank=m=>(m.captured.length?1000+10*m.captured.length:0)+(m.promote?100:0)+(ttMove&&moveKey(m)===ttMove?50:0);
  return moves.map(m=>({m,r:rank(m)})).sort((x,y)=>y.r-x.r).map(x=>x.m);
}
// Negamax mit Alpha-Beta; ext zählt die Ruhesuche: bei Schlagzwang wird über die Tiefe hinaus gesucht (höchstens 8 Halbzüge)
function search(s,depth,alpha,beta,ext){
  if((++nodes&255)===0&&Date.now()>deadline) throw 'timeout';
  const p=s.turn;
  if(s.nc>=30) return 0;
  const moves=genMoves(s,p);
  if(!moves.length) return -10000-Math.max(depth,0);
  const key=posKey(s), a0=alpha; let adj=0;
  if(K.level===3){
    const seen=(K.hist.get(key)||0)+(K.path.get(key)||0);
    if(seen>=2) return 0;
    if(seen>0) adj=K.repAdj;
  }
  const e=K.tt.get(key);
  if(e&&e.d>=depth){ if(e.f===0) return e.v; if(e.f===1&&e.v>=beta) return e.v; if(e.f===2&&e.v<=alpha) return e.v; }
  const forced=moves[0].captured.length>0;
  if(depth<=0&&!(forced&&ext<8)) return evaluate(s,p)+adj;
  K.path.set(key,(K.path.get(key)||0)+1);
  let best=-Infinity, bm=null;
  for(const m of orderMoves(moves,e&&e.m)){
    const v=-search(apply(s,m),depth-1,-beta,-alpha,depth<=0?ext+1:ext);
    if(v>best){ best=v; bm=m; }
    if(best>alpha) alpha=best;
    if(alpha>=beta) break;
  }
  K.path.set(key,K.path.get(key)-1);
  best+=adj;
  K.tt.set(key,{d:depth,v:best,f:best<=a0?2:best>=beta?1:0,m:bm?moveKey(bm):null});
  return best;
}
function bestMove(s0,me,level,hist){
  const s=clone(s0); s.turn=me;
  let moves=genMoves(s,me); if(!moves.length) return null;
  const cfg=LEVELS[level]||LEVELS[2];
  K.me=me; K.level=level; K.hist=hist||new Map(); K.tt=new Map(); K.path=new Map();
  K.repAdj=level===3?(evaluate(s,me)>=0?-15:15):0; // bekannte Stellungen: bei Vorteil meiden, bei Nachteil anstreben
  deadline=Date.now()+cfg.budget; nodes=0;
  moves=orderMoves(moves,null);
  let best=moves[0];
  if(moves.length===1) return best;
  try{
    for(let d=level===3?1:cfg.depth; d<=cfg.depth; d++){
      K.path.clear();
      const scored=moves.map(m=>({m,v:-search(apply(s,m),d-1,-Infinity,Infinity,0)}));
      scored.sort((x,y)=>y.v-x.v); moves=scored.map(x=>x.m); best=moves[0];
      if(scored[0].v>9000) break;
    }
  }catch(e){}
  if(level===1&&Math.random()<0.3) best=moves[Math.random()*Math.min(3,moves.length)|0];
  return best;
}

/* ---------- Web Worker (Stufe Schwer) ---------- */
if(typeof importScripts==='function'){
  self.onmessage=e=>{ const {b,turn,nc,me,level,budget,hist,id}=e.data; if(budget) LEVELS[3].budget=budget;
    const m=bestMove({b,turn,nc},me,level,new Map(hist||[])); self.postMessage({id,move:m}); };
}

/* ---------- Oberfläche ---------- */
const META={
  id:'dame', name:'DAME', untertitel:'SCHACHBRETT 8x8',
  farben:[{name:'Olive',hex:'#9a9a3c',dunkel:'#5f6020'},{name:'Pflaume',hex:'#8a4f8e',dunkel:'#4f2a54'}],
  akzent:{name:'Pflaume',hex:'#8a4f8e'},
  stufen:['Leicht','Mittel','Schwer'],
  regeln:[
    {titel:'Aufstellung.',text:'8x8-Brett, gespielt wird auf den dunklen Feldern. Je 12 Steine in den ersten drei Reihen. Olive beginnt.'},
    {titel:'Stein.',text:'Zieht ein Feld diagonal vorwärts auf ein freies Feld. Schlägt diagonal vorwärts über einen benachbarten gegnerischen Stein auf das freie Feld dahinter, nie rückwärts.'},
    {titel:'Dame.',text:'Zieht beliebig weit diagonal in alle Richtungen. Schlägt einen einzelnen Stein auf ihrer Linie, sofern die Felder davor frei sind, und landet auf einem beliebigen freien Feld dahinter.'},
    {titel:'Schlagzwang.',text:'Wer schlagen kann, muss schlagen. Bei mehreren Möglichkeiten freie Wahl, kein Mehrheitsschlag.'},
    {titel:'Mehrfachschlag.',text:'Ein Mehrfachschlag muss vollständig ausgeführt werden, Richtungswechsel sind erlaubt. Geschlagene Steine bleiben bis zum Ende stehen und werden nicht zweimal übersprungen.'},
    {titel:'Umwandlung.',text:'Ein Stein auf der gegnerischen Grundreihe wird zur Dame. Geschieht das mitten im Mehrfachschlag, endet der Zug dort.'},
    {titel:'Verlust.',text:'Wer keine Steine mehr hat oder am Zug keinen legalen Zug hat, verliert.'},
    {titel:'Remis.',text:'Dreifache Stellungswiederholung oder 30 Halbzüge ohne Schlag und ohne Steinzug.'}
  ],
  vorschau(){ const [a,b]=META.farben; let sq='', st='';
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) if((r+c)%2===0) sq+=`<rect x="${14+c*9}" y="${14+(7-r)*9}" width="9" height="9" fill="#f0e2c4" opacity=".15"/>`;
    const put=(r,c,f,k)=>{ st+=`<circle cx="${18.5+c*9}" cy="${18.5+(7-r)*9}" r="3.3" fill="${f}"/>`; if(k) st+=`<circle cx="${18.5+c*9}" cy="${18.5+(7-r)*9}" r="2" fill="none" stroke="#f0e2c4" stroke-width=".6"/>`; };
    [[0,0],[0,2],[1,1],[2,2],[2,4],[3,3]].forEach(([r,c])=>put(r,c,a.hex,false)); put(1,5,a.hex,true);
    [[7,1],[7,5],[6,4],[5,3],[5,7],[4,6]].forEach(([r,c])=>put(r,c,b.hex,false)); put(6,0,b.hex,true);
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#0c0a0c"/>${sq}<rect x="14" y="14" width="72" height="72" fill="none" stroke="#f0e2c4" stroke-width=".8" opacity=".5"/>${st}</svg>`; }
};
const CSS=`
.dame .tray{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 4px;font-size:12px;color:var(--elf-40);flex-wrap:wrap}
.dame .who{letter-spacing:.1em;margin-right:6px;padding-left:7px;border-left:3px solid var(--spieler1)}
.dame .who.s{color:var(--spieler1-text);border-color:var(--spieler1)} .dame .who.p{color:var(--spieler2-text);border-color:var(--spieler2)}
.dame .stones{display:inline-flex;gap:2px;vertical-align:middle;margin:0 6px 0 3px}
.dame .stones i{width:8px;height:8px;display:inline-block;border-radius:1px;box-sizing:border-box}
.dame .stones i.s{background:var(--spieler1)} .dame .stones i.p{background:var(--spieler2)}
.dame .stones i.k{background:transparent;border:2px double var(--spieler1)} .dame .stones i.k.p{border-color:var(--spieler2)}
.dame .wrap{width:100%;aspect-ratio:1;position:relative}
.dame svg{width:100%;height:100%;display:block}
.dame .sq{fill:var(--elf);opacity:.15}
.dame .grid{stroke:var(--elf-15);stroke-width:.25;fill:none}
.dame .coords text{fill:var(--elf-40);font-family:var(--mono);font-size:2.6px;letter-spacing:.2px}
.dame .bracket{stroke:var(--akzent);stroke-width:.7;fill:none}
.dame .hit{fill:transparent;cursor:pointer}
.dame .stone{stroke-width:.35}
.dame .stone.s{fill:var(--spieler1);stroke:var(--spieler1-d)} .dame .stone.p{fill:var(--spieler2);stroke:var(--spieler2-d)}
.dame .core{fill:var(--schwarz);opacity:.55}
.dame .king{fill:none;stroke:var(--elf);stroke-width:.35}
.dame .sel{fill:none;stroke:var(--elf);stroke-width:.5;stroke-dasharray:1.4 1}
.dame .can{fill:none;stroke:var(--elf-40);stroke-width:.35}
.dame .go{stroke:var(--spieler1);stroke-width:.5;fill:none} .dame .go2{stroke:var(--spieler2);stroke-width:.5;fill:none}
.dame .last{fill:none;stroke:var(--elf-40);stroke-width:.35}
.dame .stone-g{transition:transform .18s ease-out;will-change:transform}
.dame .flash .stone,.dame .flash .king{animation:dm-flash .15s 2}
@keyframes dm-flash{0%,100%{opacity:1}50%{opacity:.15}}
.dame .gone .stone{animation:dm-shrink .25s ease-in forwards}
.dame .gone .core,.dame .gone .king{display:none}
.dame .ring{fill:none;stroke:var(--elf);stroke-width:.3;animation:dm-ringfade .25s ease-out forwards}
@keyframes dm-shrink{to{transform:scale(0)}}
@keyframes dm-ringfade{to{opacity:0;transform:scale(1.5)}}
.dame .hint .go,.dame .hint .go2,.dame .hint text{animation:dm-blink .7s steps(1) infinite}
.dame .hint text{fill:var(--elf);font-family:var(--mono);font-size:2.6px}
@keyframes dm-blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){ .dame .stone-g{transition:none} .dame .flash .stone,.dame .flash .king,.dame .gone .stone,.dame .ring,.dame .hint *{animation:none} }`;
const OFF=13.4, CELL=9.6;
let H=null, root=null, styleEl=null, gen=0, worker=null, workerId=0;
let S, over=false, thinking=false, busy=false, history=[], twoPlayer=false, started=false, level=2, humanSide=P1, flip=false;
let sel=-1, pend=null, lastTo=-1, moveNo=0, reps=new Map(), stoneEls={}, hinting=false;
const q=id=>root.querySelector('#'+id);
const farbe=p=>META.farben[p-1].name;
const isHumanTurn=()=>twoPlayer||S.turn===humanSide;
const nameOf=p=>twoPlayer?farbe(p).toUpperCase():(p===humanSide?'DU':'COMPUTER');
const reduceMotion=()=>!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const restartClass=(el,cls)=>{ el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); };
const xy=i=>{ const [r,c]=RC[i], dr=flip?7-r:r, dc=flip?7-c:c; return [OFF+dc*CELL+CELL/2, OFF+(7-dr)*CELL+CELL/2]; };

function drawBoard(){
  const Sq=q('squares'), G=q('grid'), C=q('coords'), B=q('brackets'), Hh=q('hits');
  Sq.innerHTML=''; G.innerHTML=''; C.innerHTML=''; B.innerHTML=''; Hh.innerHTML='';
  for(let i=0;i<32;i++){ const [x,y]=xy(i);
    Sq.insertAdjacentHTML('beforeend',`<rect class="sq" x="${x-CELL/2}" y="${y-CELL/2}" width="${CELL}" height="${CELL}"/>`);
    Hh.insertAdjacentHTML('beforeend',`<rect class="hit" x="${x-CELL/2}" y="${y-CELL/2}" width="${CELL}" height="${CELL}" data-i="${i}"/>`);
  }
  for(let k=0;k<=8;k++){ const t=OFF+k*CELL; G.insertAdjacentHTML('beforeend',`<line x1="${t}" y1="${OFF}" x2="${t}" y2="${OFF+8*CELL}"/><line x1="${OFF}" y1="${t}" x2="${OFF+8*CELL}" y2="${t}"/>`); }
  for(let k=0;k<8;k++){ const col=flip?7-k:k, row=flip?7-k:k;
    C.insertAdjacentHTML('beforeend',`<text x="${OFF+k*CELL+CELL/2}" y="95.4" text-anchor="middle">${'abcdefgh'[col]}</text>`);
    C.insertAdjacentHTML('beforeend',`<text x="8.2" y="${OFF+(7-k)*CELL+CELL/2+0.9}" text-anchor="middle">${row+1}</text>`);
  }
  [[1,1,1,1],[99,1,-1,1],[1,99,1,-1],[99,99,-1,-1]].forEach(([x,y,dx,dy])=>B.insertAdjacentHTML('beforeend',`<path d="M${x} ${y+dy*7} L${x} ${y} L${x+dx*7} ${y}"/>`));
}
function makeStone(i,v){
  const [x,y]=xy(i), g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','stone-g'); g.dataset.v=v;
  g.style.transform=`translate(${x}px,${y}px)`;
  g.innerHTML=`<g class="inner"><circle class="stone ${owner(v)===P1?'s':'p'}" r="3.5"/><circle class="core" r="1"/>${isKing(v)?'<circle class="king" r="2.3"/>':''}</g>`;
  return g;
}
function moveStone(g,i){ const [x,y]=xy(i); g.style.transform=`translate(${x}px,${y}px)`; }
function promoteEl(g){ g.dataset.v=+g.dataset.v+2; g.querySelector('.inner').insertAdjacentHTML('beforeend','<circle class="king" r="2.3"/>'); restartClass(g,'flash'); }
function dissolveStone(g){
  if(reduceMotion()){ g.remove(); return; }
  g.classList.add('gone'); g.querySelector('.inner').insertAdjacentHTML('beforeend','<circle class="ring" r="3.5"/>');
  setTimeout(()=>g.remove(),260);
}
function renderStones(reset){
  const St=q('stones'), b=S.b;
  if(reset){ St.innerHTML=''; stoneEls={}; for(let i=0;i<32;i++) if(b[i]) St.appendChild(stoneEls[i]=makeStone(i,b[i])); return; }
  for(let i=0;i<32;i++){
    const el=stoneEls[i], v=el?+el.dataset.v:0;
    if(el&&!b[i]){ delete stoneEls[i]; dissolveStone(el); }
    else if(b[i]&&!el){ St.appendChild(stoneEls[i]=makeStone(i,b[i])); }
    else if(el&&b[i]!==v){ if(owner(b[i])===owner(v)&&isKing(b[i])) promoteEl(el); else { el.remove(); St.appendChild(stoneEls[i]=makeStone(i,b[i])); } }
  }
}
function renderMarks(){
  const M=q('marks'); M.innerHTML='';
  if(lastTo>=0&&!pend){ const [x,y]=xy(lastTo); M.insertAdjacentHTML('beforeend',`<rect class="last" x="${x-CELL/2+.4}" y="${y-CELL/2+.4}" width="${CELL-.8}" height="${CELL-.8}"/>`); }
  if(!(started&&!over&&!thinking&&!hinting&&isHumanTurn())) return;
  const p=S.turn, gc=p===P1?'go':'go2';
  const cross=t=>{ const [x,y]=xy(t); M.insertAdjacentHTML('beforeend',`<path class="${gc}" d="M${x-1.6} ${y}H${x+1.6}M${x} ${y-1.6}V${y+1.6}"/>`); };
  if(pend){ const k=pend.path.length, cur=pend.path[k-1], [x,y]=xy(cur);
    M.insertAdjacentHTML('beforeend',`<circle class="sel" cx="${x}" cy="${y}" r="4.3"/>`);
    for(const t of new Set(pend.moves.map(m=>m.path[k]).filter(t=>t!==undefined))) cross(t);
    return; }
  const legal=genMoves(S,p);
  for(const i of new Set(legal.map(m=>m.path[0]))){ if(i!==sel){ const [x,y]=xy(i); M.insertAdjacentHTML('beforeend',`<circle class="can" cx="${x}" cy="${y}" r="4.2"/>`); } }
  if(sel>=0){ const [x,y]=xy(sel); M.insertAdjacentHTML('beforeend',`<circle class="sel" cx="${x}" cy="${y}" r="4.3"/>`);
    for(const t of new Set(legal.filter(m=>m.path[0]===sel).map(m=>m.path[1]))) cross(t); }
}
function renderTrays(){
  const bottom=flip?P2:P1, top=3-bottom;
  const row=(p,who,pc,cap)=>{ const b=S.b, men=countMen(b,p), kings=count(b,p)-men, cls=p===P1?'s':'p';
    q(who).textContent=nameOf(p); q(who).className='who '+cls;
    q(pc).innerHTML=`Steine <span class="stones">${`<i class="${cls}"></i>`.repeat(men)}</span>Damen <span class="stones">${`<i class="k ${cls}"></i>`.repeat(kings)}</span>`;
    q(cap).textContent=12-count(b,3-p); };
  row(top,'nameT','pcT','capT'); row(bottom,'nameB','pcB','capB');
}
function render(opts){ renderStones(!!(opts&&opts.reset)); renderMarks(); renderTrays(); }
function hud(msg,cls){ H.hudRow(`ZUG ${String(moveNo).padStart(2,'0')} | ${nameOf(S.turn)} AM ZUG | OHNE SCHLAG ${String(S.nc).padStart(2,'0')}`); H.hud(msg,cls||''); }
function statusForHuman(){
  const who=twoPlayer?farbe(S.turn):'Du';
  if(pend) return hud('Weiter schlagen.');
  const legal=genMoves(S,S.turn);
  if(sel>=0) return hud('Zielfeld wählen.');
  if(legal.length&&legal[0].captured.length) return hud(`Schlagzwang - ${who==='Du'?'wähle':who+', wähle'} einen schlagenden Stein.`,'alarm');
  hud(`${who}: Stein wählen.`);
}
function snapshot(){ history.push({S:clone(S),lastTo,moveNo,reps:new Map(reps)}); if(history.length>60) history.shift(); }

function onTap(i){
  clearHint();
  if(!started||over||thinking||busy||hinting||!isHumanTurn()) return;
  const p=S.turn;
  if(pend){ const k=pend.path.length, next=pend.moves.filter(m=>m.path[k]===i); if(next.length) stepTo(i,next); return; }
  const legal=genMoves(S,p);
  if(owner(S.b[i])===p){ if(legal.some(m=>m.path[0]===i)){ sel=sel===i?-1:i; renderMarks(); statusForHuman(); } return; }
  if(sel<0) return;
  const next=legal.filter(m=>m.path[0]===sel&&m.path[1]===i); if(!next.length) return;
  snapshot(); pend={moves:next,path:[sel]}; sel=-1; stepTo(i,next);
}
// Ein Schritt des menschlichen Zugs: Stein gleitet, dann Fortsetzung wählen, automatisch bei nur einer Möglichkeit, oder Zug abschließen
function stepTo(i,next){
  const from=pend.path[pend.path.length-1], g=gen;
  pend.moves=next; pend.path.push(i);
  const el=stoneEls[from]; delete stoneEls[from]; stoneEls[i]=el; moveStone(el,i);
  if(next[0].captured.length) H.sfx.take(); else H.sfx.move();
  const k=pend.path.length;
  if(next.every(m=>m.path.length===k)){ busy=true; renderMarks(); setTimeout(()=>{ if(g!==gen) return; busy=false; finishMove(next[0]); },reduceMotion()?0:180); return; }
  renderMarks(); statusForHuman();
  const cont=[...new Set(next.map(m=>m.path[k]))];
  if(cont.length===1){ busy=true; setTimeout(()=>{ if(g!==gen||!pend) return; busy=false; stepTo(cont[0],next.filter(m=>m.path[k]===cont[0])); },250); }
}
// Zug abschließen (Mensch): Umwandlung zeigen, geschlagene Steine zerfallen, Zustand übernehmen
function finishMove(m){
  const to=m.path[m.path.length-1], mover=S.turn;
  if(m.promote){ promoteEl(stoneEls[to]); H.sfx.mill(); }
  for(const c of m.captured){ const el=stoneEls[c]; if(el){ delete stoneEls[c]; dissolveStone(el); } }
  S=apply(S,m); moveNo++; lastTo=to; pend=null; sel=-1;
  render();
  if(recordAndCheck(mover)) return;
  if(twoPlayer||S.turn===humanSide){ statusForHuman(); return; }
  aiTurn();
}
function recordAndCheck(mover){
  const k=posKey(S); reps.set(k,(reps.get(k)||0)+1);
  if(isLoss(S,S.turn)){ over=true; render(); H.onEnd({win:mover,human:humanSide}); return true; }
  const d=drawReason(S,reps); if(d){ over=true; render(); H.onEnd({draw:true,grund:d==='rep'?'Stellung dreimal wiederholt.':'30 Züge ohne Schlag.'}); return true; }
  return false;
}
function askWorker(lv,me,budget){
  return new Promise((resolve,reject)=>{
    try{
      if(!worker){ worker=new Worker('./games/dame.js'); worker.onerror=e=>{ const w=worker; worker=null; if(w) w.terminate(); reject(e); }; }
      const id=++workerId, w=worker;
      w.onmessage=e=>{ if(e.data.id===id) resolve(e.data.move); };
      w.postMessage({b:S.b,turn:S.turn,nc:S.nc,me,level:lv,budget:budget||LEVELS[3].budget,hist:[...reps],id});
    }catch(e){ reject(e); }
  });
}
// Computerzug: Schritte nacheinander gleiten, Umwandlung blitzen, nach 320 ms geschlagene Steine entfernen
function aiTurn(){
  thinking=true; hud('Computer berechnet Zug …'); render();
  const lv=level, g=gen, me=S.turn;
  H.progress(380+(lv===3?LEVELS[3].budget:0));
  const play=m=>{
    if(g!==gen) return;
    H.progress(0);
    const step=reduceMotion()?0:180, el=stoneEls[m.path[0]]; delete stoneEls[m.path[0]];
    m.path.slice(1).forEach((t,k)=>setTimeout(()=>{ if(g!==gen) return; moveStone(el,t); if(m.captured.length) H.sfx.take(); else H.sfx.move(); },k*step));
    const tEnd=(m.path.length-1)*step;
    setTimeout(()=>{ if(g!==gen) return; const to=m.path[m.path.length-1]; stoneEls[to]=el; if(m.promote){ promoteEl(el); H.sfx.mill(); } },tEnd);
    setTimeout(()=>{ if(g!==gen) return;
      for(const c of m.captured){ const ce=stoneEls[c]; if(ce){ delete stoneEls[c]; dissolveStone(ce); } }
      S=apply(S,m); moveNo++; lastTo=m.path[m.path.length-1]; thinking=false; render();
      if(recordAndCheck(me)) return;
      statusForHuman();
    },tEnd+(reduceMotion()?0:320));
  };
  setTimeout(()=>{
    if(g!==gen) return;
    if(lv===3&&typeof Worker!=='undefined') askWorker(lv,me).then(play).catch(()=>play(bestMove(S,me,lv,reps)));
    else play(bestMove(S,me,lv,reps));
  },380);
}

/* Schnittstelle zur Hülle */
function mount(container,hooks){
  H=hooks; root=container; root.classList.add('dame');
  styleEl=document.createElement('style'); styleEl.textContent=CSS; document.head.appendChild(styleEl);
  root.innerHTML=`
<div class="tray"><span><span class="who p" id="nameT"></span><span id="pcT"></span></span><span>geschlagen <b id="capT">0</b></span></div>
<div class="wrap"><svg viewBox="0 0 100 100" aria-label="Damebrett">
  <rect width="100" height="100" fill="#0c0a0c"/>
  <g id="squares"></g><g id="grid" class="grid"></g><g id="coords" class="coords"></g><g id="brackets" class="bracket"></g>
  <g id="marks"></g><g id="stones"></g><g id="hint" class="hint"></g><g id="hits"></g>
</svg></div>
<div class="tray"><span><span class="who s" id="nameB"></span><span id="pcB"></span></span><span>geschlagen <b id="capB">0</b></span></div>`;
  q('hits').addEventListener('click',e=>{ const i=e.target.dataset.i; if(i!==undefined) onTap(+i); });
  flip=false; drawBoard();
  S=newState(); started=false; over=false; thinking=false; busy=false; history=[]; sel=-1; pend=null; lastTo=-1; moveNo=0; reps=new Map();
  render({reset:true});
}
function newGame(opts){
  gen++; twoPlayer=!!opts.twoPlayer; level=opts.level||2;
  humanSide=opts.starter===2?P2:P1; // "Anfang: Computer" bzw. "Pflaume": der Mensch bzw. Pflaume sitzt unten, Olive beginnt trotzdem
  const nf=opts.starter===2; if(nf!==flip){ flip=nf; drawBoard(); }
  S=newState(); over=false; thinking=false; busy=false; history=[]; sel=-1; pend=null; lastTo=-1; moveNo=0; reps=new Map(); started=true;
  reps.set(posKey(S),1); hinting=false; H.progress(0); clearHint(); render({reset:true});
  if(!twoPlayer&&S.turn!==humanSide) aiTurn(); else statusForHuman();
}
function undo(){
  if(!canUndo()) return;
  const h=history.pop(); S=h.S; lastTo=h.lastTo; moveNo=h.moveNo; reps=h.reps; sel=-1; pend=null; clearHint();
  render({reset:true}); statusForHuman();
}
function canUndo(){ return started&&!over&&!thinking&&!busy&&!pend&&!hinting&&history.length>0; }
/* Zugvorschlag: Stufe Schwer mit 1500 ms für den Menschen, im Worker wenn möglich; nicht mitten im Mehrfachschlag */
function canHint(){ return started&&!over&&!thinking&&!busy&&!pend&&!hinting&&!twoPlayer&&isHumanTurn(); }
function hint(cb){
  if(!canHint()){ cb(null); return; }
  hinting=true; sel=-1; const g=gen; render();
  const done=m=>{ if(g!==gen) return; hinting=false; render(); cb(m||null); };
  const sync=()=>{ const old=LEVELS[3].budget; LEVELS[3].budget=1500; try{ return bestMove(S,humanSide,3,reps); } finally{ LEVELS[3].budget=old; } };
  if(typeof Worker!=='undefined') askWorker(3,humanSide,1500).then(done).catch(()=>done(sync()));
  else setTimeout(()=>done(sync()),30);
}
function showHint(m){
  clearHint(); if(!m||!m.path) return;
  const Hn=q('hint'), gc=S.turn===P1?'go':'go2';
  m.path.forEach((i,k)=>{ const [x,y]=xy(i), r=k?2.2:1.4;
    Hn.insertAdjacentHTML('beforeend',`<path class="${gc}" d="M${x-r} ${y-r}L${x+r} ${y+r}M${x-r} ${y+r}L${x+r} ${y-r}"/>`);
    if(k) Hn.insertAdjacentHTML('beforeend',`<text x="${x+2.6}" y="${y-2.4}">${k}</text>`); });
  statusForHuman();
}
function clearHint(){ if(root) q('hint').innerHTML=''; }
function setLevel(l){ level=l; }
function destroy(){
  gen++; H&&H.progress(0);
  if(worker){ worker.terminate(); worker=null; }
  if(styleEl){ styleEl.remove(); styleEl=null; }
  if(root){ root.innerHTML=''; root.classList.remove('dame'); root=null; }
  stoneEls={}; started=false; pend=null; H=null;
}
const api={meta:META,mount,newGame,undo,canUndo,setLevel,destroy,canHint,hint,showHint,clearHint,
  debug(){ return {S,over,thinking,hinting,busy,history,lastTo,sel,pend,stoneEls,twoPlayer,started,flip,humanSide,reps,xy,moveNo,
    legal:()=>genMoves(S,S.turn), set:(b,turn)=>{ S={b:b.slice(),turn,nc:0}; reps=new Map([[posKey(S),1]]); history=[]; sel=-1; pend=null; render({reset:true}); statusForHuman(); }}; }};
if(typeof window!=='undefined'){ window.GAMES=window.GAMES||{}; window.GAMES.dame=api; }
if(typeof module!=='undefined'&&module.exports) module.exports={P1,P2,RC,NB,COORD,at,owner,isKing,newState,clone,posKey,count,genMoves,apply,isLoss,drawReason,LEVELS,evaluate,search,bestMove,K,meta:META};
})();
