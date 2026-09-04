/* games/patrouille.js - Patrouille (Shooter): Arcade-Modul. Schnittstelle zur Hülle: window.GAMES.patrouille (meta.typ 'arcade').
   Die Simulation (newGame, step, Wellen, Kollisionen) ist DOM-frei und wird unter Node geprüft; die Zeichnung läuft auf Canvas 2D. */
(function(){
'use strict';
/* ---------- Balance ---------- */
const W=90, H=140, DT=1/60; // Spielfeld in Einheiten, feste Schrittzeit 60 Hz
const BAL={
  shipSpeed:70, dragSpeed:90, shipAccelMs:150, shipYMin:70, shipYMax:134, fireMs:180, shotSpeed:160, enemyShotSpeed:70, aimSpreadDeg:10,
  drone:{hp:1,pts:10,speed:28,r:2.6},
  sichel:{hp:2,pts:25,speed:22,r:3,amp:14,freq:0.7},
  spaeher:{hp:2,pts:40,speed:26,r:3,stopY:50,stopMs:2200,fireMs:900},
  asteroid:{speed:[10,18],r:[4,7]},
  boss:{hpBase:20,hpPerSector:10,speed:25,y:18,fireMs:900,pts:200,coreR:4,w:26,h:9,specialDamage:3,xMin:18,xMax:72},
  speedPerSector:0.08, firePerSector:0.10, maxSector:8,
  hull:3, hullMax:3, special:2, specialMax:4, invMs:1000, introMs:1200, securedMs:2000, waveGapMs:600, wavesPerSector:6,
  planetDrift:1, planetDriftMax:30, starSpeeds:[6,12,20], nebulaSpeeds:[3,5],
  fireGain:0, fireClickEvery:4, fireClickGain:0.004, killGain:0.033, killMs:45, masterGain:0.8 // Ton: Dauerfeuer aus, leises Klicken je vierter Salve, Gesamtlautstärke
};
const WAVES=['reihe','v','doppelreihe','spaeherpaar','asteroiden','kombi'];
const SECTOR_COLORS=[['zinnober','#d4552e'],['pflaume','#8a4f8e'],['petrol','#2f8a90'],['senf-dunkel','#b07a22']];
const MISSIONS=['Konvoi abfangen','Minenfeld räumen','Vorposten sichern','Späher stellen','Frachter eskortieren','Nebel durchqueren'];
const sectorColor=s=>SECTOR_COLORS[(s-1)%SECTOR_COLORS.length];
const missionFor=s=>MISSIONS[(s-1)%MISSIONS.length];
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
// Wellenfolge: Sektor 1 und 2 fest, ab Sektor 3 gemischt aus einem Zufallsgenerator mit festem Startwert (reproduzierbar)
function waveOrder(sector,seed){
  if(sector<3) return WAVES.slice();
  const r=mulberry32((seed||7)*1000+sector), a=WAVES.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
const diff=sector=>{ const s=Math.min(sector,BAL.maxSector)-1; return {speed:1+BAL.speedPerSector*s, fire:1+BAL.firePerSector*s}; };
function enemy(type,x,y){ const b=BAL[type]; return {type,x,y,x0:x,hp:b.hp,r:b.r,t:0,stop:0,fireT:0,flash:0,trail:[],alive:true}; }
function asteroid(rng,x,y){
  const r=BAL.asteroid.r[0]+rng()*(BAL.asteroid.r[1]-BAL.asteroid.r[0]), pts=[], craters=[];
  for(let i=0;i<5;i++){ const a=i/5*Math.PI*2, rr=r*(0.72+rng()*0.4); pts.push([Math.cos(a)*rr,Math.sin(a)*rr]); }
  for(let i=0;i<3;i++){ const a=rng()*Math.PI*2, d=rng()*r*0.5; craters.push([Math.cos(a)*d,Math.sin(a)*d,r*(0.12+rng()*0.14)]); }
  return {x,y,r,pts,craters,vx:(rng()-0.5)*6,vy:BAL.asteroid.speed[0]+rng()*(BAL.asteroid.speed[1]-BAL.asteroid.speed[0]),rot:0,vrot:(rng()-0.5)*1.5};
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
function makeBoss(sector){ const hp=BAL.boss.hpBase+BAL.boss.hpPerSector*sector; return {x:45,y:BAL.boss.y,dir:1,hp,hpMax:hp,fireT:0,turret:0,t:0,flash:0,alive:true}; }
/* Kollisionen */
const circleHit=(ax,ay,ar,bx,by,br)=>{ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy<=(ar+br)*(ar+br); };
const rectCircle=(rx,ry,rw,rh,cx,cy,cr)=>{ const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh)); const dx=cx-nx, dy=cy-ny; return dx*dx+dy*dy<=cr*cr; };
const shipRect=s=>[s.x-4,s.y-3,8,7];
// Gegnerschuss, der leicht auf das Schiff zielt (Streuung +-aimSpreadDeg)
function aimedShot(g,x,y){
  const s=g.ship, base=Math.atan2(s.y-y,s.x-x), spread=(g.rng()*2-1)*BAL.aimSpreadDeg*Math.PI/180, a=base+spread;
  return {x,y,vx:Math.cos(a)*BAL.enemyShotSpeed,vy:Math.sin(a)*BAL.enemyShotSpeed};
}

/* ---------- Simulation ---------- */
function newGame(seed){
  seed=seed||7;
  return {seed, rng:mulberry32(seed), t:0, phase:'intro', phaseT:0, sector:1, waveIdx:0, waves:0, order:waveOrder(1,seed),
    ship:{x:45,y:120,vx:0,vy:0,dirX:0,dirY:0,inv:0,dragX:0,dragY:0}, hull:BAL.hull, special:BAL.special, score:0, kills:0,
    shots:[], eshots:[], enemies:[], asteroids:[], boss:null, particles:[], fireT:0, fireCount:0, specialFx:0, events:[], over:false};
}
function spawnWave(g){ const w=makeWave(g.order[g.waveIdx],g.rng); g.enemies.push(...w.enemies); g.asteroids.push(...w.asteroids); g.phase='wave'; g.phaseT=0; }
function burst(g,x,y,n,col){ for(let i=0;i<n;i++){ const a=(i/n)*Math.PI*2+g.rng()*0.5; g.particles.push({x,y,vx:Math.cos(a)*30,vy:Math.sin(a)*30-10,life:0.5,col:col||'rauch'}); } }
function hitShip(g){
  if(g.ship.inv>0||g.over) return false;
  g.hull--; g.ship.inv=BAL.invMs/1000; burst(g,g.ship.x,g.ship.y,4); g.events.push({t:'hit'});
  if(g.hull<=0){ g.over=true; g.events.push({t:'end'}); }
  return true;
}
function killEnemy(g,e,points){ e.alive=false; if(points){ g.score+=BAL[e.type].pts; g.kills++; g.events.push({t:'kill',x:e.x,y:e.y}); } burst(g,e.x,e.y,4,'zinnober'); }
function useSpecial(g){
  if(g.over||g.special<=0||!(g.phase==='wave'||g.phase==='boss'||g.phase==='gap')) return false;
  g.special--; g.specialFx=0.3; g.events.push({t:'special'});
  for(const e of g.enemies) if(e.alive) killEnemy(g,e,true);
  g.eshots.length=0;
  if(g.boss&&g.boss.alive){ g.boss.hp-=BAL.boss.specialDamage; g.boss.flash=0.1; if(g.boss.hp<=0) bossDown(g); }
  return true;
}
function bossDown(g){ const b=g.boss; b.alive=false; g.score+=BAL.boss.pts*g.sector; g.kills++; burst(g,b.x,b.y,8,'zinnober'); g.events.push({t:'boss',x:b.x,y:b.y}); g.phase='secured'; g.phaseT=0; }
function step(g,dt){
  if(g.over) return;
  const s=g.ship, d=diff(g.sector); g.t+=dt; g.phaseT+=dt;
  // Schiff: zwei Achsen, weiche Beschleunigung, Ziehen relativ mit Tempodeckel, Ränder
  const k=Math.min(1,dt/(BAL.shipAccelMs/1000));
  s.vx+=(s.dirX*BAL.shipSpeed-s.vx)*k; s.vy+=(s.dirY*BAL.shipSpeed-s.vy)*k;
  const cap=BAL.dragSpeed*dt, dx=Math.max(-cap,Math.min(cap,s.dragX)), dy=Math.max(-cap,Math.min(cap,s.dragY)); s.dragX-=dx; s.dragY-=dy;
  s.x=Math.max(4,Math.min(W-4,s.x+s.vx*dt+dx)); s.y=Math.max(BAL.shipYMin,Math.min(BAL.shipYMax,s.y+s.vy*dt+dy));
  if(s.inv>0) s.inv=Math.max(0,s.inv-dt);
  if(g.specialFx>0) g.specialFx=Math.max(0,g.specialFx-dt);
  // Ablauf: intro -> wave -> gap -> ... -> boss -> secured -> intro (nächster Sektor)
  if(g.phase==='intro'&&g.phaseT>=BAL.introMs/1000) spawnWave(g);
  else if(g.phase==='gap'&&g.phaseT>=BAL.waveGapMs/1000){ if(g.waveIdx>=BAL.wavesPerSector){ g.boss=makeBoss(g.sector); g.phase='boss'; g.phaseT=0; g.events.push({t:'bossStart'}); } else spawnWave(g); }
  else if(g.phase==='secured'&&g.phaseT>=BAL.securedMs/1000){ g.sector++; g.waveIdx=0; g.order=waveOrder(g.sector,g.seed); g.boss=null; g.phase='intro'; g.phaseT=0; g.events.push({t:'sector'}); }
  // Dauerfeuer
  if(g.phase!=='intro'){ g.fireT+=dt; if(g.fireT>=BAL.fireMs/1000){ g.fireT=0; g.fireCount++; g.shots.push({x:s.x,y:s.y-6}); g.events.push({t:'fire',n:g.fireCount}); } }
  // Schüsse
  for(const sh of g.shots){ sh.y-=BAL.shotSpeed*dt;
    for(const e of g.enemies){ if(e.alive&&circleHit(sh.x,sh.y,0.8,e.x,e.y,e.r)){ sh.dead=true; if(--e.hp<=0) killEnemy(g,e,true); break; } }
    if(sh.dead) continue;
    for(const a of g.asteroids){ if(circleHit(sh.x,sh.y,0.8,a.x,a.y,a.r)){ sh.dead=true; break; } } // Asteroiden schlucken Schüsse
    if(sh.dead) continue;
    const b=g.boss;
    if(b&&b.alive){ if(circleHit(sh.x,sh.y,0.8,b.x,b.y,BAL.boss.coreR)){ sh.dead=true; b.flash=0.1; if(--b.hp<=0) bossDown(g); } // nur der Kern zählt
      else if(Math.abs(sh.x-b.x)<=BAL.boss.w/2&&Math.abs(sh.y-b.y)<=BAL.boss.h/2) sh.dead=true; } // Rumpf schluckt den Schuss
  }
  g.shots=g.shots.filter(sh=>!sh.dead&&sh.y>-6);
  // Gegner
  const [rx,ry,rw,rh]=shipRect(s);
  for(const e of g.enemies){ if(!e.alive) continue; const b=BAL[e.type]; e.t+=dt; if(e.flash>0) e.flash=Math.max(0,e.flash-dt);
    if(e.type==='drone') e.y+=b.speed*d.speed*dt;
    else if(e.type==='sichel'){ e.y+=b.speed*d.speed*dt; e.x=e.x0+b.amp*Math.sin(e.t*b.freq*Math.PI*2); (e.trail||(e.trail=[])).push([e.x,e.y]); if(e.trail.length>5) e.trail.shift(); }
    else { // Späher: hält auf mittlerer Höhe an und schießt gezielt, dann weiter
      if(e.y<b.stopY||e.stop>=b.stopMs/1000) e.y+=b.speed*d.speed*dt;
      else { e.stop+=dt; e.fireT+=dt; if(e.fireT>=b.fireMs/1000/d.fire){ e.fireT=0; e.flash=0.08; g.eshots.push(aimedShot(g,e.x,e.y+3)); } }
    }
    if(e.y>H+6) e.alive=false;
    else if(rectCircle(rx,ry,rw,rh,e.x,e.y,e.r)){ killEnemy(g,e,false); hitShip(g); }
  }
  g.enemies=g.enemies.filter(e=>e.alive);
  // Boss
  const b=g.boss;
  if(b&&b.alive){ b.t+=dt; if(b.flash>0) b.flash=Math.max(0,b.flash-dt); b.x+=b.dir*BAL.boss.speed*d.speed*dt; if(b.x>BAL.boss.xMax){ b.x=BAL.boss.xMax; b.dir=-1; } if(b.x<BAL.boss.xMin){ b.x=BAL.boss.xMin; b.dir=1; }
    b.fireT+=dt; if(b.fireT>=BAL.boss.fireMs/1000/d.fire){ b.fireT=0; b.turret=1-b.turret; g.eshots.push(aimedShot(g,b.x+(b.turret?10:-10),b.y+6)); } }
  // Gegnerschüsse und Asteroiden
  for(const es of g.eshots){ es.x+=es.vx*dt; es.y+=es.vy*dt; if(rectCircle(rx,ry,rw,rh,es.x,es.y,0.8)){ es.dead=true; hitShip(g); } }
  g.eshots=g.eshots.filter(es=>!es.dead&&es.y<H+4&&es.y>-4&&es.x>-4&&es.x<W+4);
  for(const a of g.asteroids){ a.x+=a.vx*dt; a.y+=a.vy*dt; a.rot+=a.vrot*dt; if(rectCircle(rx,ry,rw,rh,a.x,a.y,a.r*0.85)) hitShip(g); }
  g.asteroids=g.asteroids.filter(a=>a.y<H+10);
  for(const p of g.particles){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.life-=dt; }
  g.particles=g.particles.filter(p=>p.life>0);
  // Welle abgeschlossen
  if(g.phase==='wave'&&!g.enemies.length){ g.waves++; g.waveIdx++; g.phase='gap'; g.phaseT=0; }
}
// Sektor gesichert: Spezial +1 und Hülle +1 (die Oberfläche ruft es beim Boss-Ereignis)
function grantSecured(g){ g.special=Math.min(BAL.specialMax,g.special+1); g.hull=Math.min(BAL.hullMax,g.hull+1); }

/* ---------- Oberfläche ---------- */
const META={
  id:'patrouille', name:'PATROUILLE', untertitel:'SHOOTER | SEKTOR-ABWEHR', typ:'arcade', endTitel:'HÜLLE BESCHÄDIGT',
  farben:[{name:'Elfenbein',hex:'#f0e2c4',dunkel:'#8a8272'},{name:'Zinnober',hex:'#d4552e',dunkel:'#8f3419'}], // Schiff und Schüsse (Senf) | Gegner; Bosse Pflaume, Hindernisse Rauch
  akzent:{name:'Zinnober',hex:'#d4552e'},
  steuerung:{links:[{id:'hoch',symbol:'▲',zeile:1,spalte:2},{id:'links',symbol:'◀',zeile:2,spalte:1},{id:'runter',symbol:'▼',zeile:2,spalte:2},{id:'rechts',symbol:'▶',zeile:2,spalte:3}],rechts:[{id:'spezial',symbol:'◆'}]},
  regeln:[
    {titel:'Auftrag.',text:'Das Patrouillenschiff sichert Sektor für Sektor. Gegner kommen von oben, das Schiff bewegt sich frei in der unteren Hälfte.'},
    {titel:'Steuerung.',text:'Tastenkreuz ◀ ▲ ▼ ▶ (diagonal durch Halten von zwei Tasten) oder Ziehen mit dem Finger auf dem Spielfeld, das Schiff folgt der Bewegung. Das Bordgeschütz feuert von selbst.'},
    {titel:'Spezialschuss.',text:'◆ löst einen Fächer aus, der alles auf dem Schirm zerstört; Bosse verlieren drei Treffer. Start mit 2, je gesichertem Sektor einer dazu, höchstens 4.'},
    {titel:'Gegner.',text:'Drohnen fliegen gerade (1 Treffer, 10 Punkte), Sicheln in Wellenlinien (2 Treffer, 25), Späher halten an und schießen gezielt (2 Treffer, 40). Asteroiden sind unzerstörbar und schlucken Schüsse.'},
    {titel:'Sektor.',text:'Sechs Wellen, dann ein Boss, dessen Türme auf das Schiff zielen. Treffer zählen nur an seinem blinkenden Kern. Ab Sektor 3 ist die Wellenfolge gemischt, aber für alle gleich.'},
    {titel:'Hülle.',text:'Drei Striche Hülle. Ein Treffer kostet einen, danach ist das Schiff eine Sekunde unverwundbar. Ein gesicherter Sektor gibt einen Strich zurück.'},
    {titel:'Logbuch.',text:'Die fünf besten Patrouillen stehen im Logbuch. Pause hält alles an; im Hintergrund pausiert das Programm von selbst.'}
  ],
  vorschau(){ return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#0c0a0c"/>
      <circle cx="50" cy="-30" r="70" fill="#d4552e" opacity=".55"/><circle cx="50" cy="-30" r="70" fill="none" stroke="#0c0a0c" stroke-width="6" opacity=".5"/>
      <g fill="#f0e2c4" opacity=".4">${[[20,58],[60,52],[80,70],[35,75],[70,90],[15,90]].map(([x,y])=>`<rect x="${x}" y="${y}" width="1.5" height="1.5"/>`).join('')}</g>
      <g fill="#d4552e" stroke="#0c0a0c" stroke-width="1.5"><path d="M28 24 L33 29 L28 34 L23 29 Z"/><path d="M62 18 L67 23 L62 28 L57 23 Z"/><path d="M36 42 L48 42 L42 52 Z"/></g>
      <path d="M60 62 L72 58 L84 62 L84 70 L72 74 L60 70 Z" fill="#8a4f8e" stroke="#f0e2c4" stroke-width="1.5"/>
      <g stroke="#e8a93a" stroke-width="2"><line x1="50" y1="60" x2="50" y2="68"/><line x1="50" y1="46" x2="50" y2="54"/></g>
      <path d="M50 74 L44 88 L56 88 Z" fill="#f0e2c4" stroke="#0c0a0c" stroke-width="1.2"/><line x1="50" y1="76" x2="50" y2="86" stroke="#e8a93a" stroke-width="1.5"/><line x1="41" y1="84" x2="59" y2="84" stroke="#f0e2c4" stroke-width="2"/></svg>`; }
};
const CSS=`
.patrouille .wrap{width:100%;aspect-ratio:9/14;position:relative;touch-action:none;user-select:none;-webkit-user-select:none;max-width:470px;margin:0 auto}
.patrouille canvas{width:100%;height:100%;display:block}`;
const COL={schwarz:'#0c0a0c',schwarz2:'#151216',elf:'#f0e2c4',senf:'#e8a93a',petrol:'#2f8a90',zinnober:'#d4552e',pflaume:'#8a4f8e',rauch:'#6f6a66',rot:'#b8322a'};
let HK=null, root=null, styleEl=null, canvas=null, ctx=null, g=null, running=false, raf=0, last=0, acc=0, ended=false, started=false, lastTele='', flicker=0;
let stars=[], nebula=[], planet=null, planetDots=[], fx=[], shake=0, shakeAmp=0, flash=0, muzzle=0, introFade=0;
const reduceMotion=()=>!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const tone=(f,d,type,gain)=>HK.tone(f,d,type,gain*BAL.masterGain);
function makeStars(){ const r=mulberry32(99); stars=[];
  for(let i=0;i<11;i++) stars.push({x:r()*W,y:r()*H,l:0,v:BAL.starSpeeds[0]});
  for(let i=0;i<16;i++) stars.push({x:r()*W,y:r()*H,l:1,v:BAL.starSpeeds[1]});
  for(let i=0;i<10;i++) stars.push({x:r()*W,y:r()*H,l:2,v:BAL.starSpeeds[2]});
  nebula=[{y:30,h:18,v:BAL.nebulaSpeeds[0],a:0.12},{y:95,h:22,v:BAL.nebulaSpeeds[1],a:0.17}];
  planetDots=[]; for(let i=0;i<160;i++){ const a=r()*Math.PI*2, d=0.78+Math.pow(r(),0.6)*0.22; planetDots.push([Math.cos(a)*d,Math.sin(a)*d,0.6+(d-0.78)/0.22*0.8]); } // dichter und größer zum Rand
}
function newPlanet(sector){ planet={color:sectorColor(sector)[1],drift:0,alpha:0}; }
function resize(){ const dpr=window.devicePixelRatio||1, w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.round(w*H/W); if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; } }
const R=v=>Math.round(v*2)/2; // grobes Raster: halbe Einheiten
function drawBackground(dt,rm){
  // Planet: große Scheibe, oben angeschnitten, Terminator als Verlauf, Halbtonpunkte am Rand
  if(planet){ const r=70, cx=45, cy=-38+planet.drift;
    const grad=ctx.createRadialGradient(cx,cy,r*0.5,cx,cy,r); grad.addColorStop(0,planet.color); grad.addColorStop(0.7,planet.color); grad.addColorStop(1,COL.schwarz);
    ctx.globalAlpha=planet.alpha*0.75; ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=planet.color; ctx.globalAlpha=planet.alpha*0.5; for(const [px,py,sz] of planetDots){ const x=cx+px*r, y=cy+py*r; if(y>-2&&y<H+2) ctx.fillRect(R(x),R(y),sz,sz); }
    ctx.globalAlpha=1; }
  // Nebelbänder in Petrol mit weichen Kanten
  for(const n of nebula){ if(!rm&&running){ n.y+=n.v*dt; if(n.y>H+n.h) n.y=-n.h; }
    const gr=ctx.createLinearGradient(0,n.y-n.h,0,n.y+n.h); gr.addColorStop(0,'rgba(47,138,144,0)'); gr.addColorStop(0.5,`rgba(47,138,144,${n.a})`); gr.addColorStop(1,'rgba(47,138,144,0)');
    ctx.fillStyle=gr; ctx.fillRect(0,n.y-n.h,W,n.h*2); }
  // Sterne: hinten grau klein, Mitte Elfenbein, vorn Elfenbein mit Nachzieher
  for(const st of stars){ if(!rm&&running){ st.y+=st.v*dt; if(st.y>H) st.y-=H; }
    if(st.l===0){ ctx.fillStyle='rgba(111,106,102,.6)'; ctx.fillRect(R(st.x),R(st.y),0.8,0.8); }
    else if(st.l===1){ ctx.fillStyle='rgba(240,226,196,.7)'; ctx.fillRect(R(st.x),R(st.y),1,1); }
    else { ctx.fillStyle='rgba(240,226,196,.35)'; ctx.fillRect(R(st.x),R(st.y)-3,1,3); ctx.fillStyle=COL.elf; ctx.fillRect(R(st.x),R(st.y),1.5,1.5); } }
}
function drawShip(rm){
  const s=g.ship, x=R(s.x), y=R(s.y);
  ctx.globalAlpha=s.inv>0?(rm?0.5:(Math.floor(s.inv*10)%2?0.3:1)):1;
  const speed=Math.hypot(s.vx,s.vy), moving=speed>5; if(!rm) flicker=moving?(flicker+1)%3:0;
  // Triebwerk: Senf-Strich, länger bei Bewegung, flackert
  const tl=2+Math.min(5,speed/14)*(moving&&!rm&&flicker===0?0.6:1); ctx.strokeStyle=COL.senf; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(x,y+4.5); ctx.lineTo(x,y+4.5+tl); ctx.stroke();
  // Rumpf gefüllt mit dunkler Kontur
  ctx.fillStyle=COL.elf; ctx.strokeStyle=COL.schwarz; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(x,y-6); ctx.lineTo(x-3.5,y+4); ctx.lineTo(x+3.5,y+4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle=COL.elf; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(x-6.5,y+2); ctx.lineTo(x-3,y+2); ctx.moveTo(x+3,y+2); ctx.lineTo(x+6.5,y+2); ctx.stroke(); // Ausleger
  ctx.strokeStyle=COL.senf; ctx.lineWidth=0.8; ctx.beginPath(); ctx.moveTo(x,y-3); ctx.lineTo(x,y+3.5); ctx.stroke(); // Senf-Streifen
  ctx.fillStyle=COL.petrol; ctx.fillRect(x-0.75,y-2.5,1.5,2); // Kanzel
  if(muzzle>0){ ctx.fillStyle=COL.senf; ctx.fillRect(x-1,y-8,2,2); } // Mündungsfeuer
  ctx.globalAlpha=1;
}
function drawEnemies(){
  ctx.lineWidth=1; ctx.strokeStyle=COL.schwarz;
  for(const e of g.enemies){ const x=R(e.x), y=R(e.y);
    if(e.type==='sichel'&&e.trail){ ctx.fillStyle='rgba(212,85,46,.4)'; e.trail.forEach(([tx,ty],i)=>{ ctx.globalAlpha=(i+1)/6*0.4; ctx.beginPath(); ctx.arc(R(tx),R(ty),2.2,0,Math.PI*2); ctx.fill(); }); ctx.globalAlpha=1; }
    ctx.fillStyle=COL.zinnober; ctx.beginPath();
    if(e.type==='drone'){ ctx.moveTo(x,y-3.2); ctx.lineTo(x+3.2,y); ctx.lineTo(x,y+3.2); ctx.lineTo(x-3.2,y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle=COL.schwarz; ctx.fillRect(x-0.75,y-0.75,1.5,1.5); }
    else if(e.type==='sichel'){ ctx.arc(x,y,3.4,0.3*Math.PI,1.7*Math.PI); ctx.arc(x+1.8,y,2.4,1.65*Math.PI,0.35*Math.PI,true); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else { ctx.moveTo(x-3.8,y-3.2); ctx.lineTo(x+3.8,y-3.2); ctx.lineTo(x,y+3.8); ctx.closePath(); ctx.fill(); ctx.stroke(); if(e.flash>0){ ctx.fillStyle=COL.senf; ctx.fillRect(x-1,y+3.5,2,2); } }
  }
  for(const a of g.asteroids){ ctx.save(); ctx.translate(R(a.x),R(a.y)); ctx.rotate(a.rot); ctx.beginPath(); a.pts.forEach(([px,py],i)=>i?ctx.lineTo(px,py):ctx.moveTo(px,py)); ctx.closePath(); ctx.fillStyle=COL.rauch; ctx.fill(); ctx.strokeStyle=COL.schwarz; ctx.stroke();
    ctx.fillStyle='rgba(12,10,12,.45)'; for(const [cx,cy,cr] of a.craters){ ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill(); } ctx.restore(); }
  const b=g.boss; if(b&&b.alive){ const x=R(b.x), y=R(b.y), w=BAL.boss.w/2, h=BAL.boss.h/2, s=g.ship;
    ctx.fillStyle=COL.pflaume; ctx.strokeStyle=COL.elf; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x-w,y); ctx.lineTo(x-w+5,y-h); ctx.lineTo(x+w-5,y-h); ctx.lineTo(x+w,y); ctx.lineTo(x+w-5,y+h); ctx.lineTo(x-w+5,y+h); ctx.closePath(); ctx.fill(); ctx.stroke();
    for(const tx of [x-10,x+10]){ const ang=Math.atan2(s.y-(y+6),s.x-tx); ctx.save(); ctx.translate(tx,y+5); ctx.rotate(ang); ctx.fillStyle=COL.schwarz2; ctx.fillRect(-2,-2,6,4); ctx.strokeRect(-2,-2,6,4); ctx.restore(); } // Türme zielen auf das Schiff
    const rm=reduceMotion(), blink=rm?0.85:0.5+0.5*Math.sin(b.t*6); ctx.globalAlpha=blink; ctx.fillStyle=COL.senf; ctx.beginPath(); ctx.arc(x,y,BAL.boss.coreR,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
    if(b.flash>0){ ctx.globalAlpha=0.5; ctx.fillStyle=COL.elf; ctx.beginPath(); ctx.moveTo(x-w,y); ctx.lineTo(x-w+5,y-h); ctx.lineTo(x+w-5,y-h); ctx.lineTo(x+w,y); ctx.lineTo(x+w-5,y+h); ctx.lineTo(x-w+5,y+h); ctx.closePath(); ctx.fill(); ctx.globalAlpha=1; } }
}
function drawShots(){
  ctx.lineCap='butt';
  for(const sh of g.shots){ ctx.strokeStyle=COL.schwarz; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(R(sh.x),R(sh.y)); ctx.lineTo(R(sh.x),R(sh.y)-4); ctx.stroke(); ctx.strokeStyle=COL.senf; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(R(sh.x),R(sh.y)); ctx.lineTo(R(sh.x),R(sh.y)-4); ctx.stroke(); } // dunkler Saum
  for(const es of g.eshots){ const nx=es.vx/BAL.enemyShotSpeed*4, ny=es.vy/BAL.enemyShotSpeed*4; ctx.strokeStyle=COL.schwarz; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(R(es.x),R(es.y)); ctx.lineTo(R(es.x)+nx,R(es.y)+ny); ctx.stroke(); ctx.strokeStyle=COL.zinnober; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(R(es.x),R(es.y)); ctx.lineTo(R(es.x)+nx,R(es.y)+ny); ctx.stroke(); }
  if(g.specialFx>0){ ctx.strokeStyle=COL.senf; ctx.lineWidth=1; ctx.globalAlpha=Math.min(1,g.specialFx*4); ctx.beginPath(); for(let i=-2;i<=2;i++){ ctx.moveTo(R(g.ship.x),R(g.ship.y)-6); ctx.lineTo(R(g.ship.x)+i*22,-2); } ctx.stroke(); ctx.globalAlpha=1; }
  for(const p of g.particles){ ctx.fillStyle=p.col==='zinnober'?COL.zinnober:COL.rauch; ctx.fillRect(R(p.x),R(p.y),1.5,1.5); }
}
function drawFx(dt,rm){
  for(const f of fx){ f.t+=dt; const k=Math.min(1,f.t/f.dur), rad=rm?6:2+k*8; ctx.strokeStyle=COL.senf; ctx.lineWidth=0.8; ctx.globalAlpha=1-k; ctx.beginPath();
    for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; ctx.moveTo(f.x,f.y); ctx.lineTo(f.x+Math.cos(a)*rad,f.y+Math.sin(a)*rad); } ctx.stroke(); }
  ctx.globalAlpha=1; fx=fx.filter(f=>f.t<f.dur);
  if(flash>0){ ctx.strokeStyle=COL.rot; ctx.lineWidth=3; ctx.globalAlpha=Math.min(1,flash/0.2); ctx.strokeRect(1.5,1.5,W-3,H-3); ctx.globalAlpha=1; flash=Math.max(0,flash-dt); }
}
function drawIntro(alpha){
  const col=sectorColor(g.sector)[1];
  ctx.globalAlpha=alpha; ctx.fillStyle=COL.schwarz; ctx.fillRect(0,0,W,H);
  ctx.fillStyle=col; ctx.beginPath(); ctx.arc(56,64,34,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=COL.elf; ctx.textAlign='center'; ctx.font='bold 9px "SF Mono","Roboto Mono","Fira Mono","DejaVu Sans Mono",Consolas,monospace';
  const title=`SEKTOR ${g.sector}`; let x=45-(title.length-1)*2.2; for(const ch of title){ ctx.fillText(ch,x,60); x+=4.4; } // Sperrschrift
  ctx.font='3.4px "SF Mono","Roboto Mono","Fira Mono","DejaVu Sans Mono",Consolas,monospace'; ctx.fillText(missionFor(g.sector).toUpperCase(),45,72);
  ctx.globalAlpha=1;
}
function draw(dt){
  resize(); const sc=canvas.width/W, rm=reduceMotion();
  let ox=0, oy=0; if(shake>0&&!rm){ ox=(Math.random()*2-1)*shakeAmp; oy=(Math.random()*2-1)*shakeAmp; } if(shake>0) shake=Math.max(0,shake-dt);
  ctx.setTransform(sc,0,0,sc,ox*sc,oy*sc);
  ctx.fillStyle=COL.schwarz; ctx.fillRect(-2,-2,W+4,H+4);
  if(planet&&running&&!rm){ planet.drift=Math.min(BAL.planetDriftMax,planet.drift+BAL.planetDrift*dt); }
  if(planet){ const target=(g.phase==='secured')?0:1; planet.alpha+= (target-planet.alpha)*Math.min(1,dt/0.5); if(rm) planet.alpha=target; }
  drawBackground(dt,rm);
  drawEnemies(); drawShots(); if(!g.over) drawShip(rm); drawFx(dt,rm);
  if(muzzle>0) muzzle--;
  if(g.phase==='intro') drawIntro(1); else if(introFade>0){ drawIntro(rm?0:introFade/0.3); introFade=Math.max(0,introFade-dt); }
  ctx.setTransform(sc,0,0,sc,0,0);
  ctx.strokeStyle=COL.zinnober; ctx.lineWidth=0.8; ctx.beginPath(); // Eckklammern in der Akzentfarbe
  [[1,1,1,1],[W-1,1,-1,1],[1,H-1,1,-1],[W-1,H-1,-1,-1]].forEach(([cx,cy,dx,dy])=>{ ctx.moveTo(cx,cy+dy*6); ctx.lineTo(cx,cy); ctx.lineTo(cx+dx*6,cy); }); ctx.stroke();
}
function telemetry(){
  const best=Math.max(HK.bestwert?HK.bestwert():0,g.score);
  const t=[{label:'PUNKTE',value:String(g.score).padStart(4,'0')},{label:'SEKTOR',value:g.sector},{label:'HÜLLE',value:'▮'.repeat(g.hull)||'-'},{label:'SPEZIAL',value:g.special}];
  const key=JSON.stringify(t)+best; if(key===lastTele) return; lastTele=key; HK.telemetry(t);
}
function consumeEvents(rm){
  for(const ev of g.events){
    if(ev.t==='fire'){ muzzle=2; if(BAL.fireGain>0) tone(880,0.008,'square',BAL.fireGain); if(BAL.fireClickEvery>0&&ev.n%BAL.fireClickEvery===0) tone(1200,0.004,'square',BAL.fireClickGain); }
    else if(ev.t==='kill'){ tone(120,BAL.killMs/1000,'sawtooth',BAL.killGain); fx.push({x:ev.x,y:ev.y,t:0,dur:0.2}); }
    else if(ev.t==='hit'){ tone(150,0.12,'square',0.06); setTimeout(()=>tone(110,0.16,'square',0.06),120); HK.vibrate(80); if(!rm){ shake=0.15; shakeAmp=1.5; } flash=0.2; }
    else if(ev.t==='special'){ [440,660,880].forEach((f,i)=>setTimeout(()=>tone(f,0.08,'square',0.05),i*70)); HK.vibrate([30,30]); }
    else if(ev.t==='bossStart') HK.hud('Boss-Signatur erkannt.');
    else if(ev.t==='boss'){ HK.sfx.win(); HK.vibrate([40,60,40]); grantSecured(g); HK.hud(`SEKTOR ${g.sector} GESICHERT`); for(let i=0;i<3;i++) fx.push({x:ev.x+(i-1)*7,y:ev.y+(i%2?3:-3),t:-i*0.07,dur:0.25}); if(!rm){ shake=0.4; shakeAmp=1.5; } }
    else if(ev.t==='sector'){ newPlanet(g.sector); HK.hud(`SEKTOR ${g.sector} - ${missionFor(g.sector).toUpperCase()}`); }
    else if(ev.t==='end') finish();
  }
  g.events.length=0;
}
function loop(now){
  if(!running) return;
  raf=requestAnimationFrame(loop);
  const frame=Math.min(now-last,250)/1000; last=now; acc+=frame; const rm=reduceMotion();
  while(acc>=DT&&running){ acc-=DT; const ph=g.phase; step(g,DT); if(ph==='intro'&&g.phase==='wave'){ introFade=rm?0:0.3; HK.hud('Erste Welle im Anflug.'); } consumeEvents(rm); if(!running) break; }
  telemetry(); draw(frame);
}
function finish(){
  running=false; ended=true; cancelAnimationFrame(raf); raf=0; draw(0); telemetry();
  const best=HK.bestwert?HK.bestwert():0;
  HK.onEnd({score:g.score, felder:[{label:'Sektor',value:g.sector},{label:'Wellen',value:g.waves},{label:'Abschüsse',value:g.kills}], bestwert:g.score>best});
}
function control(id,pressed){
  if(!g) return;
  const axes={links:['dirX',-1],rechts:['dirX',1],hoch:['dirY',-1],runter:['dirY',1]};
  if(axes[id]){ const [ax,v]=axes[id]; if(pressed) g.ship[ax]=v; else if(g.ship[ax]===v) g.ship[ax]=0; }
  else if(id==='spezial'&&pressed&&running) useSpecial(g);
}
function onKey(e){ const map={ArrowLeft:'links',ArrowRight:'rechts',ArrowUp:'hoch',ArrowDown:'runter',a:'links',d:'rechts',w:'hoch',s:'runter',' ':'spezial',Enter:'spezial'}; const id=map[e.key]; if(id&&running){ e.preventDefault(); if(e.type==='keydown'&&e.repeat) return; control(id,e.type==='keydown'); } }
function onDrag(dxPx,dyPx){ if(!g||!running||!canvas) return; const u=W/canvas.clientWidth; g.ship.dragX+=dxPx*u; g.ship.dragY+=(dyPx||0)*u; } // relativ: das Schiff folgt der Fingerbewegung

/* Schnittstelle zur Hülle */
function mount(container,hooks){
  HK=hooks; root=container; root.classList.add('patrouille');
  styleEl=document.createElement('style'); styleEl.textContent=CSS; document.head.appendChild(styleEl);
  root.innerHTML='<div class="wrap"><canvas aria-label="Patrouille"></canvas></div>';
  canvas=root.querySelector('canvas'); ctx=canvas.getContext('2d');
  document.addEventListener('keydown',onKey); document.addEventListener('keyup',onKey);
  HK.onControl=control; HK.onDrag=onDrag;
  makeStars(); g=newGame(); newPlanet(1); running=false; ended=false; started=false; lastTele=''; fx=[]; draw(0); telemetry();
}
function start(){
  g=newGame(); newPlanet(1); ended=false; started=true; acc=0; lastTele=''; fx=[]; shake=0; flash=0; introFade=0; telemetry(); draw(0);
  HK.hud(`SEKTOR 1 - ${missionFor(1).toUpperCase()}`);
  running=true; last=performance.now(); raf=requestAnimationFrame(loop);
}
function pause(){ if(!running) return; running=false; cancelAnimationFrame(raf); raf=0; g.ship.dirX=0; g.ship.dirY=0; HK.hud('Pause.'); }
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
  debug(){ return {g,running,ended,started,raf,BAL,stars,nebula,planet,fx,shake:()=>shake,flash:()=>flash,useSpecial:()=>useSpecial(g)}; }};
if(typeof window!=='undefined'){ window.GAMES=window.GAMES||{}; window.GAMES.patrouille=api; }
if(typeof module!=='undefined'&&module.exports) module.exports={W,H,DT,BAL,WAVES,SECTOR_COLORS,MISSIONS,sectorColor,missionFor,mulberry32,waveOrder,diff,makeWave,makeBoss,asteroid,circleHit,rectCircle,shipRect,aimedShot,newGame,step,spawnWave,hitShip,useSpecial,bossDown,grantSecured,meta:META};
})();
