/* Foulée — application : état, synchronisation avec l'API, écrans */
/* ================= formats ================= */
const nf=(v,d=1)=>(+v).toLocaleString('fr-FR',{maximumFractionDigits:d});
const sgn=(v,d=1)=>(v>0?'+':v<0?'−':'')+nf(Math.abs(v),d);
const fmtClock=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')};
const fmtPace=s=>s?fmtClock(s):'–';
const fmtDur=m=>{m=Math.round(m||0);return m>=60?Math.floor(m/60)+' h '+String(m%60).padStart(2,'0'):m+' min'};
const parseClock=t=>{const a=String(t||'').trim().split(/[:'h.]/).map(Number);if(!a.length||a.some(isNaN))return 0;return a.length>=3?a[0]*3600+a[1]*60+a[2]:a.length===2?a[0]*60+a[1]:a[0]*60};
const dOf=s=>new Date(s+'T12:00');
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const weekKeyOf=d=>ymd(mondayOf(dOf(d)));
const byDate=(a,b)=>a.date<b.date?-1:a.date>b.date?1:0;
const ICONS={today:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',week:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  meals:'<path d="M6 3v7a2 2 0 0 0 4 0V3M8 3v18M17 21V3c-2.2 1.6-3.5 4.4-3.5 7.5 0 1.6 1.2 2.5 3.5 2.5"/>',track:'<path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/>',
  profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',check:'<path d="M5 12.5l4.5 4.5L19 7"/>',play:'<path d="M7 4v16l13-8z"/>',pause:'<path d="M8 5v14M16 5v14"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  spark:'<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',down:'<path d="M12 4v12M6 11l6 6 6-6M5 20h14"/>'};
const icon=(n,s=20)=>`<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

/* ================= state ================= */
const DEMO={prenom:'',sexe:'h',age:30,taille:178,poids:82,poidsCible:76,niveau:'debutant',chrono5k:'31:05',jours:[...new Set([DOW,(DOW+2)%7,(DOW+4)%7,(DOW+5)%7])].sort(),duree:45,
  materiel:['aucun','elastiques'],principal:'poids',aime:'poulet, pâtes, saumon, fromage blanc, fruits rouges',deteste:'chou de Bruxelles',
  regime:'omnivore',allergies:'',cuisine:'rapide',collation:true,limitations:'',debut:ymd(addDays(MON,-56))};
const newLogs=()=>({v:2,checks:{},checkin:{},adapt:{},shop:{},chrono:null,bilan:null});
const S={profile:null,training:null,meals:null,logs:newLogs(),demo:true,tab:'today',mealDay:DOW,weekSel:DOW,range:12,journalAll:false,
  ai:false,user:null,busy:null,notice:null,aiChecked:false,booted:false,lastPull:0};
const COLS=['sessions','weights','measures','tests','weeks'],DOCS=['profile','training','meals','logs'];
const J={sessions:{},weights:{},measures:{},tests:{},weeks:{}};   // history, one document per entry
const P=()=>S.profile||DEMO;

/* ================= data layer =================
   Les données vivent sur le serveur (API REST + PostgreSQL). Ce navigateur en garde une copie :
   la page s'affiche tout de suite, reste utilisable hors ligne, et les saisies qui n'ont pas pu
   partir sont renvoyées à la reconnexion (identifiants fournis par le client : aucun doublon). */
const ls={get(k){try{const v=localStorage.getItem('foulee.'+k);return v?JSON.parse(v):null}catch(e){return null}},
  set(k,v){try{localStorage.setItem('foulee.'+k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem('foulee.'+k)}catch(e){}}};
const pend={d:Object.assign({docs:{},cols:{},del:{}},ls.get('pending')||{}),save(){ls.set('pending',this.d)},
  mark(k,id){this.d[k][id]=1;this.save()},clear(k,id){if(this.d[k][id]){delete this.d[k][id];this.save()}},
  any(){return Object.keys(this.d.docs).length+Object.keys(this.d.cols).length+Object.keys(this.d.del).length}};
/* ---------- HTTP ---------- */
async function api(method,url,body){let res;
  try{res=await fetch(url,{method,credentials:'same-origin',headers:body!==undefined?{'content-type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined})}
  catch(e){throw{code:'offline',message:'Serveur injoignable.'}}
  let data=null;try{data=await res.json()}catch(e){}
  if(!res.ok){const err=Object.assign({code:'http_'+res.status,message:'Erreur '+res.status},data&&data.error,{status:res.status});
    if(res.status===401&&!url.startsWith('/api/auth/')&&url!=='/api/account')onSignedOut();throw err}
  return data}
const DOC_URL={profile:()=>'/api/profile',training:v=>'/api/plans/training/'+v.weekKey,meals:v=>'/api/plans/meals/'+v.weekKey,logs:()=>'/api/state'};
const COL_URL={sessions:'/api/sessions/',weights:'/api/weights/',measures:'/api/measures/',tests:'/api/tests/'};
const store={mode:'local',inflight:0,chains:{},warned:false,
  /* one request at a time per resource, in order. Resolves true (saved), false (to retry later) or 'rejected' (the server refused the data). */
  run(path,fn){if(this.mode!=='db')return Promise.resolve(false);
    const prev=this.chains[path]||Promise.resolve();this.inflight++;syncUI();
    const retry=e=>e&&(e.code==='offline'||e.status>=500);
    const p=prev.then(async()=>{try{await fn()}catch(e){if(retry(e)){await new Promise(r=>setTimeout(r,700+Math.random()*900));await fn()}else throw e}return true})
      .catch(e=>this.fail(e)).finally(()=>{this.inflight--;if(this.chains[path]===p)delete this.chains[path];syncUI()});
    this.chains[path]=p;return p},
  fail(e){const st=e&&e.status;
    if(st===401)return false;
    if(st===400||st===404||st===413){const d=e.details&&e.details[0];notice('Le serveur a refusé un enregistrement'+(d?' ('+d.champ+' : '+d.message+')':'')+'.','warn');return'rejected'}
    if(!this.warned){this.warned=true;notice(st===429?'Trop de requêtes : tes dernières saisies seront renvoyées un peu plus tard.':'Serveur injoignable. Tes saisies restent dans ce navigateur et seront renvoyées à la reconnexion.','warn')}
    return false},
  idle(){return Promise.all(Object.values(this.chains))},
  setDoc(k,v){const c=clone(v);ls.set(k,c);pend.mark('docs',k);
    return this.run('d/'+k,async()=>{await api('PUT',DOC_URL[k](c),c);pend.clear('docs',k)}).then(r=>{if(r==='rejected')pend.clear('docs',k);return r===true})},
  delDoc(k){ls.del(k);pend.clear('docs',k);return Promise.resolve(true)},
  put(col,id,doc){const c=clone(doc),key=col+'/'+id;J[col][id]=c;ls.set('c.'+col,J[col]);
    if(!COL_URL[col])return Promise.resolve(true);        // l'archive des semaines vit côté serveur, dans la table des programmes
    pend.clear('del',key);pend.mark('cols',key);
    return this.run('c/'+key,async()=>{await api('PUT',COL_URL[col]+encodeURIComponent(id),c);pend.clear('cols',key)}).then(r=>{if(r==='rejected')pend.clear('cols',key);return r===true})},
  remove(col,id){const key=col+'/'+id;delete J[col][id];ls.set('c.'+col,J[col]);
    if(!COL_URL[col])return Promise.resolve(true);
    pend.clear('cols',key);pend.mark('del',key);
    return this.run('c/'+key,async()=>{await api('DELETE',COL_URL[col]+encodeURIComponent(id));pend.clear('del',key)}).then(r=>{if(r==='rejected')pend.clear('del',key);return r===true})},
  async pull(){const b=await api('GET','/api/bootstrap?week='+WEEK);S.ai=!!b.ai;S.user=b.user;S.aiChecked=true;
    return{docs:{profile:b.profile,training:b.training,meals:b.meals,logs:b.state},cols:{sessions:b.sessions,weights:b.weights,measures:b.measures,tests:b.tests,weeks:b.weeks}}}
};
/* tout relire depuis le serveur, puis rejouer ce que ce navigateur doit encore envoyer */
async function syncDown(){if(store.mode!=='db')return null;let r;try{r=await store.pull()}catch(e){store.fail(e);return null}
  for(const c of COLS){const local=ls.get('c.'+c)||{};J[c]=r.cols[c];
    for(const key of Object.keys(pend.d.cols)){const [cc,id]=key.split('/');if(cc!==c)continue;if(local[id])store.put(c,id,local[id]);else pend.clear('cols',key)}
    for(const key of Object.keys(pend.d.del)){const [cc,id]=key.split('/');if(cc!==c)continue;if(J[c][id])store.remove(c,id);else pend.clear('del',key)}
    ls.set('c.'+c,J[c])}
  const docs={};
  for(const k of DOCS){const local=ls.get(k);
    if(local&&(pend.d.docs[k]||!r.docs[k])){docs[k]=local;store.setDoc(k,local)}else{docs[k]=r.docs[k];if(r.docs[k])ls.set(k,r.docs[k])}}
  S.lastPull=Date.now();return docs}
let logsT;
function saveLogs(now){ls.set('logs',S.logs);pend.mark('docs','logs');clearTimeout(logsT);
  if(now)return store.setDoc('logs',S.logs);logsT=setTimeout(()=>store.setDoc('logs',S.logs),800)}
function syncUI(){const db=store.mode==='db',busy=store.inflight>0,wait=pend.any()>0;
  const txt=!S.booted?'Connexion…':db?(busy?'Enregistrement…':wait?'Envoi en attente':'Données synchronisées'):'Hors ligne · envoi à la reconnexion';
  document.querySelectorAll('.js-sync').forEach(e=>e.textContent=txt);
  document.querySelectorAll('.js-sync-dot').forEach(e=>{e.className='dot js-sync-dot'+(db&&!busy&&!wait&&S.booted?' on':busy||wait?' busy':'');e.parentElement.title=txt})}

/* ================= history helpers ================= */
const grp=t=>t==='course'||t==='mixte'?'course':t==='renfo'?'renfo':'autre';
const GRP={course:{l:'Course',c:'var(--c1)'},renfo:{l:'Renfo',c:'var(--c2)'},autre:{l:'Autre',c:'var(--c3)'}};
const sessions=()=>Object.entries(J.sessions).filter(([,s])=>s&&s.date).map(([id,s])=>({id,...s})).sort((a,b)=>byDate(a,b)||a.id.localeCompare(b.id));
const weights=()=>Object.values(J.weights).filter(w=>w&&w.date&&w.kg).sort(byDate);
const measures=()=>Object.values(J.measures).filter(m=>m&&m.date).sort(byDate);
const tests=()=>Object.entries(J.tests).filter(([,t])=>t&&t.date).map(([id,t])=>({id,...t})).sort(byDate);
const sessOn=d=>J.sessions[d]?{id:d,...J.sessions[d]}:sessions().find(s=>s.date===d)||null;
const plannedCount=tr=>(tr?.days||[]).filter(d=>d.type!=='repos').length;
function weekSeries(n){const out=[];for(let i=n-1;i>=0;i--){const m=addDays(MON,-7*i),wk=ymd(m);
    out.push({wk,mon:m,course:0,renfo:0,autre:0,km:0,faites:0,prevues:wk===WEEK?plannedCount(S.training):(J.weeks[wk]?.prevues??null)})}
  const idx=Object.fromEntries(out.map((w,i)=>[w.wk,i]));
  for(const s of sessions()){const w=out[idx[s.weekKey||weekKeyOf(s.date)]];if(!w)continue;w[grp(s.type)]+=+s.dureeMin||0;if(grp(s.type)==='course')w.km+=+s.distanceKm||0;w.faites++}
  return out}
const weekArchive=tr=>({date:tr.weekKey,weekKey:tr.weekKey,semaine:tr.semaine||0,focus:tr.focus||'',source:tr.source||'local',prevues:plannedCount(tr),
  days:(tr.days||[]).map(d=>({day:d.day,type:d.type,titre:d.titre,duree:d.duree||0}))});
const firstDate=()=>[sessions()[0]?.date,weights()[0]?.date,measures()[0]?.date].filter(Boolean).sort()[0]||TODAY;
const rangeStart=()=>S.range?ymd(addDays(MON,-7*(S.range-1))):'0000-00-00';
const rangeWeeks=()=>S.range||clamp(Math.ceil((NOW-dOf(firstDate()))/6048e5)+1,4,52);
function trendPerWeek(ws){if(ws.length<3)return null;const t0=dOf(ws[0].date).getTime(),xs=ws.map(w=>(dOf(w.date)-t0)/6048e5),ys=ws.map(w=>w.kg);
  if(xs[xs.length-1]<1.4)return null;const n=xs.length,mx=xs.reduce((a,b)=>a+b)/n,my=ys.reduce((a,b)=>a+b)/n;let num=0,den=0;
  xs.forEach((x,i)=>{num+=(x-mx)*(ys[i]-my);den+=(x-mx)**2});return den?num/den:null}
const TESTS={'5km':{l:'5 km',u:'t',low:1},'10km':{l:'10 km',u:'t',low:1},'1km':{l:'1 km',u:'t',low:1},pompes:{l:'Pompes max',u:'n'},gainage:{l:'Gainage (planche)',u:'t'},squats:{l:'Squats en 1 min',u:'n'},tractions:{l:'Tractions max',u:'n'}};
const fmtTest=(k,v)=>TESTS[k]?.u==='t'?fmtClock(v):nf(v,0)+' rép.';
const sessSummary=x=>[fmtDur(x.dureeMin),x.distanceKm?nf(x.distanceKm,2)+' km':'',x.allureSec?fmtPace(x.allureSec)+' /km':'',x.rpe?'effort '+x.rpe+'/10':''].filter(Boolean).join(' · ');

/* example history shown until a profile exists — never saved */
function seedDemo(){for(const c of COLS)J[c]={};const rnd=seeded('demo');
  const plan=DEMO.jours.map((d,i)=>[d,i===1?'renfo':'course',['Course / marche','Renfo & gainage du coureur','Course / marche + accélérations','Sortie un peu plus longue'][i]]);
  for(let w=8;w>=0;w--){const mon=addDays(MON,-7*w),wk=ymd(mon),prog=(8-w)/8;
    for(const [d,t,ti] of plan){const id=ymd(addDays(mon,d));if(id>=TODAY||rnd()<0.13)continue;
      const dur=t==='renfo'?34+Math.round(rnd()*8):Math.round(25+prog*14+rnd()*5+(ti.startsWith('Sortie')?9:0)),km=t==='course'?+(dur/(8.5-prog*1.2+rnd()*0.3)).toFixed(1):0;
      J.sessions[id]={date:id,weekKey:wk,type:t,titre:ti,prevue:true,dureeMin:dur,distanceKm:km,allureSec:km?Math.round(dur*60/km):0,rpe:Math.round(5+rnd()*3),ressenti:rnd()<.2?'dur':rnd()<.3?'facile':'ok',note:''}}
    if(w>0)J.weeks[wk]={date:wk,weekKey:wk,semaine:9-w,focus:'Construire l\'endurance, renforcer le corps',source:'local',prevues:4,days:plan.map(([d,t,ti])=>({day:d,type:t,titre:ti,duree:40}))};
    for(const d of [0,3]){const id=ymd(addDays(mon,d));if(id>TODAY)continue;J.weights[id]={date:id,kg:+(85.7-(8-w)*0.42-d*0.05+(rnd()-.5)*0.6).toFixed(1)}}
    if(w%2===0&&wk<=TODAY)J.measures[wk]={date:wk,taille:+(94-(8-w)*0.5+(rnd()-.5)*.4).toFixed(1),hanches:+(102-(8-w)*0.28).toFixed(1),poitrine:+(101-(8-w)*0.08).toFixed(1)}}
  [[56,'5km',2050],[28,'5km',1940],[6,'5km',1865],[56,'pompes',12],[28,'pompes',16],[6,'pompes',19],[56,'gainage',45],[6,'gainage',95]].forEach(([ago,test,valeur],i)=>{const d=ymd(addDays(NOW,-ago));J.tests['demo'+i]={date:d,test,valeur}})}

/* ================= coach Claude (appels au serveur) ================= */
const ERR={unavailable:"La génération par Claude n'est pas activée sur ce serveur : le programme intégré est utilisé.",ai_disabled:"La génération par Claude n'est pas activée sur ce serveur.",
  ai_refused:'Claude a décliné cette demande.',ai_rate_limited:'Claude est très sollicité. Réessaie dans quelques minutes.',rate_limited:'Limite de générations atteinte pour cette heure. Réessaie plus tard.',
  ai_invalid:'La réponse de Claude était incomplète. Réessaie.',ai_truncated:'La réponse de Claude a été coupée. Réessaie.',ai_auth:'La clé API du serveur est refusée.',ai_upstream:"L'API de Claude ne répond pas pour le moment.",
  no_profile:'Crée d\'abord ton profil.',offline:'Serveur injoignable. Vérifie ta connexion.'};
const aiFail=e=>notice(ERR[e.code]||('Échec : '+(e.message||e.code)),'warn');
/* le serveur lit le profil et l'historique en base : on attend que les dernières saisies y soient arrivées */
async function ask(url,body,label){S.busy=label;renderToast();try{await store.idle();return await api('POST',url,body)}finally{S.busy=null;renderToast()}}
async function genTraining(){try{const r=await ask('/api/ai/training',{week:WEEK,today:TODAY},'Claude prépare ton programme de la semaine… (30 s à 1 min)');S.training=r.plan;ls.set('training',r.plan);pend.clear('docs','training');notice('Programme de la semaine prêt.');render();return true}catch(e){aiFail(e);return false}}
async function genMeals(){try{const r=await ask('/api/ai/meals',{week:WEEK,today:TODAY},'Claude compose tes repas et ta liste de courses… (1 à 2 min)');S.meals=r.plan;ls.set('meals',r.plan);pend.clear('docs','meals');notice('Menus de la semaine prêts.');render();return true}catch(e){aiFail(e);return false}}
async function swapMeal(day,idx){const p=P(),m=S.meals.jours[day].repas[idx];
  if(S.ai){try{const r=await ask('/api/ai/swap-meal',{week:WEEK,day,index:idx},'Claude cherche une alternative…');S.meals=r.plan;ls.set('meals',r.plan);render();notice('Repas remplacé. Pense à vérifier ta liste de courses.');return}catch(e){aiFail(e)}}
  const kind=m.moment==='Petit-déjeuner'?'pdj':m.moment==='Collation'?'col':'repas',used=new Set(S.meals.jours.flatMap(d=>d.repas.map(r=>r.nom)));
  const pool=allowedRecipes(p).filter(r=>r.m===kind&&!used.has(r.nom)),pick=pool.length?pool[Math.floor(Math.random()*pool.length)]:null;
  if(!pick)return notice('Plus d\'alternative disponible dans la base intégrée.','warn');S.meals.jours[day].repas[idx]=toMeal(pick,m.moment);S.meals.courses=shoppingFrom(S.meals.jours);store.setDoc('meals',S.meals);render()}
const CI0=()=>({energie:3,temps:0,courbatures:false});
function todaySession(base){if(!base&&S.logs.adapt?.date===TODAY)return S.logs.adapt.session;return S.training?.days?.[DOW]||{day:DOW,...restDay(P())}}
async function adaptToday(){const ci=S.logs.checkin[TODAY]||CI0(),base=todaySession(true);
  if(S.ai){try{const r=await ask('/api/ai/adapt',{session:base,checkin:{energie:ci.energie||3,temps:ci.temps||0,courbatures:!!ci.courbatures}},'Claude adapte ta séance du jour…');
      S.logs.adapt={date:TODAY,session:r.session};S.logs.checks[TODAY]=[];saveLogs(true);render();return}
    catch(e){notice((ERR[e.code]||'Claude n\'a pas pu répondre.')+' Adaptation automatique appliquée.','warn')}}
  S.logs.adapt={date:TODAY,session:adaptLocal(base,ci)};S.logs.checks[TODAY]=[];saveLogs(true);render()}
async function genBilan(){if(needProfile())return;if(!S.ai)return notice(ERR.unavailable,'warn');if(S.busy)return;
  try{const r=await ask('/api/ai/review',{week:WEEK,today:TODAY},'Claude analyse ta progression…');S.logs.bilan={date:TODAY,text:str(r.text)};saveLogs(true);render()}catch(e){aiFail(e)}}

/* ================= toast & banner ================= */
let noticeTimer;
function notice(msg,kind){S.notice={msg,kind};renderToast();clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{S.notice=null;renderToast()},kind==='warn'?9000:5000)}
function renderToast(){const t=$('#toast');
  if(S.busy){t.className='toast';t.innerHTML=`<span class="loader" aria-hidden="true"></span><p>${esc(S.busy)}</p>`;t.hidden=false}
  else if(S.notice){t.className='toast'+(S.notice.kind==='warn'?' warn':'');t.innerHTML=`<p>${esc(S.notice.msg)}</p>`;t.hidden=false}
  else t.hidden=true}
function renderBanner(){const b=$('#banner');let h='';
  if(S.demo)h=`<div class="banner"><p><b>Exemple.</b> Le programme, les menus et l'historique affichés sont ceux d'un profil type. Crée ton profil (2 min) pour obtenir les tiens et commencer ton suivi.</p><button class="btn primary" data-go="profile">Créer mon profil</button></div>`;
  else if(S.training?.prevWeek&&S.ai)h=`<div class="banner"><p><b>Nouvelle semaine.</b> Ton programme a été reconduit automatiquement. Claude peut en écrire un sur mesure à partir de tes résultats de la semaine passée.</p><button class="btn primary" id="weeklyBtn">${icon('spark',16)}Générer avec Claude</button></div>`;
  b.innerHTML=h;b.hidden=!h;
  b.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>go(x.dataset.go));
  $('#weeklyBtn')&&($('#weeklyBtn').onclick=async()=>{if(S.busy)return;if(await genTraining())await genMeals()})}
function needProfile(){if(!S.demo)return false;notice('Crée d\'abord ton profil pour enregistrer tes propres données.');go('profile');return true}
function armed(btn,fn){if(btn.dataset.armed)return fn();btn.dataset.armed=1;const t=btn.innerHTML;btn.textContent='Confirmer ?';setTimeout(()=>{if(btn.isConnected&&btn.dataset.armed){delete btn.dataset.armed;btn.innerHTML=t}},3500)}

/* ================= chronometer ================= */
function chronoState(){const c=S.logs.chrono;if(!c||c.date!==TODAY)return{sec:0,running:false};return{sec:(c.acc||0)+(c.start?(Date.now()-c.start)/1000:0),running:!!c.start}}
function chronoToggle(){const c=chronoState();S.logs.chrono={date:TODAY,acc:Math.round(c.sec),start:c.running?0:Date.now()};saveLogs(true);render()}
setInterval(()=>{const el=$('#chronoTxt');if(el){const c=chronoState();if(c.running)el.textContent=fmtClock(c.sec)}},1000);

/* ================= shared view parts ================= */
const TYPE_LABEL={course:'Course',renfo:'Renfo',mixte:'Course + renfo',mobilite:'Mobilité',repos:'Repos',autre:'Autre activité'};
const INT_LABEL={facile:'Facile',moderee:'Modérée',intense:'Intense'};
const RES_LABEL={facile:'Trop facile',ok:'Juste bien',dur:'Trop dur'};
const srcTag=x=>x?`<span class="src">${x.source==='claude'?'Écrit par Claude':'Programme intégré'}${x.semaine?' · semaine '+x.semaine:''}</span>`:'';
function hero(s,done,o={}){const rest=s.type==='repos';let foot='';
  if(done)foot=`<div class="hero-done">${icon('check',22)}<div><b>Séance enregistrée</b><span>${esc(sessSummary(done))}</span></div><button class="btn onhero small" data-editsess="${esc(done.id)}">Modifier</button></div>`;
  else if(o.today&&!rest){const c=chronoState();foot=`<div class="hero-actions"><span class="chrono num" id="chronoTxt">${fmtClock(c.sec)}</span><button class="btn onhero" id="chronoBtn">${icon(c.running?'pause':'play',16)}${c.running?'Pause':c.sec?'Reprendre':'Démarrer'}</button><button class="btn solid" id="finishBtn">${icon('check',16)}Terminer la séance</button></div>`}
  else if(o.today&&rest)foot=`<div class="hero-actions"><button class="btn onhero" data-addsess="${TODAY}">${icon('plus',16)}J'ai quand même bougé</button></div>`;
  else if(o.past&&!rest)foot=`<div class="hero-actions"><button class="btn solid" data-logday="${o.day}">${icon('check',16)}Enregistrer cette séance</button></div>`;
  return `<section class="hero t-${s.type}"><div class="hero-top"><span class="pill">${TYPE_LABEL[s.type]}</span>${s.adaptee?'<span class="pill ghost">Adaptée à ta forme du jour</span>':''}${o.label?`<span class="hero-date">${esc(o.label)}</span>`:''}</div>
   <h2>${esc(s.titre)}</h2>${rest?`<p class="hero-text">${esc(s.conseil)}</p>`:`<div class="hero-meta"><div><b class="num">${s.duree||'–'}</b><span>minutes</span></div><div><b>${INT_LABEL[s.intensite]||'–'}</b><span>intensité</span></div><div><b class="num">${s.blocs.length}</b><span>blocs</span></div></div>`}${foot}</section>`}
function steps(s,key,interactive){const checks=new Set(S.logs.checks[key]||[]);
  return `${s.echauffement?`<div class="step"><span class="label">Échauffement</span><p>${esc(s.echauffement)}</p></div>`:''}
   <div class="step"><div class="row between"><span class="label">Corps de séance</span>${interactive?`<span class="count num" id="blocCount">${checks.size}/${s.blocs.length}</span>`:''}</div>
    <ul class="blocs">${s.blocs.map((b,i)=>`<li class="bloc ${interactive&&checks.has(i)?'done':''}">${interactive?`<input type="checkbox" id="b-${key}-${i}" data-bloc="${i}" data-key="${key}" ${checks.has(i)?'checked':''}>`:`<span class="bn-i num">${i+1}</span>`}<label ${interactive?`for="b-${key}-${i}"`:''}><span class="bn">${esc(b.nom)}</span><span class="bd">${esc(b.detail)}</span></label></li>`).join('')}</ul></div>
   ${s.retour?`<div class="step"><span class="label">Retour au calme</span><p>${esc(s.retour)}</p></div>`:''}
   ${s.conseil?`<div class="tip-box">${icon('spark',16)}<p>${esc(s.conseil)}</p></div>`:''}`}
function weekStrip(){return `<div class="strip" role="group" aria-label="Jours de la semaine">${S.training.days.map((d,i)=>{const dn=sessOn(ymd(dateOf(i)));
  return `<button class="wd t-${d.type}${i===DOW?' now':''}${dn?' done':''}" data-day="${i}" title="${DAYS[i]} · ${esc(d.titre)}${dn?' · faite':''}" aria-label="${DAYS[i]} : ${esc(d.titre)}${dn?', faite':''}"><span>${DSHORT[i][0]}</span><i>${dn?icon('check',11):''}</i></button>`}).join('')}</div>`}
function ring(done,total){const r=26,c=2*Math.PI*r,f=total?clamp(done/total,0,1):0;
  return `<svg viewBox="0 0 64 64" width="72" height="72" role="img" aria-label="${done} séances faites sur ${total} prévues"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--accent-soft)" stroke-width="7"/>${f?`<circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c*f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>`:''}<text x="32" y="38" text-anchor="middle" class="ringtxt">${done}/${total}</text></svg>`}
const mealsOfDay=i=>S.meals?.jours?.[i]?.repas||[];
const dayTotals=i=>mealsOfDay(i).reduce((a,m)=>({kcal:a.kcal+(m.kcal||0),prot:a.prot+(m.prot||0)}),{kcal:0,prot:0});

/* ================= view: today ================= */
function viewToday(){const s=todaySession(),p=P(),t=targets(p),done=sessOn(TODAY),ci=S.logs.checkin[TODAY]||{energie:0,temps:0,courbatures:false},tot=dayTotals(DOW),w=weekSeries(1)[0],lw=weights().slice(-1)[0];
  return `<div class="pagehead"><div><span class="label">${fmtD(NOW,{weekday:'long',day:'numeric',month:'long'})}</span><h2>${p.prenom?'Salut '+esc(p.prenom):'Ta séance du jour'}</h2></div>${weekStrip()}</div>
  <div class="cols"><div class="stack" style="gap:20px">
    ${hero(s,done,{today:true})}
    ${s.type!=='repos'?`<section class="panel stack">${steps(s,TODAY,true)}<div class="row between"><span class="src">${srcTag(S.training)}</span></div></section>`:''}
   </div><div class="stack" style="gap:20px">
    <section class="panel stack"><div class="row between"><h3>Cette semaine</h3><button class="btn small" data-go="track">Ma progression</button></div>
     <div class="weekcard">${ring(Math.min(w.faites,w.prevues||w.faites),w.prevues||0)}<div class="kv"><div><b>${fmtDur(w.course+w.renfo+w.autre)}</b><span>d'effort</span></div><div><b>${nf(w.km)} km</b><span>courus</span></div><div><b>${lw?nf(lw.kg):nf(p.poids)} kg</b><span>dernière pesée</span></div></div></div></section>
    ${s.type!=='repos'&&!done?`<section class="panel stack"><h3>Ta forme du jour</h3>
     <div class="f"><span class="lab">Énergie</span><div class="seg wide" role="group" aria-label="Énergie de 1 à 5">${[1,2,3,4,5].map(n=>`<button data-en="${n}" aria-pressed="${ci.energie===n}">${n}</button>`).join('')}</div></div>
     <div class="fgrid"><div class="f"><label for="ciTemps">Temps disponible</label><select id="ciTemps"><option value="0">Comme prévu</option>${[20,30,45,60].map(m=>`<option value="${m}" ${ci.temps===m?'selected':''}>${m} min</option>`).join('')}</select></div>
      <div class="f"><span class="lab">Corps</span><span class="checks"><label><input type="checkbox" id="ciCourb" ${ci.courbatures?'checked':''}> Courbatures</label></span></div></div>
     <div class="row"><button class="btn primary" id="adaptBtn">${icon('spark',16)}Adapter ma séance</button>${S.logs.adapt?.date===TODAY?'<button class="btn small" id="resetAdapt">Revenir à la séance prévue</button>':''}</div></section>`:''}
    <section class="panel stack"><div class="row between"><h3>Au menu aujourd'hui</h3><button class="btn small" data-go="meals">Menus</button></div>
     <div class="stack" style="gap:6px"><div class="row between" style="font-size:13px"><span><b class="num" style="font-size:19px">${tot.kcal}</b> / ${t.kcal} kcal</span><span><b class="num" style="font-size:19px">${tot.prot}</b> / ${t.prot} g de protéines</span></div>
      <div class="bar" role="img" aria-label="${tot.kcal} kcal prévues sur ${t.kcal}"><i style="width:${clamp(tot.kcal/t.kcal*100,0,100)}%"></i></div></div>
     <div class="mini">${mealsOfDay(DOW).map(m=>`<div><span><small>${esc(m.moment)}</small>${esc(m.nom)}</span><span class="num">${m.kcal||'–'} kcal</span></div>`).join('')||'<p class="empty">Pas de menu pour aujourd\'hui.</p>'}</div></section>
   </div></div>`}

/* ================= view: programme ================= */
function viewWeek(){const tr=S.training,i=S.weekSel,sel=tr.days[i],date=ymd(dateOf(i)),done=sessOn(date),w=weekSeries(1)[0];
  const arch=Object.values(J.weeks).filter(a=>a&&a.weekKey&&a.weekKey<WEEK).sort((a,b)=>b.weekKey.localeCompare(a.weekKey)).slice(0,8),stats=Object.fromEntries(weekSeries(60).map(x=>[x.wk,x]));
  return `<div class="pagehead"><div><span class="label">Semaine du ${fmtD(MON,{day:'numeric',month:'long'})}${tr.semaine?' · semaine '+tr.semaine:''}</span><h2>${esc(tr.focus||'Programme de la semaine')}</h2>${srcTag(tr)}</div>
    <div class="row"><span class="chip"><b class="num">${w.faites}/${w.prevues}</b> séances</span><button class="btn primary" id="genTrain">${icon('spark',16)}${tr.source==='claude'?'Régénérer avec Claude':'Personnaliser avec Claude'}</button></div></div>
  <div class="week">${tr.days.map((d,k)=>{const dn=sessOn(ymd(dateOf(k)));return `<button class="day t-${d.type}${k===DOW?' today':''}" data-day="${k}" aria-pressed="${k===i}"><span class="dn">${DSHORT[k]}<small>${k===DOW?'Aujourd\'hui':dateOf(k).getDate()}</small></span><span class="tagwrap"><span class="tag">${TYPE_LABEL[d.type]}</span></span><span class="tt">${esc(d.titre)}</span><span class="dm">${d.duree?d.duree+' min':''}${dn?`<span class="okmark">${icon('check',13)}faite</span>`:''}</span></button>`}).join('')}</div>
  <div class="cols"><div class="stack" style="gap:20px">${hero(sel,done,{today:i===DOW,past:i<DOW,day:i,label:fmtD(dateOf(i),{weekday:'long',day:'numeric',month:'long'})})}</div>
   <div class="stack" style="gap:20px">${sel.type!=='repos'?`<section class="panel stack">${steps(sel,date,i===DOW)}</section>`:''}
   ${arch.length?`<section class="panel"><h3 style="margin-bottom:10px">Semaines précédentes</h3><div class="archive">${arch.map(a=>{const x=stats[a.weekKey];return `<details><summary><span><b>Semaine du ${fmtD(dOf(a.weekKey),{day:'numeric',month:'long'})}</b></span><span>${x?x.faites:0}/${a.prevues} séances${x&&x.km?' · '+nf(x.km)+' km':''}</span></summary><ul>${(a.days||[]).filter(d=>d.type!=='repos').map(d=>`<li>${DAYS[d.day]} : ${esc(d.titre)}${d.duree?' ('+d.duree+' min)':''}</li>`).join('')||'<li>Détail non conservé</li>'}</ul></details>`}).join('')}</div></section>`:''}</div></div>`}

/* ================= view: meals ================= */
function mealList(i){const ms=mealsOfDay(i);if(!ms.length)return '<p class="empty">Pas de menu pour ce jour.</p>';
  return `<div>${ms.map((m,k)=>`<div class="meal"><div><div class="mm">${esc(m.moment)}</div><div class="mn">${esc(m.nom)}</div></div><div class="mk"><b class="num">${m.kcal||'–'}</b>kcal · ${m.prot||'–'} g prot.</div>
   ${m.ingredients?.length?`<div class="mi">${esc(m.ingredients.join(' · '))}${m.temps?` · ${m.temps} min`:''}</div>`:''}<div style="grid-column:1/-1;padding-top:4px"><button class="btn small" data-swap="${i}:${k}">Changer ce plat</button></div></div>`).join('')}</div>`}
function viewMeals(){const m=S.meals,t=targets(P()),tot=dayTotals(S.mealDay),bought=(S.logs.shop?.[WEEK]||[]),nItems=m.courses.reduce((a,g)=>a+g.items.length,0);
  return `<div class="pagehead"><div><span class="label">Menus de la semaine</span><h2>${t.kcal} kcal et ${t.prot} g de protéines par jour</h2>${srcTag(m)}</div>
    <button class="btn primary" id="genMeals">${icon('spark',16)}${m.source==='claude'?'Nouveaux menus avec Claude':'Personnaliser avec Claude'}</button></div>
  <div class="days" role="group" aria-label="Jour">${DSHORT.map((d,i)=>`<button data-mday="${i}" aria-pressed="${i===S.mealDay}">${d} ${dateOf(i).getDate()}</button>`).join('')}</div>
  <div class="cols"><section class="panel">${mealList(S.mealDay)}</section>
   <div class="stack" style="gap:20px"><section class="panel stack"><span class="label">Total ${DAYS[S.mealDay].toLowerCase()}</span>
     <div class="kv" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><b>${tot.kcal} kcal</b><span>cible ${t.kcal}</span></div><div><b>${tot.prot} g</b><span>protéines · cible ${t.prot}</span></div></div>
     <div class="bar" role="img" aria-label="${tot.kcal} kcal sur ${t.kcal}"><i style="width:${clamp(tot.kcal/t.kcal*100,0,100)}%"></i></div>
     ${m.astuces?`<div class="tip-box">${icon('spark',16)}<p>${esc(m.astuces)}</p></div>`:''}</section></div></div>
  <section class="panel stack"><div class="row between"><h3>Liste de courses <span class="muted num" id="shopCount" style="font-size:17px">${bought.length}/${nItems}</span></h3><button class="btn small" id="copyShop">Copier la liste</button></div>
   <div class="shop">${m.courses.map((g,gi)=>`<section><span class="label">${esc(g.rayon)}</span><ul>${g.items.map((it,ii)=>`<li><label><input type="checkbox" id="s-${gi}-${ii}" data-shop="${esc(it)}" ${bought.includes(it)?'checked':''}><span>${esc(it)}</span></label></li>`).join('')}</ul></section>`).join('')}</div></section>`}

/* ================= charts ================= */
function niceTicks(lo,hi,n){if(lo===hi){lo-=1;hi+=1}const raw=(hi-lo)/n,mag=10**Math.floor(Math.log10(raw)),f=raw/mag,step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*mag;
  const a=Math.floor(lo/step+1e-9)*step,b=Math.ceil(hi/step-1e-9)*step,t=[];for(let v=a;v<=b+step/2;v+=step)t.push(+v.toFixed(6));return t}
function tipShow(el,x,rows,title){const t=el.querySelector('.tip');t.textContent='';const h=document.createElement('div');h.className='tip-h';h.textContent=title;t.appendChild(h);
  for(const r of rows){const d=document.createElement('div');d.className='tip-r';if(r.color){const k=document.createElement('i');k.style.background=r.color;d.appendChild(k)}
    const b=document.createElement('b');b.textContent=r.value;d.appendChild(b);const n=document.createElement('span');n.textContent=r.name;d.appendChild(n);t.appendChild(d)}
  t.hidden=false;const w=t.offsetWidth,W=el.clientWidth;t.style.left=clamp(x+12+w>W?x-12-w:x+12,0,Math.max(0,W-w))+'px';t.style.top='4px'}
function lineChart(el,o){const all=o.series.flatMap(s=>s.pts);
  if(all.length<2){el.innerHTML=`<p class="empty">${esc(o.empty)}</p>`;return}
  const W=Math.max(240,el.clientWidth),H=o.h||220,L=o.left||44,R=66,T=16,B=26;
  let x0=Math.min(...all.map(p=>p.t)),x1=Math.max(...all.map(p=>p.t));if(x0===x1){x0-=2592e5;x1+=2592e5}
  const ys=all.map(p=>p.y);if(o.goal!=null)ys.push(o.goal);const lo=Math.min(...ys),hi=Math.max(...ys),pad=(hi-lo)*0.1||0.5,tk=niceTicks(lo-pad,hi+pad,4);
  const y0=tk[0],y1=tk[tk.length-1],X=t=>L+(t-x0)/(x1-x0)*(W-L-R),Y=v=>T+(y1-v)/(y1-y0)*(H-T-B);
  let g=tk.map(v=>`<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tick" x="${L-8}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end">${o.fmtY(v)}</text>`).join('');
  const xl=[x0,x1];if(W>460)xl.splice(1,0,(x0+x1)/2);
  g+=xl.map((t,i)=>`<text class="tick" x="${X(t).toFixed(1)}" y="${H-6}" text-anchor="${i===0?'start':i===xl.length-1?'end':'middle'}">${fmtD(new Date(t))}</text>`).join('');
  if(o.goal!=null)g+=`<line class="goal" x1="${L}" x2="${W-R}" y1="${Y(o.goal).toFixed(1)}" y2="${Y(o.goal).toFixed(1)}"/><text class="tick" x="${L+6}" y="${(Y(o.goal)-6).toFixed(1)}">${esc(o.goalLabel)}</text>`;
  let marks='';const ends=[];
  for(const s of o.series){if(!s.pts.length)continue;const d=s.pts.map((p,i)=>(i?'L':'M')+X(p.t).toFixed(1)+' '+Y(p.y).toFixed(1)).join(' '),last=s.pts[s.pts.length-1];
    if(o.series.length===1&&s.pts.length>1)marks+=`<path d="${d} L${X(last.t).toFixed(1)} ${H-B} L${X(s.pts[0].t).toFixed(1)} ${H-B} Z" fill="${s.color}" opacity=".1"/>`;
    marks+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if(s.pts.length<=26)marks+=s.pts.slice(0,-1).map(p=>`<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('');
    marks+=`<circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    ends.push({x:X(last.t),y:Y(last.y),txt:(o.fmtEnd||o.fmtY)(last.y)})}
  const placed=[];ends.sort((a,b)=>a.y-b.y).forEach(e=>{const y=e.y+4;if(placed.some(p=>Math.abs(p-y)<13))return;placed.push(y);marks+=`<text class="endl" x="${(e.x+10).toFixed(1)}" y="${y.toFixed(1)}">${esc(e.txt)}</text>`});
  el.innerHTML=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}" tabindex="0">${g}${marks}<line class="xh" y1="${T}" y2="${H-B}" hidden/></svg><div class="tip" hidden></div>`;
  const svg=el.firstChild,xh=svg.querySelector('.xh'),xs=[...new Set(all.map(p=>p.t))].sort((a,b)=>a-b);let cur=xs.length-1;
  const show=i=>{cur=i;const t=xs[i],x=X(t);xh.setAttribute('x1',x);xh.setAttribute('x2',x);xh.removeAttribute('hidden');
    tipShow(el,x,o.series.map(s=>{const p=s.pts.find(p=>p.t===t);return p&&{color:s.color,value:(o.fmtTip||o.fmtY)(p.raw??p.y),name:s.name}}).filter(Boolean),fmtD(new Date(t),{weekday:'short',day:'numeric',month:'short',year:'numeric'}))};
  const hide=()=>{xh.setAttribute('hidden','');el.querySelector('.tip').hidden=true};
  svg.addEventListener('pointermove',e=>{const px=e.clientX-svg.getBoundingClientRect().left;let b=0,bd=1e9;xs.forEach((t,i)=>{const d=Math.abs(X(t)-px);if(d<bd){bd=d;b=i}});show(b)});
  svg.addEventListener('pointerleave',hide);svg.addEventListener('blur',hide);svg.addEventListener('focus',()=>show(cur));
  svg.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){show(Math.max(0,cur-1));e.preventDefault()}else if(e.key==='ArrowRight'){show(Math.min(xs.length-1,cur+1));e.preventDefault()}})}
