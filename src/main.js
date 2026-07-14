import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

const moneyFmt = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);
const hash = (n) => fract(Math.sin(n) * 43758.5453123);
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function noise3(x, y, z, seed) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const fx = fract(x), fy = fract(y), fz = fract(z);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (i, j, k) => hash(i * 127.1 + j * 311.7 + k * 74.7 + seed * 19.19);
  const x00 = lerp(h(X, Y, Z), h(X + 1, Y, Z), u), x10 = lerp(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), u);
  const x01 = lerp(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), u), x11 = lerp(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
function fbm(p, seed) { let f = 0, a = 0.55; for (let i = 0; i < 5; i++) { f += a * noise3(p.x, p.y, p.z, seed + i * 37); p.multiplyScalar(2.02); a *= 0.52; } return f; }

const app = document.querySelector('#app');
app.innerHTML = `
<header><h1>宝石猎人</h1><div class="stat">资金 <b id="money"></b></div><div class="stat">第 <b id="day"></b> 天</div></header>
<main><aside class="panel left"><h2>原石档案</h2><dl id="stoneInfo"></dl></aside><section id="stage"><canvas id="scene"></canvas><div id="hud"><div class="scan"></div><div id="progress"><span></span></div><p id="cutStatus">待机：青玉扫描平面已校准</p></div></section><aside class="panel right"><h2>机械控制台</h2><label>切割角度 <b id="angleVal"></b><input id="angle" type="range" min="-40" max="40" value="0"></label><label>切割深度 <b id="depthVal"></b><input id="depth" type="range" min="18" max="82" value="48"></label><div class="metrics"><p>预计损耗 <b id="lossVal"></b></p><p>切面面积 <b id="areaVal"></b></p></div><button id="cutBtn">开始切割</button><button id="sellBtn" disabled>按估价出售</button><button id="newBtn">放弃并换石</button><section id="report"></section></aside></main><footer>鼠标拖拽旋转 · 滚轮缩放 · 按住 Shift 精细观察</footer>`;

let cash = 128600, day = 1, current, cutting = false, cutResult = null;
const el = (id) => document.getElementById(id);
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x06120f, 8, 22);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80); camera.position.set(4.5, 3.2, 6);
const renderer = new THREE.WebGLRenderer({ canvas: el('scene'), antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.localClippingEnabled = true;
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 10;
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') controls.rotateSpeed = 0.25; });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') controls.rotateSpeed = 1; });
scene.add(new THREE.HemisphereLight(0x173b32, 0x050403, 1.2));
const key = new THREE.DirectionalLight(0xffcc76, 3); key.position.set(4, 6, 5); scene.add(key);
const rim = new THREE.PointLight(0x00ffbb, 5, 12); rim.position.set(-4, 2, -3); scene.add(rim);
const table = new THREE.Group();
table.add(new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.35, .28, 96), new THREE.MeshStandardMaterial({ color: 0x1b201d, metalness: .85, roughness: .3 })));
const grid = new THREE.GridHelper(10, 40, 0x0bd4a8, 0x153a32); grid.position.y = -.35; scene.add(grid, table);
for (const x of [-1.9, 1.9]) { const clip = new THREE.Mesh(new THREE.BoxGeometry(.24, .32, 1.55), new THREE.MeshStandardMaterial({ color: 0xb68a3c, metalness: .9, roughness: .25 })); clip.position.set(x, .1, 0); table.add(clip); }
const stoneRoot = new THREE.Group(); stoneRoot.position.y = .85; scene.add(stoneRoot);
const planeHelper = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ color: 0x00ffd5, transparent: true, opacity: .23, side: THREE.DoubleSide, depthWrite: false })); stoneRoot.add(planeHelper);
const particles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x7fffe5, size: .035, transparent: true, opacity: 0 })); scene.add(particles);

