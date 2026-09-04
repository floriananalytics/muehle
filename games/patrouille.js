/* games/patrouille.js - Patrouille (Shooter): Arcade-Modul. Schnittstelle zur Hülle: window.GAMES.patrouille (meta.typ 'arcade').
   Die Simulation (newGame, step, Wellen, Kollisionen) ist DOM-frei und wird unter Node geprüft; die Zeichnung läuft auf Canvas 2D. */
(function(){
'use strict';
/* ---------- Balance ---------- */
const W=90, H=140, DT=1/60; // Spielfeld in Einheiten, feste Schrittzeit 60 Hz
const BAL={
  shipSpeed:60, shipAccelMs:150, fireMs:180, shotSpeed:160, enemyShotSpeed:70,
  drone:{hp:1,pts:10,speed:28,r:2.6},
  sichel:{hp:2,pts:25,speed:22,r:3,amp:14,freq:0.7},
  spaeher:{hp:2,pts:40,speed:26,r:3,stopY:50,stopMs:2200,fireMs:900},
  asteroid:{speed:[10,18],r:[4,7]},
  boss:{hpBase:20,hpPerSector:10,speed:25,y:18,fireMs:900,pts:200,coreR:4,w:26,h:9,specialDamage:3,xMin:18,xMax:72},
  speedPerSector:0.08, firePerSector:0.10, maxSector:8,
  hull:3, hullMax:3, special:2, specialMax:4, invMs:1000, introMs:1200, securedMs:2000, waveGapMs:600, wavesPerSector:6,
  fireGain:0.012 // Dauerfeuer-Lautstärke
};
const WAVES=['reihe','v','doppelreihe','spaeherpaar','asteroiden','kombi'];
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
// Wellenfolge: Sektor 1 und 2 fest, ab Sektor 3 gemischt aus einem Zufallsgenerator mit festem Startwert (reproduzierbar)
function waveOrder(sector,seed){
  if(sector<3) return WAVES.slice();
  const r=mulberry32((seed||7)*1000+sector), a=WAVES.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
const diff=sector=>{ const s=Math.min(sector,BAL.maxSector)-1; return {speed:1+BAL.speedPerSector*s, fire:1+BAL.firePerSector*s}; };
function enemy(type,x,y){ const b=BAL[type]; return {type,x,y,x0:x,hp:b.hp,r:b.r,t:0,stop:0,fireT:0,alive:true}; }
function asteroid(rng,x,y){
  const r=BAL.asteroid.r[0]+rng()*(BAL.asteroid.r[1]-BAL.asteroid.r[0]), pts=[];
  for(let i=0;i<5;i++){ const a=i/5*Math.PI*2, rr=r*(0.72+rng()*0.4); pts.push([Math.cos(a)*rr,Math.sin(a)*rr]); }
  return {x,y,r,pts,vx:(rng()-0.5)*6,vy:BAL.asteroid.speed[0]+rng()*(BAL.asteroid.speed[1]-BAL.asteroid.speed[0]),rot:0,vrot:(rng()-0.5)*1.5};
}
function makeWave(kind,rng){
  const out={enemies:[],asteroids:[]}, E=(t,x,y)=>out.enemies.push(enemy(t,x,y));
  switch(kind){
    case 'reihe': for(let i=0;i<5;i++) E('drone',15+i*15,-6); break;
    case 'v': for(let i=0;i<5;i++) E('sichel',15+i*15,-6-Math.abs(i-2)*10); break;
    case 'doppelreihe': for(let i=0;i<5;i++){ E('drone',13+i*16,-6); E('drone',21+i*16,-22); } break;
    case 'spaeherpaar': E('spaeher',30,-8); E('spaeher',60,-8); for(let i=0;i<3;i++) E('drone',25+i*20,-30); break;
    case 'asteroiden': for(let i=0;i<4;i++) out.asteroids.push(asteroid(rng,12+i*22+rng()*8,-10-rng()*30)); for(let i=0;i<4;i++) E('drone',18+i*18,-50-i*8); break;
    case 'kombi': E('sichel',20,-6); E('sichel',70,-6); E('spaeher',45,-20); for(let i=0;i<3;i++) E('drone',25+i*20,-40); out.asteroids.push(asteroid(rng,45,-70)); break;
  }
  return out;
}
function makeBoss(sector){ const hp=BAL.boss.hpBase+BAL.boss.hpPerSector*sector; return {x:45,y:BAL.boss.y,dir:1,hp,hpMax:hp,fireT:0,turret:0,t:0,alive:true}; }
/* Kollisionen */
const circleHit=(ax,ay,ar,bx,by,br)=>{ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy<=(ar+br)*(ar+br); };
const rectCircle=(rx,ry,rw,rh,cx,cy,cr)=>{ const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh)); const dx=cx-nx, dy=cy-ny; return dx*dx+dy*dy<=cr*cr; };
const shipRect=s=>[s.x-4,s.y-3,8,7];

/* ---------- Simulation ---------- */
function newGame(seed){
  seed=seed||7;
  return {seed, rng:mulberry32(seed), t:0, phase:'intro', phaseT:0, sector:1, waveIdx:0, waves:0, order:waveOrder(1,seed),
    ship:{x:45,y:128,vx:0,dir:0,inv:0,drag:0}, hull:BAL.hull, special:BAL.special, score:0, kills:0,
    shots:[], eshots:[], enemies:[], asteroids:[], boss:null, particles:[], fireT:0, specialFx:0, events:[], over:false};
}
function spawnWave(g){ const w=makeWave(g.order[g.waveIdx],g.rng); g.enemies.push(...w.enemies); g.asteroids.push(...w.asteroids); g.phase='wave'; g.phaseT=0; }
function burst(g,x,y,n){ for(let i=0;i<n;i++){ const a=(i/n)*Math.PI*2+g.rng()*0.5; g.particles.push({x,y,vx:Math.cos(a)*30,vy:Math.sin(a)*30-10,life:0.5}); } }
function hitShip(g){
  if(g.ship.inv>0||g.over) return false;
  g.hull--; g.ship.inv=BAL.invMs/1000; burst(g,g.ship.x,g.ship.y,4); g.events.push('hit');
  if(g.hull<=0){ g.over=true; g.events.push('end'); }
  return true;
}
function killEnemy(g,e,points){ e.alive=false; if(points){ g.score+=BAL[e.type].pts; g.kills++; g.events.push('kill'); } burst(g,e.x,e.y,3); }
function useSpecial(g){
  if(g.over||g.special<=0||!(g.phase==='wave'||g.phase==='boss'||g.phase==='gap')) return false;
  g.special--; g.specialFx=0.3; g.events.push('special');
  for(const e of g.enemies) if(e.alive) killEnemy(g,e,true);
  g.eshots.length=0;
  if(g.boss&&g.boss.alive){ g.boss.hp-=BAL.boss.specialDamage; if(g.boss.hp<=0) bossDown(g); }
  return true;
}
function bossDown(g){ const b=g.boss; b.alive=false; g.score+=BAL.boss.pts*g.sector; g.kills++; burst(g,b.x,b.y,8); g.events.push('boss'); g.phase='secured'; g.phaseT=0; }
function step(g,dt){
  if(g.over) return;
  const s=g.ship, d=diff(g.sector); g.t+=dt; g.phaseT+=dt;
  // Schiff: weiche Beschleunigung, Ziehen auf dem Spielfeld, Ränder
  const target=s.dir*BAL.shipSpeed; s.vx+=(target-s.vx)*Math.min(1,dt/(BAL.shipAccelMs/1000));
  s.x+=s.vx*dt+s.drag; s.drag=0; s.x=Math.max(4,Math.min(W-4,s.x));
  if(s.inv>0) s.inv=Math.max(0,s.inv-dt);
  if(g.specialFx>0) g.specialFx=Math.max(0,g.specialFx-dt);
  // Ablauf
  if(g.phase==='intro'&&g.phaseT>=BAL.introMs/1000) spawnWave(g);
  else if(g.phase==='gap'&&g.phaseT>=BAL.waveGapMs/1000){ if(g.waveIdx>=BAL.wavesPerSector){ g.boss=makeBoss(g.sector); g.phase='boss'; g.phaseT=0; g.events.push('bossStart'); } else spawnWave(g); }
  else if(g.phase==='secured'&&g.phaseT>=BAL.securedMs/1000){ g.sector++; g.waveIdx=0; g.order=waveOrder(g.sector,g.seed); g.boss=null; g.phase='gap'; g.phaseT=0; }
  // Dauerfeuer
  if(g.phase!=='intro'){ g.fireT+=dt; if(g.fireT>=BAL.fireMs/1000){ g.fireT=0; g.shots.push({x:s.x,y:s.y-6}); g.events.push('fire'); } }
  // Schüsse
  for(const sh of g.shots){ sh.y-=BAL.shotSpeed*dt;
    for(const e of g.enemies){ if(e.alive&&circleHit(sh.x,sh.y,0.8,e.x,e.y,e.r)){ sh.dead=true; if(--e.hp<=0) killEnemy(g,e,true); break; } }
    if(sh.dead) continue;
    for(const a of g.asteroids){ if(circleHit(sh.x,sh.y,0.8,a.x,a.y,a.r)){ sh.dead=true; break; } } // Asteroiden schlucken Schüsse
    if(sh.dead) continue;
    const b=g.boss;
    if(b&&b.alive){ if(circleHit(sh.x,sh.y,0.8,b.x,b.y,BAL.boss.coreR)){ sh.dead=true; if(--b.hp<=0) bossDown(g); } // nur der Kern zählt
      else if(Math.abs(sh.x-b.x)<=BAL.boss.w/2&&Math.abs(sh.y-b.y)<=BAL.boss.h/2) sh.dead=true; } // Rumpf schluckt den Schuss
  }
  g.shots=g.shots.filter(sh=>!sh.dead&&sh.y>-6);
  // Gegner
  const [rx,ry,rw,rh]=shipRect(s);
  for(const e of g.enemies){ if(!e.alive) continue; const b=BAL[e.type]; e.t+=dt;
    if(e.type==='drone') e.y+=b.speed*d.speed*dt;
    else if(e.type==='sichel'){ e.y+=b.speed*d.speed*dt; e.x=e.x0+b.amp*Math.sin(e.t*b.freq*Math.PI*2); }
    else { // Späher: hält auf mittlerer Höhe an und schießt, dann weiter
      if(e.y<b.stopY||e.stop>=b.stopMs/1000) e.y+=b.speed*d.speed*dt;
      else { e.stop+=dt; e.fireT+=dt; if(e.fireT>=b.fireMs/1000/d.fire){ e.fireT=0; g.eshots.push({x:e.x,y:e.y+3}); } }
    }
    if(e.y>H+6) e.alive=false;
    else if(rectCircle(rx,ry,rw,rh,e.x,e.y,e.r)){ killEnemy(g,e,false); hitShip(g); }
  }
  g.enemies=g.enemies.filter(e=>e.alive);
  // Boss
  const b=g.boss;
  if(b&&b.alive){ b.t+=dt; b.x+=b.dir*BAL.boss.speed*d.speed*dt; if(b.x>BAL.boss.xMax){ b.x=BAL.boss.xMax; b.dir=-1; } if(b.x<BAL.boss.xMin){ b.x=BAL.boss.xMin; b.dir=1; }
    b.fireT+=dt; if(b.fireT>=BAL.boss.fireMs/1000/d.fire){ b.fireT=0; b.turret=1-b.turret; g.eshots.push({x:b.x+(b.turret?10:-10),y:b.y+6}); } }
  // Gegnerschüsse und Asteroiden
  for(const es of g.eshots){ es.y+=BAL.enemyShotSpeed*dt; if(rectCircle(rx,ry,rw,rh,es.x,es.y,0.8)){ es.dead=true; hitShip(g); } }
  g.eshots=g.eshots.filter(es=>!es.dead&&es.y<H+4);
  for(const a of g.asteroids){ a.x+=a.vx*dt; a.y+=a.vy*dt; a.rot+=a.vrot*dt; if(rectCircle(rx,ry,rw,rh,a.x,a.y,a.r*0.85)) hitShip(g); }
  g.asteroids=g.asteroids.filter(a=>a.y<H+10);
  for(const p of g.particles){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt; }
  g.particles=g.particles.filter(p=>p.life>0);
  // Welle abgeschlossen
  if(g.phase==='wave'&&!g.enemies.length){ g.waves++; g.waveIdx++; g.phase='gap'; g.phaseT=0; }
}
// Sektor gesichert: nach der Pause Spezial +1 und Hülle +1 (wird beim Übergang aus 'secured' gewährt)
function grantSecured(g){ g.special=Math.min(BAL.specialMax,g.special+1); g.hull=Math.min(BAL.hullMax,g.hull+1); }

/* ---------- Oberfläche ---------- */
const META={
  id:'patrouille', name:'PATROUILLE', untertitel:'SHOOTER | SEKTOR-ABWEHR', typ:'arcade', endTitel:'HÜLLE BESCHÄDIGT',
  farben:[{name:'Elfenbein',hex:'#f0e2c4',dunkel:'#8a8272'},{name:'Zinnober',hex:'#d4552e',dunkel:'#8f3419'}], // Schiff und Schüsse (Senf) | Gegner; Bosse Pflaume, Hindernisse Rauch
  akzent:{name:'Zinnober',hex:'#d4552e'},
  steuerung:{links:[{id:'links',symbol:'◀'},{id:'rechts',symbol:'▶'}],rechts:[{id:'spezial',symbol:'◆'}]},
  regeln:[
    {titel:'Auftrag.',text:'Das Patrouillenschiff sichert Sektor für Sektor. Gegner kommen von oben, das Schiff bewegt sich unten seitlich.'},
    {titel:'Steuerung.',text:'Tasten ◀ ▶ oder Ziehen mit dem Finger auf dem Spielfeld bewegen das Schiff. Das Bordgeschütz feuert von selbst.'},
    {titel:'Spezialschuss.',text:'◆ löst einen Fächer aus, der alles auf dem Schirm zerstört; Bosse verlieren drei Treffer. Start mit 2, je gesichertem Sektor einer dazu, höchstens 4.'},
    {titel:'Gegner.',text:'Drohnen fliegen gerade (1 Treffer, 10 Punkte), Sicheln in Wellenlinien (2 Treffer, 25), Späher halten an und schießen (2 Treffer, 40). Asteroiden sind unzerstörbar und schlucken Schüsse.'},
    {titel:'Sektor.',text:'Sechs Wellen, dann ein Boss. Treffer zählen nur an seinem blinkenden Kern. Ab Sektor 3 ist die Wellenfolge gemischt, aber für alle gleich.'},
    {titel:'Hülle.',text:'Drei Striche Hülle. Ein Treffer kostet einen, danach ist das Schiff eine Sekunde unverwundbar. Ein gesicherter Sektor gibt einen Strich zurück.'},
    {titel:'Logbuch.',text:'Die fünf besten Patrouillen stehen im Logbuch. Pause hält alles an; im Hintergrund pausiert das Programm von selbst.'}
  ],
  vorschau(){ return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#0c0a0c"/>
      <g fill="#f0e2c4" opacity=".3">${[[20,18],[60,12],[80,40],[35,55],[70,70],[15,80],[50,30]].map(([x,y])=>`<rect x="${x}" y="${y}" width="1.5" height="1.5"/>`).join('')}</g>
      <g fill="none" stroke="#d4552e" stroke-width="2"><rect x="24" y="22" width="9" height="9"/><rect x="58" y="16" width="9" height="9"/><path d="M40 40 L48 52 L32 52 Z"/></g>
      <g fill="none" stroke="#8a4f8e" stroke-width="2"><path d="M60 62 L72 58 L84 62 L84 70 L72 74 L60 70 Z"/></g>
      <g stroke="#e8a93a" stroke-width="2"><line x1="50" y1="60" x2="50" y2="68"/><line x1="50" y1="46" x2="50" y2="54"/></g>
      <path d="M50 74 L44 88 L56 88 Z" fill="#151216" stroke="#f0e2c4" stroke-width="2"/><line x1="41" y1="84" x2="59" y2="84" stroke="#f0e2c4" stroke-width="2"/></svg>`; }
};
const CSS=`
.patrouille .wrap{width:100%;aspect-ratio:9/14;position:relative;touch-action:none;user-select:none;-webkit-user-select:none;max-width:470px;margin:0 auto}
.patrouille canvas{width:100%;height:100%;display:block}`;
const COL={schwarz:'#0c0a0c',schwarz2:'#151216',elf:'#f0e2c4',senf:'#e8a93a',zinnober:'#d4552e',pflaume:'#8a4f8e',rauch:'#6f6a66'};
let HK=null, root=null, styleEl=null, canvas=null, ctx=null, g=null, running=false, raf=0, last=0, acc=0, ended=false, started=false, stars=[], lastTele='', flicker=0;
const reduceMotion=()=>!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function makeStars(){ const r=mulberry32(99); stars=[]; for(let l=0;l<3;l++) for(let i=0;i<22;i++) stars.push({x:r()*W,y:r()*H,l,v:[8,16,28][l],a:[0.15,0.22,0.3][l]}); }
function resize(){ const dpr=window.devicePixelRatio||1, w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.round(w*H/W); if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; } }
const R=v=>Math.round(v*2)/2; // grobes Raster: halbe Einheiten
function draw(dt){
  resize(); const sc=canvas.width/W; ctx.setTransform(sc,0,0,sc,0,0);
  ctx.fillStyle=COL.schwarz; ctx.fillRect(0,0,W,H);
  const rm=reduceMotion();
  for(const st of stars){ if(!rm&&running){ st.y+=st.v*dt; if(st.y>H){ st.y-=H; } } ctx.fillStyle=`rgba(240,226,196,${st.a})`; ctx.fillRect(R(st.x),R(st.y),1,1); }
  ctx.lineWidth=0.8; ctx.lineJoin='miter';
  for(const a of g.asteroids){ ctx.save(); ctx.translate(R(a.x),R(a.y)); ctx.rotate(a.rot); ctx.beginPath(); a.pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.closePath(); ctx.fillStyle=COL.schwarz2; ctx.fill(); ctx.strokeStyle=COL.rauch; ctx.stroke(); ctx.restore(); }
  ctx.strokeStyle=COL.zinnober; ctx.fillStyle=COL.schwarz2;
  for(const e of g.enemies){ const x=R(e.x), y=R(e.y); ctx.beginPath();
    if(e.type==='drone') ctx.rect(x-2.5,y-2.5,5,5);
    else if(e.type==='sichel'){ ctx.arc(x,y,3.2,0.35*Math.PI,1.65*Math.PI); ctx.arc(x+1.6,y,2.2,1.6*Math.PI,0.4*Math.PI,true); ctx.closePath(); }
    else { ctx.moveTo(x-3.5,y-3); ctx.lineTo(x+3.5,y-3); ctx.lineTo(x,y+3.5); ctx.closePath(); }
    ctx.fill(); ctx.stroke(); }
  const b=g.boss; if(b&&b.alive){ const x=R(b.x), y=R(b.y), w=BAL.boss.w/2, h=BAL.boss.h/2;
    ctx.strokeStyle=COL.pflaume; ctx.fillStyle=COL.schwarz2; ctx.beginPath(); ctx.moveTo(x-w,y); ctx.lineTo(x-w+5,y-h); ctx.lineTo(x+w-5,y-h); ctx.lineTo(x+w,y); ctx.lineTo(x+w-5,y+h); ctx.lineTo(x-w+5,y+h); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeRect(x-12,y+3,4,4); ctx.strokeRect(x+8,y+3,4,4); // Türme
    const blink=rm?0.8:0.55+0.45*Math.sin(b.t*6); ctx.globalAlpha=blink; ctx.fillStyle=COL.pflaume; ctx.beginPath(); ctx.arc(x,y,BAL.boss.coreR,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=COL.elf; ctx.lineWidth=0.6; ctx.stroke(); ctx.globalAlpha=1; ctx.lineWidth=0.8; }
  ctx.strokeStyle=COL.senf; ctx.lineWidth=0.9; ctx.beginPath(); for(const sh of g.shots){ ctx.moveTo(R(sh.x),R(sh.y)); ctx.lineTo(R(sh.x),R(sh.y)-4); } ctx.stroke();
  ctx.strokeStyle=COL.zinnober; ctx.beginPath(); for(const es of g.eshots){ ctx.moveTo(R(es.x),R(es.y)); ctx.lineTo(R(es.x),R(es.y)+4); } ctx.stroke();
  if(g.specialFx>0){ ctx.strokeStyle=COL.senf; ctx.globalAlpha=Math.min(1,g.specialFx*4); ctx.beginPath(); for(let i=-2;i<=2;i++){ ctx.moveTo(R(g.ship.x),R(g.ship.y)-6); ctx.lineTo(R(g.ship.x)+i*22,-2); } ctx.stroke(); ctx.globalAlpha=1; }
  ctx.fillStyle=COL.rauch; for(const p of g.particles) ctx.fillRect(R(p.x),R(p.y),1.5,1.5);
  // Schiff
  const s=g.ship, x=R(s.x), y=R(s.y);
  if(!g.over){
    ctx.globalAlpha=s.inv>0?(rm?0.5:(Math.floor(s.inv*10)%2?0.25:1)):1;
    ctx.strokeStyle=COL.elf; ctx.fillStyle=COL.schwarz2; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(x,y-6); ctx.lineTo(x-3.5,y+4); ctx.lineTo(x+3.5,y+4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-6,y+2); ctx.lineTo(x-3,y+2); ctx.moveTo(x+3,y+2); ctx.lineTo(x+6,y+2); ctx.stroke(); // Ausleger
    const moving=Math.abs(s.vx)>5; if(!rm) flicker=moving?(flicker+1)%3:0;
    ctx.fillStyle=COL.senf; ctx.globalAlpha*= (moving&&!rm&&flicker===0)?0.45:1; ctx.fillRect(x-0.75,y+4.5,1.5,1.5);
    ctx.globalAlpha=1;
  }
  // Eckklammern in der Akzentfarbe
  ctx.strokeStyle=COL.zinnober; ctx.lineWidth=0.8; ctx.beginPath();
  [[1,1,1,1],[W-1,1,-1,1],[1,H-1,1,-1],[W-1,H-1,-1,-1]].forEach(([cx,cy,dx,dy])=>{ ctx.moveTo(cx,cy+dy*6); ctx.lineTo(cx,cy); ctx.lineTo(cx+dx*6,cy); }); ctx.stroke();
}
function telemetry(){
  const best=Math.max(HK.bestwert?HK.bestwert():0,g.score);
  const t=[{label:'PUNKTE',value:String(g.score).padStart(4,'0')},{label:'SEKTOR',value:g.sector},{label:'HÜLLE',value:'▮'.repeat(g.hull)||'-'},{label:'SPEZIAL',value:g.special}];
  const key=JSON.stringify(t)+best; if(key===lastTele) return; lastTele=key; HK.telemetry(t);
}
function consumeEvents(){
  for(const ev of g.events){
    if(ev==='fire') HK.tone(880,0.008,'square',BAL.fireGain);
    else if(ev==='kill') HK.tone(120,0.06,'sawtooth',0.05);
    else if(ev==='hit'){ HK.tone(150,0.12,'square',0.06); setTimeout(()=>HK.tone(110,0.16,'square',0.06),120); HK.vibrate(80); }
    else if(ev==='special'){ [440,660,880].forEach((f,i)=>setTimeout(()=>HK.tone(f,0.08,'square',0.05),i*70)); HK.vibrate([30,30]); }
    else if(ev==='bossStart') HK.hud('Boss-Signatur erkannt.');
    else if(ev==='boss'){ HK.sfx.win(); HK.vibrate([40,60,40]); grantSecured(g); HK.hud(`SEKTOR ${g.sector} GESICHERT`); }
    else if(ev==='end') finish();
  }
  g.events.length=0;
}
function loop(now){
  if(!running) return;
  raf=requestAnimationFrame(loop);
  const frame=Math.min(now-last,250)/1000; last=now; acc+=frame;
  while(acc>=DT&&running){ acc-=DT; const ph=g.phase; step(g,DT); if(ph==='intro'&&g.phase==='wave') HK.hud('Erste Welle im Anflug.'); if(ph==='gap'&&g.phase==='wave'&&g.waveIdx===0&&g.sector>1) HK.hud(`SEKTOR ${g.sector} - PATROUILLE BEGINNT`); consumeEvents(); if(!running) break; }
  telemetry(); draw(frame);
}
function finish(){
  running=false; ended=true; cancelAnimationFrame(raf); raf=0; draw(0); telemetry();
  const best=HK.bestwert?HK.bestwert():0;
  HK.onEnd({score:g.score, felder:[{label:'Sektor',value:g.sector},{label:'Wellen',value:g.waves},{label:'Abschüsse',value:g.kills}], bestwert:g.score>best});
}
function control(id,pressed){
  if(!g) return;
  if(id==='links'||id==='rechts'){ const held={links:-1,rechts:1}; if(pressed) g.ship.dir=held[id]; else if(g.ship.dir===held[id]) g.ship.dir=0; }
  else if(id==='spezial'&&pressed&&running) useSpecial(g);
}
function onKey(e){ const map={ArrowLeft:'links',ArrowRight:'rechts',a:'links',d:'rechts',' ':'spezial',Enter:'spezial'}; const id=map[e.key]; if(id&&running){ e.preventDefault(); if(e.type==='keydown'&&e.repeat&&id==='spezial') return; control(id,e.type==='keydown'); } }
function onDrag(dxPx){ if(!g||!running||!canvas) return; g.ship.drag+=dxPx/canvas.clientWidth*W; }

/* Schnittstelle zur Hülle */
function mount(container,hooks){
  HK=hooks; root=container; root.classList.add('patrouille');
  styleEl=document.createElement('style'); styleEl.textContent=CSS; document.head.appendChild(styleEl);
  root.innerHTML='<div class="wrap"><canvas aria-label="Patrouille"></canvas></div>';
  canvas=root.querySelector('canvas'); ctx=canvas.getContext('2d');
  document.addEventListener('keydown',onKey); document.addEventListener('keyup',onKey);
  HK.onControl=control; HK.onDrag=onDrag;
  makeStars(); g=newGame(); running=false; ended=false; started=false; lastTele=''; draw(0); telemetry();
}
function start(){
  g=newGame(); ended=false; started=true; acc=0; lastTele=''; telemetry(); draw(0);
  HK.hud('SEKTOR 1 - PATROUILLE BEGINNT');
  running=true; last=performance.now(); raf=requestAnimationFrame(loop);
}
function pause(){ if(!running) return; running=false; cancelAnimationFrame(raf); raf=0; g.ship.dir=0; HK.hud('Pause.'); }
function resume(){ if(running||ended||!started) return; running=true; acc=0; last=performance.now(); raf=requestAnimationFrame(loop); HK.hud('Patrouille läuft.'); }
function isRunning(){ return running; }
function destroy(){
  running=false; cancelAnimationFrame(raf); raf=0; started=false;
  document.removeEventListener('keydown',onKey); document.removeEventListener('keyup',onKey);
  if(styleEl){ styleEl.remove(); styleEl=null; }
  if(root){ root.innerHTML=''; root.classList.remove('patrouille'); root=null; }
  canvas=ctx=null; if(HK){ HK.onControl=null; HK.onDrag=null; } HK=null;
}
const api={meta:META,mount,destroy,start,pause,resume,isRunning,newGame:start,
  debug(){ return {g,running,ended,started,raf,BAL,stars,useSpecial:()=>useSpecial(g)}; }};
if(typeof window!=='undefined'){ window.GAMES=window.GAMES||{}; window.GAMES.patrouille=api; }
if(typeof module!=='undefined'&&module.exports) module.exports={W,H,DT,BAL,WAVES,mulberry32,waveOrder,diff,makeWave,makeBoss,asteroid,circleHit,rectCircle,shipRect,newGame,step,spawnWave,hitShip,useSpecial,bossDown,grantSecured,meta:META};
})();