function barChart(el,o){const n=o.cols.length,tot=c=>c.segs.reduce((a,s)=>a+s.v,0);
  if(!o.cols.some(c=>tot(c)>0)){el.innerHTML=`<p class="empty">${esc(o.empty)}</p>`;return}
  const W=Math.max(240,el.clientWidth),H=o.h||220,L=44,R=6,T=16,B=26,tk=niceTicks(0,Math.max(...o.cols.map(tot)),4),y1=tk[tk.length-1];
  const band=(W-L-R)/n,bw=Math.min(24,Math.max(4,band-6)),base=H-B,Y=v=>T+(y1-v)/y1*(base-T),every=Math.max(1,Math.ceil(n*54/(W-L-R)));
  let g=tk.map(v=>`<line class="grid" x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tick" x="${L-8}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end">${o.fmtY(v)}</text>`).join(''),hits='';
  o.cols.forEach((c,i)=>{const cx=L+band*i+band/2,x=cx-bw/2,segs=c.segs.filter(s=>s.v>0);let acc=0;
    segs.forEach((s,k)=>{const yB=Y(acc),top=k===segs.length-1;acc+=s.v;const yT=Y(acc)+(top?0:2),h=Math.max(1,yB-yT);
      if(top){const r=Math.min(4,h,bw/2);g+=`<path d="M${x.toFixed(1)} ${yB.toFixed(1)}V${(yT+r).toFixed(1)}Q${x.toFixed(1)} ${yT.toFixed(1)} ${(x+r).toFixed(1)} ${yT.toFixed(1)}H${(x+bw-r).toFixed(1)}Q${(x+bw).toFixed(1)} ${yT.toFixed(1)} ${(x+bw).toFixed(1)} ${(yT+r).toFixed(1)}V${yB.toFixed(1)}Z" fill="${s.color}"/>`}
      else g+=`<rect x="${x.toFixed(1)}" y="${yT.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"/>`});
    if((n-1-i)%every===0)g+=`<text class="tick" x="${cx.toFixed(1)}" y="${H-6}" text-anchor="middle">${esc(c.label)}</text>`;
    hits+=`<rect class="hit" x="${(L+band*i).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${base-T}" rx="4" tabindex="0" data-i="${i}" aria-label="${esc(c.title+' : '+c.rows.map(r=>r.value+' '+r.name).join(', '))}"/>`});
  el.innerHTML=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">${g}${hits}</svg><div class="tip" hidden></div>`;
  const hide=()=>{el.querySelector('.tip').hidden=true};
  el.querySelectorAll('.hit').forEach(h=>{const i=+h.dataset.i,c=o.cols[i],sh=()=>tipShow(el,L+band*i+band/2,c.rows,c.title);
    h.addEventListener('pointerenter',sh);h.addEventListener('focus',sh);h.addEventListener('pointerleave',hide);h.addEventListener('blur',hide)})}