function makeTexture(q) { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); const grd = g.createRadialGradient(230, 180, 20, 256, 256, 360); const hue = 120 + q.color * 34; grd.addColorStop(0, `hsla(${hue},75%,${42 + q.water * 18}%,.96)`); grd.addColorStop(1, `hsla(${hue-20},40%,${18 + q.water * 14}%,1)`); g.fillStyle = grd; g.fillRect(0,0,512,512); for(let i=0;i<90;i++){g.strokeStyle=`rgba(190,255,225,${(1-q.cotton)*.04 + Math.random()*.08})`; g.lineWidth=1+Math.random()*5; g.beginPath(); g.moveTo(Math.random()*512,Math.random()*512); g.bezierCurveTo(Math.random()*512,Math.random()*512,Math.random()*512,Math.random()*512,Math.random()*512,Math.random()*512); g.stroke();} for(let i=0;i<q.crack*42;i++){g.strokeStyle='rgba(15,45,35,.62)'; g.lineWidth=.7+Math.random()*1.8; g.beginPath(); g.moveTo(Math.random()*512,Math.random()*512); g.lineTo(Math.random()*512,Math.random()*512); g.stroke();} return new THREE.CanvasTexture(c); }
function generateStone() {
  const seed = Math.floor(Math.random() * 1e9), rnd = seeded(seed);
  const q = { water: rnd(), color: rnd(), cotton: rnd(), crack: rnd() };
  const value = Math.round((22000 + q.water * 88000 + q.color * 96000 - q.cotton * 42000 - q.crack * 68000) * (0.75 + rnd() * .7));
  const weight = +(1.2 + rnd() * 5.8).toFixed(2), price = Math.max(4800, Math.round((value * (.45 + rnd() * .55) + weight * 2200) / 100) * 100);
  return { seed, q, value, weight, price, id: `GH-${String(seed).slice(0,6)}`, mine: ['莫湾基','帕敢','木那','会卡','后江'][Math.floor(rnd()*5)], skin: ['黑乌砂','黄盐砂','老象皮','铁锈皮','青灰蜡壳'][Math.floor(rnd()*5)], risk: ['雾层厚，裂向不明','皮紧砂细，局部有蟒','癣带靠边，赌色风险高','翻砂均匀，棉感未知'][Math.floor(rnd()*4)] };
}
function stoneGeometry(stone) { const geo = new THREE.IcosahedronGeometry(1.45, 7); const pos = geo.attributes.position; for (let i=0;i<pos.count;i++){ const v = new THREE.Vector3().fromBufferAttribute(pos,i); const n = fbm(v.clone().multiplyScalar(1.45), stone.seed); v.normalize().multiplyScalar(1 + (n-.45)*.34); v.x*=1.05; v.y*=.88; v.z*=.94; pos.setXYZ(i,v.x,v.y,v.z); } geo.computeVertexNormals(); return geo; }
function updateUI(){ el('money').textContent=moneyFmt.format(cash); el('day').textContent=day; el('stoneInfo').innerHTML=`<dt>编号</dt><dd>${current.id}</dd><dt>场口</dt><dd>${current.mine}</dd><dt>重量</dt><dd>${current.weight} kg</dd><dt>皮壳</dt><dd>${current.skin}</dd><dt>购入价</dt><dd>${moneyFmt.format(current.price)}</dd><dt>风险情报</dt><dd>${current.risk}</dd>`; }
function loadStone(charge = false){ stoneRoot.children.filter(o=>o.userData.stone).forEach(o=>stoneRoot.remove(o)); current=generateStone(); if (charge) cash = Math.max(0, cash - current.price); cutResult=null; el('report').innerHTML=''; el('sellBtn').disabled=true; const mat=new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(.23+current.q.color*.07,.22,.22),roughness:.92,metalness:.02,bumpScale:.05}); const mesh=new THREE.Mesh(stoneGeometry(current),mat); mesh.userData.stone=true; stoneRoot.add(mesh); updateUI(); updatePlane(); }
function cutNormal(){ return new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(+el('angle').value)),0,Math.cos(THREE.MathUtils.degToRad(+el('angle').value))).normalize(); }
function updatePlane(){ const angle=+el('angle').value, depth=+el('depth').value; el('angleVal').textContent=`${angle}°`; el('depthVal').textContent=`${depth}%`; const n=cutNormal(), offset=lerp(-.85,.85,depth/100); planeHelper.position.copy(n.clone().multiplyScalar(offset)); planeHelper.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), n); const loss=Math.round(Math.abs(depth-50)*1.15+10+Math.abs(angle)*.22); el('lossVal').textContent=`${loss}%`; el('areaVal').textContent=`${(Math.PI*(1.45**2)*(1-Math.abs(depth-50)/90)).toFixed(2)} m²`; }
el('angle').oninput = el('depth').oninput = updatePlane;
function capMesh(sign, n, offset, texture){ const pts=[]; for(let i=0;i<44;i++){ const a=i/44*Math.PI*2, r=1.05+noise3(Math.cos(a)*2, Math.sin(a)*2, .2, current.seed)*.34; pts.push(new THREE.Vector2(Math.cos(a)*r, Math.sin(a)*r*.82)); } const shape=new THREE.Shape(pts); const geo=new THREE.ShapeGeometry(shape); const mat=new THREE.MeshPhysicalMaterial({map:texture,color:0x65ffac,roughness:.12,metalness:0,clearcoat:1,clearcoatRoughness:.08,transmission:.28+current.q.water*.3,thickness:.75,emissive:0x004c32,emissiveIntensity:.35+current.q.water*.45,side:THREE.DoubleSide}); const m=new THREE.Mesh(geo,mat); m.position.copy(n.clone().multiplyScalar(offset+.008*sign)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), n.clone().multiplyScalar(sign)); m.userData.stone=true; return m; }
function audioCut(){ const A=window.AudioContext||window.webkitAudioContext; if(!A) return; const ctx=new A(), osc=ctx.createOscillator(), gain=ctx.createGain(), filt=ctx.createBiquadFilter(); osc.type='sawtooth'; osc.frequency.setValueAtTime(110,ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(58,ctx.currentTime+1.8); filt.type='bandpass'; filt.frequency.value=900; gain.gain.setValueAtTime(.0001,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.08,ctx.currentTime+.08); gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+3.2); osc.connect(filt).connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+3.3); }
async function cut(){ if(cutting||cutResult) return; cutting=true; el('cutBtn').disabled=true; audioCut(); const bar=el('progress'); bar.classList.add('on'); const n=cutNormal(), offset=lerp(-.85,.85,+el('depth').value/100); const original=stoneRoot.children.find(o=>o.isMesh&&o.material?.roughness>.5); stoneRoot.remove(original); const tex=makeTexture(current.q), p1=new THREE.Plane(n, -offset), p2=new THREE.Plane(n.clone().negate(), offset); const makeHalf=(plane)=>new THREE.Mesh(original.geometry.clone(), original.material.clone()); const a=makeHalf(p1), b=makeHalf(p2); a.material.clippingPlanes=[p1]; b.material.clippingPlanes=[p2]; a.userData.stone=b.userData.stone=true; const ca=capMesh(1,n,offset,tex), cb=capMesh(-1,n,offset,tex); stoneRoot.add(a,b,ca,cb); let start=performance.now(); await new Promise(resolve=>{ function step(t){ const k=clamp((t-start)/3500,0,1); el('cutStatus').textContent=`砂轮进度 ${Math.round(k*100)}% · 温度 ${Math.round(42+k*410)}℃`; el('progress').style.setProperty('--p',`${k*100}%`); particles.material.opacity=Math.sin(k*Math.PI)*.9; if(k<1) requestAnimationFrame(step); else resolve(); } requestAnimationFrame(step); }); const sep=.72; [a,ca].forEach(o=>o.position.add(n.clone().multiplyScalar(sep))); [b,cb].forEach(o=>o.position.add(n.clone().multiplyScalar(-sep))); bar.classList.remove('on'); particles.material.opacity=0; const score=current.value-current.price, grade=score>80000?'暴涨':score>15000?'涨':score>-12000?'平':'垮'; const names=['豆种','糯种','冰糯种','冰种','玻璃种']; cutResult={ estimate: Math.max(1200, current.value), grade }; el('report').innerHTML=`<h3>开石报告</h3><p>种水：${names[Math.floor(current.q.water*4.99)]}</p><p>颜色：${current.q.color>.72?'帝王绿':current.q.color>.45?'阳绿':'油青'}</p><p>裂纹：${current.q.crack>.65?'多裂':current.q.crack>.35?'微裂':'少裂'}</p><p>估价：<b>${moneyFmt.format(cutResult.estimate)}</b></p><strong>${grade}</strong>`; el('sellBtn').disabled=false; el('cutStatus').textContent='切割完成：切面封口已锁定半体'; cutting=false; }
el('cutBtn').onclick=cut; el('sellBtn').onclick=()=>{ if(!cutResult) return; cash += cutResult.estimate; day++; loadStone(true); el('cutBtn').disabled=false; }; el('newBtn').onclick=()=>{ if(cutting) return; day++; el('cutBtn').disabled=false; loadStone(true); };
function resize(){ const r=el('stage').getBoundingClientRect(); camera.aspect=r.width/r.height; camera.updateProjectionMatrix(); renderer.setSize(r.width,r.height,false); }
new ResizeObserver(resize).observe(el('stage')); function animate(){ controls.update(); renderer.render(scene,camera); requestAnimationFrame(animate); } loadStone(); resize(); animate();