const CHARTS={
  weight(el){const from=rangeStart(),ws=weights().filter(w=>w.date>=from),p=P();
    lineChart(el,{label:'Évolution du poids',empty:'Ajoute au moins deux pesées pour voir ta courbe. Idéalement le matin, à jeun, une à deux fois par semaine.',
      series:[{name:'poids',color:'var(--accent)',pts:ws.map(w=>({t:dOf(w.date).getTime(),y:w.kg}))}],fmtY:v=>nf(v),fmtEnd:v=>nf(v)+' kg',fmtTip:v=>nf(v)+' kg',
      goal:+p.poidsCible||null,goalLabel:'objectif '+nf(p.poidsCible)+' kg'})},
  volume(el){const wk=weekSeries(rangeWeeks());
    barChart(el,{label:'Minutes d\'entraînement par semaine',empty:'Tes semaines d\'entraînement apparaîtront ici dès ta première séance enregistrée.',fmtY:v=>nf(v,0),
      cols:wk.map(w=>({label:fmtD(w.mon),title:'Semaine du '+fmtD(w.mon,{day:'numeric',month:'long'}),segs:['course','renfo','autre'].map(k=>({v:w[k],color:GRP[k].c})),
        rows:[...['course','renfo','autre'].filter(k=>w[k]>0).map(k=>({color:GRP[k].c,value:fmtDur(w[k]),name:GRP[k].l.toLowerCase()})),{value:w.faites+(w.prevues!=null?'/'+w.prevues:''),name:'séances'},{value:nf(w.km)+' km',name:'courus'}]}))})},
  pace(el){const from=rangeStart(),rs=sessions().filter(s=>s.date>=from&&s.type==='course'&&s.allureSec>0);const byDay={};rs.forEach(s=>{byDay[s.date]=s});
    lineChart(el,{label:'Allure moyenne des sorties de course',empty:'Renseigne la distance de tes sorties pour suivre ton allure.',left:48,
      series:[{name:'allure moyenne',color:'var(--c1)',pts:Object.values(byDay).sort(byDate).map(s=>({t:dOf(s.date).getTime(),y:s.allureSec}))}],fmtY:v=>fmtPace(v),fmtEnd:v=>fmtPace(v)+' /km',fmtTip:v=>fmtPace(v)+' /km'})},
  measures(el){const from=rangeStart(),ms=measures().filter(m=>m.date>=from);
    const series=MEAS.map(([k,l,c])=>{const pts=ms.filter(m=>+m[k]>0);if(pts.length<2)return null;const b=+pts[0][k];return{name:l.toLowerCase(),color:c,pts:pts.map(m=>({t:dOf(m.date).getTime(),y:+(m[k]-b).toFixed(1),raw:+m[k]}))}}).filter(Boolean);
    lineChart(el,{label:'Évolution des mensurations en centimètres',empty:'Ajoute au moins deux mesures (tour de taille, hanches, poitrine) pour voir leur évolution.',series,fmtY:v=>sgn(v),fmtEnd:v=>sgn(v)+' cm',fmtTip:v=>nf(v)+' cm'})}
};
const MEAS=[['taille','Tour de taille','var(--c1)'],['hanches','Hanches','var(--c2)'],['poitrine','Poitrine','var(--c3)']];
function drawCharts(){document.querySelectorAll('[data-chart]').forEach(el=>CHARTS[el.dataset.chart]?.(el))}
let rsT;window.addEventListener('resize',()=>{clearTimeout(rsT);rsT=setTimeout(drawCharts,150)});

/* ================= view: progress ================= */
function heatmap(){const n=clamp(rangeWeeks(),12,26),first=addDays(MON,-7*(n-1));const byDay={};sessions().forEach(s=>{(byDay[s.date]=byDay[s.date]||[]).push(s)});let cells='',count=0;
  for(let w=0;w<n;w++)for(let d=0;d<7;d++){const dt=addDays(first,w*7+d),id=ymd(dt),ss=byDay[id],fut=id>TODAY;if(ss)count+=ss.length;
    const lab=fmtD(dt,{weekday:'short',day:'numeric',month:'short'})+(ss?' · '+ss.map(s=>(s.titre||TYPE_LABEL[s.type])+' ('+fmtDur(s.dureeMin)+')').join(', '):fut?'':' · pas de séance');
    cells+=`<i class="hc${ss?' g-'+grp(ss[0].type):''}${fut?' fut':''}" title="${esc(lab)}"></i>`}
  return `<div class="heat" role="img" aria-label="${count} séances sur les ${n} dernières semaines"><div class="heat-days">${DSHORT.map((d,i)=>`<span>${i%2?'':d}</span>`).join('')}</div><div class="heat-grid">${cells}</div></div>`}
const legend=(keys,line)=>`<div class="legend">${keys.map(([l,c])=>`<span><i class="${line?'ln':''}" style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>`;
function delta(v,unit,goodDown,suffix){if(v==null||Math.abs(v)<0.05)return `<small>Stable ${suffix}</small>`;const good=goodDown?v<0:v>0;return `<small class="delta ${good?'good':'bad'}"><i>${v<0?'▼':'▲'}</i> ${nf(Math.abs(v))} ${unit} ${suffix}</small>`}
function viewTrack(){const p=P(),t=targets(p),from=rangeStart(),ws=weights(),wr=ws.filter(w=>w.date>=from),ms=measures(),mr=ms.filter(m=>m.date>=from&&+m.taille>0),ss=sessions(),sr=ss.filter(s=>s.date>=from);
  const cur=ws.length?ws[ws.length-1].kg:+p.poids,wk=weekSeries(rangeWeeks()),km=sr.reduce((a,s)=>a+(grp(s.type)==='course'?+s.distanceKm||0:0),0),lastT=ms.filter(m=>+m.taille>0).slice(-1)[0];
  const pl=wk.filter(w=>w.prevues),rate=pl.length?Math.round(pl.reduce((a,w)=>a+Math.min(w.faites,w.prevues),0)/pl.reduce((a,w)=>a+w.prevues,0)*100):null;
  const sl=trendPerWeek(wr),toGo=+p.poidsCible?cur-p.poidsCible:0,per=S.range?'sur la période':'depuis le début';
  let trendTxt='Ajoute des pesées régulières pour obtenir une tendance et une date estimée.';
  if(sl!=null){trendTxt=`Tendance : ${sgn(sl,2)} kg par semaine.`;if(toGo>0.3&&sl<-0.05){const d=addDays(NOW,Math.round(toGo/-sl*7));trendTxt+=` À ce rythme, objectif atteint vers le ${fmtD(d,{day:'numeric',month:'long',year:'numeric'})}.`}
    else if(toGo>0.3)trendTxt+=' Le poids ne baisse pas pour l\'instant : vérifie tes portions et ta régularité.';if(sl<-1)trendTxt+=' C\'est rapide : au-delà de 1 kg par semaine, tu risques de perdre du muscle.'}
  const runs=ss.filter(s=>s.type==='course'&&s.distanceKm>0),longest=runs.reduce((a,s)=>Math.max(a,s.distanceKm),0),best=runs.filter(s=>s.distanceKm>=3&&s.allureSec>0).reduce((a,s)=>Math.min(a,s.allureSec),1e9);
  let streak=0;for(const w of weekSeries(52).reverse()){if(w.faites>0)streak++;else if(w.wk!==WEEK)break}
  const ts=tests(),byTest={};ts.forEach(x=>{(byTest[x.test]=byTest[x.test]||[]).push(x)});
  const rows=(S.journalAll?ss:ss.slice(-12)).slice().reverse(),allM={};ws.forEach(w=>{allM[w.date]={date:w.date,kg:w.kg}});ms.forEach(m=>{allM[m.date]={...(allM[m.date]||{date:m.date}),...m}});const mrows=Object.values(allM).sort(byDate).reverse().slice(0,10);
  return `<div class="pagehead"><div><span class="label">Suivi</span><h2>Ta progression</h2></div>
    <div class="row"><button class="btn" id="addMeasure">${icon('plus',16)}Pesée / mesure</button><button class="btn" data-addsess="${TODAY}">${icon('plus',16)}Activité</button><button class="btn" id="addTest">${icon('plus',16)}Test</button></div></div>
  <div class="row"><div class="seg" role="group" aria-label="Période">${[[4,'4 sem.'],[12,'12 sem.'],[26,'6 mois'],[0,'Tout']].map(([v,l])=>`<button data-range="${v}" aria-pressed="${S.range===v}">${l}</button>`).join('')}</div></div>
  <div class="tiles">
   <div class="tile"><span class="label">Poids</span><b>${nf(cur)} <small>kg</small></b>${wr.length>1?delta(wr[wr.length-1].kg-wr[0].kg,'kg',t.lose||toGo>0,per):'<small>Ajoute tes pesées</small>'}</div>
   <div class="tile"><span class="label">Tour de taille</span><b>${lastT?nf(lastT.taille):'–'} <small>cm</small></b>${mr.length>1?delta(mr[mr.length-1].taille-mr[0].taille,'cm',true,per):'<small>Le meilleur repère pour s\'affiner</small>'}</div>
   <div class="tile"><span class="label">Course</span><b>${nf(km)} <small>km</small></b><small>${nf(km/Math.max(1,wk.length))} km par semaine en moyenne</small></div>
   <div class="tile"><span class="label">Régularité</span><b>${rate!=null?rate+' <small>%</small>':nf(sr.length/Math.max(1,wk.length))+' <small>/ sem.</small>'}</b><small>${rate!=null?'des séances prévues réalisées':'séances par semaine'} · ${sr.length} au total</small></div></div>
  <section class="panel stack"><div class="row between"><h3>Bilan du coach</h3>${S.ai?`<button class="btn small" id="bilanBtn">${icon('spark',14)}${S.logs.bilan?'Actualiser':'Analyser ma progression'}</button>`:''}</div>
   <p class="bilan${S.logs.bilan?'':' muted'}" id="bilanTxt">${S.logs.bilan?esc(S.logs.bilan.text):S.ai?'Claude lit ton historique (séances, pesées, tests) et te dit ce qui progresse, le point à surveiller et la priorité de la semaine.':'Le bilan rédigé par Claude n\'est pas activé sur ce serveur.'}</p>
   ${S.logs.bilan?`<span class="src">Rédigé par Claude le ${fmtD(dOf(S.logs.bilan.date),{day:'numeric',month:'long'})}</span>`:''}</section>
  <div class="cols even">
   <section class="panel stack"><div><h3>Poids</h3><span class="src">en kilogrammes</span></div><div class="chart" data-chart="weight"></div><p class="muted" style="font-size:13.5px">${trendTxt}</p></section>
   <section class="panel stack"><div class="row between"><div><h3>Entraînement par semaine</h3><span class="src">en minutes</span></div>${legend(Object.values(GRP).map(g=>[g.l,g.c]))}</div><div class="chart" data-chart="volume"></div></section>
   <section class="panel stack"><div><h3>Allure en course</h3><span class="src">minutes par kilomètre · plus bas = plus rapide</span></div><div class="chart" data-chart="pace"></div></section>
   <section class="panel stack"><div class="row between"><div><h3>Mensurations</h3><span class="src">écart en cm depuis la première mesure de la période</span></div>${legend(MEAS.map(([,l,c])=>[l,c]),true)}</div><div class="chart" data-chart="measures"></div></section>
   <section class="panel stack"><div class="row between"><h3>Constance</h3>${legend(Object.values(GRP).map(g=>[g.l,g.c]))}</div>${heatmap()}
     <div class="recs"><div><b>${streak}</b><span>semaine${streak>1?'s':''} active${streak>1?'s':''} d'affilée</span></div><div><b>${ss.length}</b><span>séances enregistrées</span></div><div><b>${longest?nf(longest)+' km':'–'}</b><span>plus longue sortie</span></div><div><b>${best<1e9?fmtPace(best):'–'}</b><span>meilleure allure /km (3 km et +)</span></div></div></section>
   <section class="panel stack"><div class="row between"><h3>Tests et records</h3><button class="btn small" id="addTest2">${icon('plus',14)}Ajouter</button></div>
     ${Object.keys(byTest).length?`<div class="tablewrap"><table><thead><tr><th>Test</th><th class="n">Premier</th><th class="n">Dernier</th><th class="n">Record</th><th></th></tr></thead><tbody>${Object.entries(byTest).map(([k,a])=>{const T=TESTS[k]||{l:k},vals=a.map(x=>x.valeur),rec=T.low?Math.min(...vals):Math.max(...vals),last=a[a.length-1];
       return `<tr><td><b>${esc(T.l)}</b><br><span class="src">${a.length} essai${a.length>1?'s':''} · dernier le ${fmtD(dOf(last.date))}</span></td><td class="n">${fmtTest(k,a[0].valeur)}</td><td class="n">${fmtTest(k,last.valeur)}</td><td class="n"><b>${fmtTest(k,rec)}</b></td><td class="n"><button class="btn icon small" data-deltest="${esc(last.id)}" aria-label="Supprimer le dernier essai ${esc(T.l)}">${icon('trash',15)}</button></td></tr>`}).join('')}</tbody></table></div>`
     :'<p class="empty">Enregistre un test (5 km, pompes, gainage…) toutes les 4 à 6 semaines pour mesurer tes progrès. Un test sur 5 km met aussi à jour tes allures d\'entraînement.</p>'}</section></div>
  <section class="panel stack"><div class="row between"><h3>Journal des séances</h3>${ss.length>12?`<button class="btn small" id="journalAll">${S.journalAll?'Réduire':'Tout afficher ('+ss.length+')'}</button>`:''}</div>
   ${rows.length?`<div class="tablewrap"><table><thead><tr><th>Date</th><th>Séance</th><th class="n">Durée</th><th class="n">Distance</th><th class="n">Allure</th><th class="n">Effort</th><th>Ressenti</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td>${fmtD(dOf(s.date),{weekday:'short',day:'numeric',month:'short'})}</td><td class="wrapc t-${s.type}"><span class="tag">${TYPE_LABEL[s.type]||'Autre'}</span> ${esc(s.titre||'')}</td><td class="n">${fmtDur(s.dureeMin)}</td><td class="n">${s.distanceKm?nf(s.distanceKm,2)+' km':'–'}</td><td class="n">${s.allureSec?fmtPace(s.allureSec):'–'}</td><td class="n">${s.rpe?s.rpe+'/10':'–'}</td><td>${RES_LABEL[s.ressenti]||'–'}</td><td class="n"><button class="btn icon small" data-editsess="${esc(s.id)}" aria-label="Modifier la séance du ${fmtD(dOf(s.date))}">${icon('edit',15)}</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Aucune séance enregistrée. Termine ta séance du jour ou ajoute une activité.</p>'}</section>
  <section class="panel stack"><h3>Pesées et mesures</h3>
   ${mrows.length?`<div class="tablewrap"><table><thead><tr><th>Date</th><th class="n">Poids</th><th class="n">Taille</th><th class="n">Hanches</th><th class="n">Poitrine</th><th></th></tr></thead><tbody>${mrows.map(m=>`<tr><td>${fmtD(dOf(m.date),{day:'numeric',month:'short',year:'numeric'})}</td><td class="n">${m.kg?nf(m.kg)+' kg':'–'}</td><td class="n">${m.taille?nf(m.taille)+' cm':'–'}</td><td class="n">${m.hanches?nf(m.hanches)+' cm':'–'}</td><td class="n">${m.poitrine?nf(m.poitrine)+' cm':'–'}</td><td class="n"><button class="btn icon small" data-delm="${m.date}" aria-label="Supprimer les mesures du ${fmtD(dOf(m.date))}">${icon('trash',15)}</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Aucune mesure pour l\'instant.</p>'}</section>`}

/* ================= view: profile ================= */
function viewProfile(){const p=S.profile||{...DEMO,chrono5k:'',aime:'',deteste:''},t=S.profile?targets(S.profile):null;
  const ch=(name,val,list)=>list.map(([v,l])=>`<label><input type="checkbox" name="${name}" value="${v}" ${val.includes(v)?'checked':''}> ${l}</label>`).join('');
  const sel=(id,val,opts)=>`<select id="${id}">${opts.map(([v,l])=>`<option value="${v}" ${String(val)===String(v)?'selected':''}>${l}</option>`).join('')}</select>`;
  const n=c=>Object.keys(J[c]).length;
  return `<div class="pagehead"><div><span class="label">Profil</span><h2>${S.profile?'Tes réglages':'Créons ton programme'}</h2></div>
   ${t?`<div class="row"><span class="chip">Métabolisme de base ${t.bmr} kcal</span><span class="chip">Cible ${t.kcal} kcal / jour</span><span class="chip">${t.prot} g de protéines / jour</span></div>`:''}</div>
  <section class="panel"><form class="prof" id="profForm">
   <fieldset><legend>Toi</legend>
    <div class="f"><label for="pPrenom">Prénom</label><input type="text" id="pPrenom" value="${esc(p.prenom)}"></div>
    <div class="f"><label for="pSexe">Sexe</label>${sel('pSexe',p.sexe,[['h','Homme'],['f','Femme']])}</div>
    <div class="f"><label for="pAge">Âge</label><input type="number" id="pAge" min="14" max="90" value="${p.age}" required></div>
    <div class="f"><label for="pTaille">Taille (cm)</label><input type="number" id="pTaille" min="120" max="220" value="${p.taille}" required></div>
    <div class="f"><label for="pPoids">Poids actuel (kg)</label><input type="number" id="pPoids" step="0.1" min="30" max="250" value="${p.poids}" required></div>
    <div class="f"><label for="pCible">Poids visé (kg)</label><input type="number" id="pCible" step="0.1" min="30" max="250" value="${p.poidsCible||''}"></div>
    <div class="f"><label for="pPrincipal">Objectif prioritaire</label>${sel('pPrincipal',p.principal,[['course','Progresser en course'],['poids','Perdre du poids'],['muscle','Me muscler / m\'affiner']])}<span class="hint">Les trois sont travaillés, celui-ci pèse plus.</span></div>
    <div class="f wide"><label for="pLim">Blessures, douleurs ou limitations</label><input type="text" id="pLim" value="${esc(p.limitations)}" placeholder="ex. genou droit sensible, mal de dos"></div></fieldset>
   <fieldset><legend>Entraînement</legend>
    <div class="f"><label for="pNiveau">Niveau en course</label>${sel('pNiveau',p.niveau,[['debutant','Débutant (je cours peu)'],['intermediaire','Intermédiaire (30 min sans arrêt)'],['confirme','Confirmé (courses, 10 km et +)']])}</div>
    <div class="f"><label for="pChrono">Chrono sur 5 km (optionnel)</label><input type="text" id="pChrono" value="${esc(p.chrono5k)}" placeholder="ex. 28:30"><span class="hint">Sert à calculer tes allures.</span></div>
    <div class="f"><label for="pDuree">Durée max d'une séance</label>${sel('pDuree',p.duree,[[30,'30 min'],[45,'45 min'],[60,'1 h'],[75,'1 h 15'],[90,'1 h 30']])}</div>
    <div class="f wide"><span class="lab">Jours où je peux m'entraîner</span><div class="checks">${ch('jours',(p.jours||[]).map(String),DAYS.map((d,i)=>[String(i),d]))}</div></div>
    <div class="f wide"><span class="lab">Matériel disponible</span><div class="checks">${ch('mat',p.materiel||[],[['aucun','Poids du corps'],['halteres','Haltères'],['elastiques','Élastiques'],['traction','Barre de traction'],['salle','Salle de sport']])}</div></div></fieldset>
   <fieldset><legend>Alimentation</legend>
    <div class="f wide"><label for="pAime">Ce que j'aime manger</label><textarea id="pAime" placeholder="ex. poulet, pâtes, saumon, curry, fromage blanc, avocat…">${esc(p.aime)}</textarea></div>
    <div class="f wide"><label for="pDeteste">Ce que je n'aime pas</label><textarea id="pDeteste" placeholder="séparés par des virgules : brocolis, poisson, champignons…">${esc(p.deteste)}</textarea></div>
    <div class="f"><label for="pRegime">Régime</label>${sel('pRegime',p.regime,[['omnivore','Omnivore'],['sansporc','Sans porc'],['pescetarien','Pescétarien'],['vegetarien','Végétarien'],['vegan','Végan']])}</div>
    <div class="f"><label for="pAllerg">Allergies / intolérances</label><input type="text" id="pAllerg" value="${esc(p.allergies)}" placeholder="ex. lactose, arachide"></div>
    <div class="f"><label for="pCuisine">Temps pour cuisiner</label>${sel('pCuisine',p.cuisine,[['rapide','Rapide (moins de 20 min)'],['moyen','Moyen (30 min)'],['plaisir','J\'aime cuisiner']])}</div>
    <div class="f"><span class="lab">Collation</span><span class="checks"><label><input type="checkbox" id="pCol" ${p.collation?'checked':''}> Ajouter une collation</label></span></div></fieldset>
   <div class="row"><button class="btn primary" type="submit">${S.profile?'Enregistrer':'Créer mon programme'}</button><span class="muted" style="font-size:13px">${S.ai?'Claude préparera ensuite ta semaine sur mesure.':'Le programme intégré sera utilisé.'}</span></div>
   <p class="muted" style="font-size:12.5px">Ces conseils ne remplacent pas un avis médical. En cas de douleur, de pathologie ou de reprise après une longue pause, consulte un médecin.</p>
  </form></section>
  ${S.profile?`<section class="panel stack"><h3>Tes données</h3>
   <p class="muted" style="max-width:70ch">Ton profil et tout ton historique sont enregistrés sur le serveur, dans la base de données de l'application. Tu les retrouves sur n'importe quel appareil en te connectant à ton compte.</p>
   <div class="recs"><div><b>${n('sessions')}</b><span>séances</span></div><div><b>${n('weights')}</b><span>pesées</span></div><div><b>${n('measures')}</b><span>mesures</span></div><div><b>${n('tests')}</b><span>tests</span></div><div><b>${n('weeks')}</b><span>semaines archivées</span></div></div>
   <div class="row"><button class="btn" id="expJson">${icon('down',16)}Exporter tout (.json)</button><button class="btn" id="expCsv">${icon('down',16)}Séances (.csv)</button><button class="btn danger" id="wipeBtn">${icon('trash',16)}Effacer mes données</button></div></section>`:''}
  <section class="panel stack"><h3>Ton compte</h3><p class="muted">Connecté en tant que <b>${esc(S.user?.email||'')}</b></p>
   <div class="row"><button class="btn" id="logoutBtn">Se déconnecter</button><button class="btn danger" id="delAccount">Supprimer mon compte</button></div></section>`}

/* ================= sheets (entry forms) ================= */
const sheet=$('#sheet');
function openSheet(html,ready){sheet.innerHTML=html;try{if(!sheet.open)sheet.showModal()}catch(e){sheet.setAttribute('open','')}
  sheet.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeSheet);
  sheet.querySelectorAll('.seg[data-pick]').forEach(seg=>seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{const on=b.getAttribute('aria-pressed')==='true';seg.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));if(!on||seg.dataset.pick==='one')b.setAttribute('aria-pressed','true')}));
  ready&&ready()}
function closeSheet(){try{sheet.close()}catch(e){sheet.removeAttribute('open')}sheet.innerHTML=''}
sheet.addEventListener('click',e=>{if(e.target===sheet)closeSheet()});
const picked=id=>sheet.querySelector('#'+id+' [aria-pressed="true"]')?.dataset.v||'';
const fv=id=>sheet.querySelector('#'+id)?.value??'';
const fnum=id=>+String(fv(id)).replace(',','.')||0;
const sheetHead=t=>`<div class="row between"><h3>${t}</h3><button type="button" class="btn icon" data-close aria-label="Fermer">${icon('x',18)}</button></div>`;
const sheetErr=m=>{const e=sheet.querySelector('.form-err');e.textContent=m;e.hidden=false};
function sessionSheet(ctx){if(needProfile())return;const ex=ctx.id?J.sessions[ctx.id]:null,s=ctx.planned,manual=ex?!ex.prevue:!s,type=ex?.type||s?.type||'course',date=ex?.date||ctx.date||TODAY;
  openSheet(`<form class="sheet-in" id="sessForm">${sheetHead(ex?'Modifier la séance':manual?'Ajouter une activité':'Séance terminée')}
   ${manual?`<div class="fgrid"><div class="f"><label for="sDate">Date</label><input type="date" id="sDate" value="${date}" max="${TODAY}" required></div>
     <div class="f"><label for="sType">Type</label><select id="sType">${[['course','Course à pied'],['renfo','Renforcement'],['mobilite','Mobilité / étirements'],['autre','Autre (vélo, natation, marche…)']].map(([v,l])=>`<option value="${v}" ${type===v?'selected':''}>${l}</option>`).join('')}</select></div></div>
     <div class="f"><label for="sTitre">Intitulé</label><input type="text" id="sTitre" value="${esc(ex?.titre||'')}" placeholder="ex. Footing au parc, sortie vélo…"></div>`
    :`<p class="muted">${esc(ex?.titre||s?.titre||'')} · ${fmtD(dOf(date),{weekday:'long',day:'numeric',month:'long'})}</p>`}
   <div class="fgrid"><div class="f"><label for="sDur">Durée (min)</label><input type="number" id="sDur" min="1" max="600" required value="${ex?.dureeMin??ctx.dur??s?.duree??''}"></div>
    <div class="f" id="sKmWrap" ${['renfo','mobilite'].includes(type)?'hidden':''}><label for="sKm">Distance (km)</label><input type="number" id="sKm" min="0" max="300" step="0.01" value="${ex?.distanceKm||''}" placeholder="optionnel"></div></div>
   <div class="f"><span class="lab">Effort perçu <span class="muted" style="font-weight:400">· 1 très facile, 10 maximal</span></span><div class="seg wide" id="sRpe" data-pick="opt" role="group" aria-label="Effort perçu de 1 à 10">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button type="button" data-v="${n}" aria-pressed="${ex?.rpe===n}">${n}</button>`).join('')}</div></div>
   <div class="f"><span class="lab">Ressenti</span><div class="seg wide" id="sRes" data-pick="one" role="group" aria-label="Ressenti">${Object.entries(RES_LABEL).map(([k,l])=>`<button type="button" data-v="${k}" aria-pressed="${(ex?.ressenti||'ok')===k}">${l}</button>`).join('')}</div></div>
   <div class="f"><label for="sNote">Note</label><textarea id="sNote" placeholder="Sensations, météo, douleur éventuelle…">${esc(ex?.note||'')}</textarea></div>
   <p class="form-err" hidden></p>
   <div class="row between">${ex?`<button type="button" class="btn danger" id="sDel">${icon('trash',16)}Supprimer</button>`:'<span></span>'}<button class="btn primary" type="submit">Enregistrer</button></div></form>`,()=>{
    const tsel=sheet.querySelector('#sType');if(tsel)tsel.onchange=()=>{sheet.querySelector('#sKmWrap').hidden=['renfo','mobilite'].includes(tsel.value)};
    sheet.querySelector('#sDel')&&(sheet.querySelector('#sDel').onclick=e=>armed(e.currentTarget,()=>{store.remove('sessions',ctx.id);closeSheet();notice('Séance supprimée.');render()}));
    sheet.querySelector('#sessForm').onsubmit=e=>{e.preventDefault();const d=manual?fv('sDate'):date,ty=manual?fv('sType'):type,dur=fnum('sDur'),km=['renfo','mobilite'].includes(ty)?0:fnum('sKm');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>TODAY)return sheetErr('Choisis une date passée ou celle d\'aujourd\'hui.');if(dur<1)return sheetErr('Indique la durée de la séance en minutes.');
      const doc={date:d,weekKey:weekKeyOf(d),type:ty,titre:manual?(fv('sTitre').trim()||TYPE_LABEL[ty]):(ex?.titre||s.titre),prevue:!manual,dureeMin:Math.round(dur),distanceKm:+km.toFixed(2),
        allureSec:km>0&&ty==='course'?Math.round(dur*60/km):0,rpe:+picked('sRpe')||0,ressenti:picked('sRes')||'ok',note:fv('sNote').trim().slice(0,500),at:Date.now()};
      let id=ctx.id||(manual?d+'_'+Math.random().toString(36).slice(2,7):d);
      if(ctx.id&&manual&&!ctx.id.startsWith(d)){store.remove('sessions',ctx.id);id=d+'_'+Math.random().toString(36).slice(2,7)}
      store.put('sessions',id,doc);if(d===TODAY&&!manual&&S.logs.chrono){S.logs.chrono=null;saveLogs(true)}
      closeSheet();notice(ex?'Séance mise à jour.':'Bravo, séance enregistrée.');render()}})}
function measureSheet(){if(needProfile())return;const lw=weights().slice(-1)[0],lm=measures().slice(-1)[0]||{};
  openSheet(`<form class="sheet-in" id="mForm">${sheetHead('Pesée et mesures')}<p class="muted">Remplis ce que tu as mesuré aujourd'hui, le reste peut rester vide. Le matin à jeun, toujours dans les mêmes conditions.</p>
   <div class="fgrid"><div class="f"><label for="mDate">Date</label><input type="date" id="mDate" value="${TODAY}" max="${TODAY}" required></div>
    <div class="f"><label for="mKg">Poids (kg)</label><input type="number" id="mKg" step="0.1" min="30" max="250" placeholder="${lw?lw.kg:P().poids}"></div></div>
   <div class="fgrid"><div class="f"><label for="mTaille">Tour de taille (cm)</label><input type="number" id="mTaille" step="0.1" min="40" max="200" placeholder="${lm.taille||''}"><span class="hint">Au niveau du nombril.</span></div>
    <div class="f"><label for="mHanches">Hanches (cm)</label><input type="number" id="mHanches" step="0.1" min="40" max="200" placeholder="${lm.hanches||''}"></div>
    <div class="f"><label for="mPoitrine">Poitrine (cm)</label><input type="number" id="mPoitrine" step="0.1" min="40" max="200" placeholder="${lm.poitrine||''}"></div></div>
   <p class="form-err" hidden></p><div class="row between"><span></span><button class="btn primary" type="submit">Enregistrer</button></div></form>`,()=>{
    sheet.querySelector('#mForm').onsubmit=e=>{e.preventDefault();const d=fv('mDate'),kg=fnum('mKg'),m={taille:fnum('mTaille'),hanches:fnum('mHanches'),poitrine:fnum('mPoitrine')};
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>TODAY)return sheetErr('Choisis une date passée ou celle d\'aujourd\'hui.');if(!kg&&!m.taille&&!m.hanches&&!m.poitrine)return sheetErr('Renseigne au moins une valeur.');
      if(kg){store.put('weights',d,{date:d,kg:+kg.toFixed(1)});const last=weights().slice(-1)[0];if(last&&last.date===d&&S.profile.poids!==last.kg){S.profile.poids=last.kg;store.setDoc('profile',S.profile)}}
      if(m.taille||m.hanches||m.poitrine){const doc={...(J.measures[d]||{}),date:d};for(const k in m)if(m[k])doc[k]=+m[k].toFixed(1);store.put('measures',d,doc)}
      closeSheet();notice('Mesures enregistrées.');render()}})}
function testSheet(){if(needProfile())return;
  openSheet(`<form class="sheet-in" id="tForm">${sheetHead('Enregistrer un test')}
   <div class="fgrid"><div class="f"><label for="tDate">Date</label><input type="date" id="tDate" value="${TODAY}" max="${TODAY}" required></div>
    <div class="f"><label for="tTest">Test</label><select id="tTest">${Object.entries(TESTS).map(([k,t])=>`<option value="${k}">${t.l}</option>`).join('')}</select></div></div>
   <div class="f"><label for="tVal" id="tLab">Temps (mm:ss)</label><input type="text" id="tVal" inputmode="numeric" placeholder="ex. 28:30" required><span class="hint" id="tHint">Un test sur 5 km met à jour tes allures d'entraînement.</span></div>
   <p class="form-err" hidden></p><div class="row between"><span></span><button class="btn primary" type="submit">Enregistrer</button></div></form>`,()=>{
    const sel=sheet.querySelector('#tTest'),upd=()=>{const T=TESTS[sel.value];sheet.querySelector('#tLab').textContent=T.u==='t'?'Temps (mm:ss)':'Nombre de répétitions';sheet.querySelector('#tVal').placeholder=T.u==='t'?(sel.value==='gainage'?'ex. 1:30':'ex. 28:30'):'ex. 18';sheet.querySelector('#tHint').hidden=sel.value!=='5km'};
    sel.onchange=upd;upd();
    sheet.querySelector('#tForm').onsubmit=e=>{e.preventDefault();const d=fv('tDate'),k=sel.value,T=TESTS[k],v=T.u==='t'?parseClock(fv('tVal')):Math.round(fnum('tVal'));
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>TODAY)return sheetErr('Choisis une date passée ou celle d\'aujourd\'hui.');if(!v||v<0)return sheetErr(T.u==='t'?'Indique un temps au format minutes:secondes, par exemple 28:30.':'Indique un nombre de répétitions.');
      store.put('tests',d+'_'+k+'_'+Math.random().toString(36).slice(2,6),{date:d,test:k,valeur:v});let msg='Test enregistré.';
      if(k==='5km'){const last=tests().filter(x=>x.test==='5km').slice(-1)[0];if(last&&last.date===d){S.profile.chrono5k=fmtClock(v);store.setDoc('profile',S.profile);msg='Test enregistré. Tes allures seront recalculées dans le prochain programme.'}}
      closeSheet();notice(msg);render()}})}

/* ================= export / reset / compte ================= */
function saveFile(filename,data,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
async function exportData(kind){
  if(kind==='json'){try{await store.idle();const d=await api('GET','/api/export');saveFile(`foulee-donnees-${TODAY}.json`,JSON.stringify(d,null,2),'application/json')}catch(e){notice('Export impossible : '+(e.message||e.code),'warn')}return}
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  saveFile(`foulee-seances-${TODAY}.csv`,'﻿'+[['date','type','seance','duree_min','distance_km','allure_min_km','effort_10','ressenti','note'].join(';'),...sessions().map(s=>[s.date,s.type,q(s.titre),s.dureeMin||'',String(s.distanceKm||'').replace('.',','),s.allureSec?fmtPace(s.allureSec):'',s.rpe||'',RES_LABEL[s.ressenti]||'',q(s.note)].join(';'))].join('\n'),'text/csv')}
function clearCache(){try{Object.keys(localStorage).filter(k=>k.startsWith('foulee.')).forEach(k=>localStorage.removeItem(k))}catch(e){}pend.d={docs:{},cols:{},del:{}}}
async function wipeAll(){try{await store.idle();await api('DELETE','/api/data')}catch(e){return notice('Effacement impossible : '+(e.message||e.code),'warn')}
  const uid=S.user&&S.user.id;clearCache();if(uid)ls.set('uid',uid);for(const c of COLS)J[c]={};
  S.profile=null;S.demo=true;S.logs=newLogs();applyDocs({});S.tab='today';render();notice('Toutes tes données ont été effacées.')}
async function logout(){try{await store.idle();await api('POST','/api/auth/logout')}catch(e){}clearCache();location.reload()}
function accountSheet(){openSheet(`<form class="sheet-in" id="delForm">${sheetHead('Supprimer mon compte')}
   <p class="muted">Ton compte et toutes tes données (profil, programmes, séances, pesées, tests) seront supprimés définitivement du serveur. Pense à exporter tes données avant.</p>
   <div class="f"><label for="delPw">Confirme avec ton mot de passe</label><input type="password" id="delPw" autocomplete="current-password" required></div>
   <p class="form-err" hidden></p><div class="row between"><button type="button" class="btn" data-close>Annuler</button><button class="btn danger" type="submit">Supprimer définitivement</button></div></form>`,()=>{
    sheet.querySelector('#delForm').onsubmit=async e=>{e.preventDefault();try{await api('DELETE','/api/account',{password:fv('delPw')});clearCache();location.reload()}catch(err){sheetErr(err.message||'Suppression impossible.')}}})}

/* ================= render & events ================= */
const TABS=[['today','Aujourd\'hui'],['week','Programme'],['meals','Repas'],['track','Progrès'],['profile','Profil']];
$('#nav').innerHTML=TABS.map(([k,l])=>`<button data-tab="${k}">${icon(k,22)}<span>${l}</span></button>`).join('');
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>go(b.dataset.tab));
function go(tab){S.tab=tab;render();window.scrollTo({top:0})}
function chrome(){document.querySelectorAll('#nav button').forEach(b=>b.dataset.tab===S.tab?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  document.querySelectorAll('.js-week').forEach(e=>e.textContent=`Semaine ${weekIndex(P())} · ${fmtD(MON)} – ${fmtD(dateOf(6))}`);
  document.querySelectorAll('.js-ai').forEach(e=>e.textContent=S.ai?'Coach Claude actif':S.aiChecked?'Programme intégré':'Connexion…');
  document.querySelectorAll('.js-ai-dot').forEach(e=>e.className='dot js-ai-dot'+(S.ai?' on':''));syncUI()}
function render(){const v=$('#view');v.innerHTML={today:viewToday,week:viewWeek,meals:viewMeals,track:viewTrack,profile:viewProfile}[S.tab]();bind(v);drawCharts();chrome();renderBanner();renderToast()}
function bind(v){const on=(sel,fn)=>v.querySelectorAll(sel).forEach(x=>x.onclick=e=>fn(x,e)),one=(id,fn)=>{const x=v.querySelector(id);if(x)x.onclick=e=>fn(x,e)};
  on('[data-go]',x=>go(x.dataset.go));
  on('[data-day]',x=>{S.weekSel=+x.dataset.day;S.tab==='week'?render():go('week')});
  v.querySelectorAll('[data-bloc]').forEach(x=>x.onchange=()=>{const key=x.dataset.key,a=new Set(S.logs.checks[key]||[]);x.checked?a.add(+x.dataset.bloc):a.delete(+x.dataset.bloc);S.logs.checks[key]=[...a];
    x.closest('.bloc').classList.toggle('done',x.checked);const c=v.querySelector('#blocCount');if(c)c.textContent=a.size+'/'+v.querySelectorAll('[data-bloc]').length;if(!S.demo)saveLogs()});
  one('#chronoBtn',()=>{if(!needProfile())chronoToggle()});
  one('#finishBtn',()=>{const c=chronoState();sessionSheet({date:TODAY,planned:todaySession(),dur:c.sec>=60?Math.round(c.sec/60):undefined})});
  on('[data-editsess]',x=>sessionSheet({id:x.dataset.editsess}));
  on('[data-addsess]',x=>sessionSheet({date:x.dataset.addsess}));
  on('[data-logday]',x=>{const i=+x.dataset.logday;sessionSheet({date:ymd(dateOf(i)),planned:S.training.days[i]})});
  const ci=()=>S.logs.checkin[TODAY]||(S.logs.checkin[TODAY]=CI0());
  on('[data-en]',x=>{ci().energie=+x.dataset.en;if(!S.demo)saveLogs();render()});
  const ct=v.querySelector('#ciTemps');if(ct)ct.onchange=()=>{ci().temps=+ct.value;if(!S.demo)saveLogs()};
  const cc=v.querySelector('#ciCourb');if(cc)cc.onchange=()=>{ci().courbatures=cc.checked;if(!S.demo)saveLogs()};
  one('#adaptBtn',()=>{if(S.busy||needProfile())return;ci();adaptToday()});
  one('#resetAdapt',()=>{S.logs.adapt={};saveLogs(true);render()});
  one('#genTrain',()=>{if(S.busy||needProfile())return;S.ai?genTraining():notice(ERR.unavailable,'warn')});
  one('#genMeals',()=>{if(S.busy||needProfile())return;S.ai?genMeals():notice(ERR.unavailable,'warn')});
  on('[data-mday]',x=>{S.mealDay=+x.dataset.mday;render()});
  on('[data-swap]',x=>{if(S.busy||needProfile())return;const [d,k]=x.dataset.swap.split(':').map(Number);swapMeal(d,k)});
  v.querySelectorAll('[data-shop]').forEach(x=>x.onchange=()=>{const a=new Set(S.logs.shop?.[WEEK]||[]);x.checked?a.add(x.dataset.shop):a.delete(x.dataset.shop);S.logs.shop={[WEEK]:[...a]};
    const c=v.querySelector('#shopCount');if(c)c.textContent=a.size+'/'+v.querySelectorAll('[data-shop]').length;if(!S.demo)saveLogs()});
  one('#copyShop',async()=>{const txt=S.meals.courses.map(g=>g.rayon+'\n'+g.items.map(i=>'- '+i).join('\n')).join('\n\n');try{await navigator.clipboard.writeText(txt);notice('Liste copiée.')}catch(e){notice('Copie impossible ici : sélectionne la liste à la main.','warn')}});
  on('[data-range]',x=>{S.range=+x.dataset.range;try{localStorage.setItem('foulee.range',S.range)}catch(e){}render()});
  one('#addMeasure',measureSheet);one('#addTest',testSheet);one('#addTest2',testSheet);one('#bilanBtn',genBilan);
  one('#journalAll',()=>{S.journalAll=!S.journalAll;render()});
  on('[data-deltest]',x=>{if(needProfile())return;armed(x,()=>{store.remove('tests',x.dataset.deltest);render()})});
  on('[data-delm]',x=>{if(needProfile())return;armed(x,()=>{const d=x.dataset.delm;if(J.weights[d])store.remove('weights',d);if(J.measures[d])store.remove('measures',d);render()})});
  one('#logoutBtn',logout);one('#delAccount',accountSheet);one('#expJson',()=>exportData('json'));one('#expCsv',()=>exportData('csv'));one('#wipeBtn',x=>armed(x,wipeAll));
  const pf=v.querySelector('#profForm');if(pf)pf.onsubmit=saveProfile}
async function saveProfile(e){e.preventDefault();const f=e.target,q=id=>f.querySelector(id);if(S.busy)return;
  const jours=[...f.querySelectorAll('input[name=jours]:checked')].map(x=>+x.value);if(!jours.length)return notice('Choisis au moins un jour d\'entraînement.','warn');
  const mat=[...f.querySelectorAll('input[name=mat]:checked')].map(x=>x.value),first=!S.profile;
  const p={prenom:q('#pPrenom').value.trim(),sexe:q('#pSexe').value,age:+q('#pAge').value,taille:+q('#pTaille').value,poids:+q('#pPoids').value,poidsCible:+q('#pCible').value||0,
    principal:q('#pPrincipal').value,limitations:q('#pLim').value.trim(),niveau:q('#pNiveau').value,chrono5k:q('#pChrono').value.trim(),duree:+q('#pDuree').value,jours,materiel:mat.length?mat:['aucun'],
    aime:q('#pAime').value.trim(),deteste:q('#pDeteste').value.trim(),regime:q('#pRegime').value,allergies:q('#pAllerg').value.trim(),cuisine:q('#pCuisine').value,collation:q('#pCol').checked,debut:S.profile?.debut||WEEK};
  if(first){for(const c of COLS){J[c]={};ls.set('c.'+c,{})}S.logs=newLogs()}
  S.profile=p;S.demo=false;store.setDoc('profile',p);
  const lw=weights().slice(-1)[0];if(!lw||(lw.kg!==p.poids&&lw.date<=TODAY))store.put('weights',TODAY,{date:TODAY,kg:p.poids});
  S.training=localTraining(p);S.meals=localMeals(p);store.setDoc('training',S.training);store.setDoc('meals',S.meals);saveLogs(true);
  S.tab='today';render();notice(first?'Profil créé. Ton programme de base est prêt.':'Profil enregistré, programme recalculé.');
  if(S.ai){if(await genTraining())await genMeals()}}

/* ================= boot ================= */
function migrateLogs(lg){if(!lg)return newLogs();let changed=false;   // v1 kept results inside one document
  if(lg.done){for(const [d,v] of Object.entries(lg.done)){if(!v||!v.fait||J.sessions[d]||!/^\d{4}-\d{2}-\d{2}$/.test(d))continue;const ti=v.titre||'Séance';
      store.put('sessions',d,{date:d,weekKey:weekKeyOf(d),type:/renfo|gainage/i.test(ti)&&!/course/i.test(ti)?'renfo':/mobilit/i.test(ti)?'mobilite':'course',titre:ti,prevue:true,dureeMin:0,distanceKm:0,allureSec:0,rpe:0,ressenti:v.ressenti||'ok',note:'',at:Date.now()})}
    delete lg.done;changed=true}
  if(lg.poids){for(const x of lg.poids)if(x&&x.date&&+x.kg&&!J.weights[x.date])store.put('weights',x.date,{date:x.date,kg:+x.kg});delete lg.poids;changed=true}
  const out={...newLogs(),...lg,v:2},old=ymd(addDays(NOW,-21));
  for(const k of ['checks','checkin'])for(const d of Object.keys(out[k]||{}))if(d<old){delete out[k][d];changed=true}
  if(changed&&S.profile){ls.set('logs',out);store.setDoc('logs',out)}return out}
function applyDocs(d){if(d.profile){S.profile=d.profile;S.demo=false}
  if(S.demo){seedDemo();S.logs=newLogs()}else S.logs=migrateLogs(d.logs);
  const p=P();
  for(const [k,make] of [['training',localTraining],['meals',localMeals]]){const cur=d[k];
    if(cur&&cur.weekKey===WEEK){S[k]=cur;continue}
    if(k==='training'&&cur&&cur.weekKey&&S.profile&&!J.weeks[cur.weekKey])store.put('weeks',cur.weekKey,weekArchive(cur));
    S[k]=make(p);if(k==='training'&&cur&&S.profile)S[k].prevWeek=cur.weekKey;if(S.profile)store.setDoc(k,S[k])}}
/* ================= connexion & démarrage ================= */
const authEl=$('#auth'),appEl=$('.app');let authMode='login';
function showAuth(msg){appEl.hidden=true;authEl.hidden=false;$('#toast').hidden=true;const e=$('#authErr');e.textContent=msg||'';e.hidden=!msg;setAuthMode(authMode)}
function setAuthMode(m){authMode=m;$('#authLoginTab').setAttribute('aria-pressed',m==='login');$('#authRegTab').setAttribute('aria-pressed',m==='register');
  $('#authSubmit').textContent=m==='login'?'Se connecter':'Créer mon compte';$('#authHint').hidden=m==='login';$('#authPw').autocomplete=m==='login'?'current-password':'new-password'}
$('#authLoginTab').onclick=()=>setAuthMode('login');$('#authRegTab').onclick=()=>setAuthMode('register');
$('#authForm').onsubmit=async e=>{e.preventDefault();const btn=$('#authSubmit');btn.disabled=true;$('#authErr').hidden=true;
  try{const r=await api('POST','/api/auth/'+authMode,{email:$('#authEmail').value,password:$('#authPw').value});$('#authPw').value='';await enter(r.user)}
  catch(err){const d=err.details&&err.details[0];showAuth(d?d.message:err.message||'Connexion impossible.')}finally{btn.disabled=false}};
let signedOut=false;
function onSignedOut(){if(signedOut)return;signedOut=true;store.mode='local';showAuth('Ta session a expiré. Reconnecte-toi pour continuer : tes dernières saisies sont conservées.')}
/* utilisateur connu : on charge ses données depuis le serveur et on rejoue ce que ce navigateur n'avait pas pu envoyer */
async function enter(user){signedOut=false;if(ls.get('uid')!==user.id){clearCache();for(const c of COLS)J[c]={};S.profile=null;S.demo=true;ls.set('uid',user.id)}
  S.user=user;store.mode='db';store.warned=false;const docs=await syncDown();if(docs)applyDocs(docs);S.booted=true;authEl.hidden=true;appEl.hidden=false;render()}
async function refresh(){if(signedOut||store.inflight||S.busy||sheet.open||Date.now()-S.lastPull<120000)return;
  if(store.mode!=='db'){try{const r=await api('GET','/api/auth/me');await enter(r.user)}catch(e){}return}
  const docs=await syncDown();if(docs){applyDocs(docs);render()}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()});
window.addEventListener('online',()=>{S.lastPull=0;refresh()});
(async function boot(){
  try{const r=localStorage.getItem('foulee.range');if(r!=null&&[0,4,12,26].includes(+r))S.range=+r}catch(e){}
  const cached=ls.get('uid');
  if(cached){for(const c of COLS)J[c]=ls.get('c.'+c)||{};applyDocs({profile:ls.get('profile'),training:ls.get('training'),meals:ls.get('meals'),logs:ls.get('logs')});appEl.hidden=false;render()}   // affichage immédiat depuis le cache
  try{const r=await api('GET','/api/auth/me');await enter(r.user)}
  catch(e){if(e.code==='offline'&&cached){S.booted=true;S.aiChecked=true;render();notice('Serveur injoignable : tu vois les données de ce navigateur, tes saisies seront envoyées à la reconnexion.','warn')}
    else showAuth(e.code==='offline'?'Serveur injoignable. Vérifie ta connexion puis recharge la page.':'')}
})();
