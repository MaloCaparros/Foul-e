/* Foulée — moteur : dates, besoins nutritionnels, générateur de programme et de menus intégré */
/* ---------- dates ---------- */
const DAYS=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const DSHORT=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const mondayOf=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12);x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
const NOW=new Date(), TODAY=ymd(NOW), MON=mondayOf(NOW), WEEK=ymd(MON), DOW=(NOW.getDay()+6)%7;
const dateOf=i=>{const x=new Date(MON);x.setDate(x.getDate()+i);return x};
const fmtD=(d,o)=>d.toLocaleDateString('fr-FR',o||{day:'numeric',month:'short'});
function weekIndex(p){if(!p||!p.debut)return 1;const a=mondayOf(new Date(p.debut+'T12:00'));return Math.max(1,Math.round((MON-a)/(7*864e5))+1)}

/* ---------- utils ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const str=v=>typeof v==='string'?v.trim():(v==null?'':String(v));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const clone=o=>JSON.parse(JSON.stringify(o));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const words=s=>norm(s).split(/[,;\n]+/).map(x=>x.trim()).filter(x=>x.length>1);
function seeded(seed){let h=0;for(const c of String(seed))h=Math.imul(31,h)+c.charCodeAt(0)|0;return()=>{h=Math.imul(h^h>>>15,2246822507);h=Math.imul(h^h>>>13,3266489909);h^=h>>>16;return(h>>>0)/4294967296}}
function shuffle(arr,rnd){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r({code:'timeout'}),ms))]);

/* ---------- nutrition targets ---------- */
function targets(p){const w=+p.poids||75,h=+p.taille||175,a=+p.age||30;
  const bmr=10*w+6.25*h-5*a+(p.sexe==='f'?-161:5);
  const act=clamp(1.35+0.05*((p.jours||[]).length-3),1.3,1.6);const tdee=bmr*act;
  const lose=+p.poidsCible&&+p.poidsCible<w-0.5;
  let kcal=lose?Math.max(tdee*0.82,bmr*1.1,p.sexe==='f'?1300:1600):(p.principal==='muscle'?tdee*1.03:tdee);
  kcal=Math.round(kcal/50)*50;
  const prot=Math.round(w*(p.principal==='muscle'?2:1.8));
  const imc=w/((h/100)**2);
  const diff=lose?(w-p.poidsCible):0;
  return{bmr:Math.round(bmr),tdee:Math.round(tdee/10)*10,kcal,prot,imc,lose,semaines:lose?Math.ceil(diff/0.45):0}}

/* ---------- running paces ---------- */
function parseTime(t){const m=String(t||'').match(/^(\d{1,2})[:'h.](\d{2})$/);return m?(+m[1])*60+(+m[2]):0}
const pace=s=>Math.floor(s/60)+':'+String(Math.round(s%60)).padStart(2,'0')+'/km';
function paces(p){const t=parseTime(p.chrono5k);if(!t)return null;const k=t/5;return{ef:pace(k*1.25),sl:pace(k*1.3),seuil:pace(k*1.07),vma:pace(k*0.94)}}

/* ---------- local training generator (works offline) ---------- */
const EX={
  jambes:{aucun:['Squats','Fentes alternées','Pont fessier','Chaise contre le mur'],halteres:['Goblet squat','Fentes avec haltères','Soulevé de terre jambes tendues'],elastiques:['Squat avec élastique','Marche latérale élastique'],salle:['Presse à cuisses','Squat à la barre','Soulevé de terre roumain']},
  haut:{aucun:['Pompes (sur les genoux si besoin)','Dips sur chaise','Pompes piquées'],halteres:['Développé couché haltères au sol','Rowing haltère un bras','Développé épaules haltères'],elastiques:['Rowing élastique','Face pull élastique','Développé épaules élastique'],salle:['Tirage vertical','Développé couché','Rowing poulie basse'],traction:['Tractions (ou négatives lentes)']},
  gainage:{aucun:['Planche','Planche latérale','Dead bug','Mountain climbers','Superman']},
  coureur:{aucun:['Montées sur pointes de pieds','Fentes bulgares','Équilibre sur une jambe']}
};
function pickEx(group,mat,n,rnd){let pool=[...(EX[group].aucun||[])];for(const m of mat)if(EX[group][m])pool=EX[group][m].concat(pool);
  pool=[...new Set(pool)];const head=pool.slice(0,Math.max(n,3));return shuffle(head,rnd).slice(0,n)}
const DEB=[[8,1,1.5],[8,2,1.5],[6,3,1.5],[6,2,1],[5,4,1.5],[4,5,1.5],[3,8,2],[3,6,1.5],[2,12,2]];

function runSession(kind,p,w){const pc=paces(p),n=p.niveau||'debutant',light=w%4===0,dur=+p.duree||45;
  const f=light?0.7:1;const warm='10 min de footing très lent + 5 gammes (talons-fesses, montées de genoux, pas chassés)';
  const feel=t=>pc?t:'';
  if(n==='debutant'){const i=Math.min(w-1,DEB.length);let main;
    if(i<DEB.length){const [r,c,m]=DEB[i];const reps=kind==='sl'?r+1:r;main={nom:`${reps} × (${c} min de course / ${m===1?'1 min':m===1.5?'1 min 30':'2 min'} de marche)`,detail:'Course en aisance respiratoire : tu dois pouvoir parler en phrases complètes.'+feel(' Allure ~'+pc?.ef)}}
    else{const m=Math.round(Math.min(25+(w-DEB.length-1)*3+(kind==='sl'?8:0),dur-10)*f);main={nom:`${m} min de course continue`,detail:'Allure de conversation.'+(pc?' ~'+pc.ef:'')}}
    const blocs=[main];if(kind==='fr')blocs.push({nom:'4 × 20 s un peu plus vite',detail:'Récupération 1 min 30 en marchant. Reste relâché, pas de sprint.'});
    return{type:'course',titre:kind==='sl'?'Sortie un peu plus longue':kind==='fr'?'Course / marche + accélérations':'Course / marche',duree:Math.min(dur,kind==='sl'?dur+10:dur),intensite:'facile',
      echauffement:'5 min de marche rapide + mobilité chevilles et hanches',blocs,retour:'5 min de marche + étirements doux mollets, quadriceps, ischios',
      conseil:light?'Semaine allégée : on consolide, le corps s\'adapte pendant la récupération.':'La régularité compte plus que la vitesse. Si tu ne peux pas parler, ralentis ou marche.'}}
  const conf=n==='confirme';
  if(kind==='ef'){const m=Math.round(Math.min((conf?40:30)+3*(w-1),conf?60:50,dur-5)*f);
    return{type:'course',titre:'Endurance fondamentale',duree:m+5,intensite:'facile',echauffement:'5 min de marche active + mobilité',blocs:[{nom:`${m} min en endurance fondamentale`,detail:'Allure de conversation'+(pc?' ~'+pc.ef:'')+'. Termine par 4 lignes droites de 80 m en accélérant progressivement.'}],retour:'5 min de marche + étirements légers',conseil:'80 % de ton volume doit être à cette allure : c\'est elle qui construit l\'endurance.'}}
  if(kind==='sl'){const m=Math.round(Math.min((conf?60:45)+5*(w-1),conf?100:75)*f);
    return{type:'course',titre:'Sortie longue',duree:m,intensite:'moderee',echauffement:'Départ très lent les 10 premières minutes',blocs:[{nom:`${m} min en endurance`,detail:'Allure facile'+(pc?' ~'+pc.sl:'')+'. Prends de l\'eau au-delà d\'une heure.'}],retour:'Marche 5 min, étirements, collation protéinée dans l\'heure',conseil:'Ne regarde pas la vitesse : la durée est l\'objectif.'}}
  const odd=w%2===1;let blocs;
  if(odd){const r=Math.min((conf?8:6)+Math.floor((w-1)/2),conf?12:10);blocs=[{nom:`${light?Math.max(4,r-3):r} × 400 m`,detail:'Rapide mais contrôlé'+(pc?' ~'+pc.vma:'')+'. Récupération 1 min 30 en trottinant.'}]}
  else{const r=Math.min((conf?4:3)+Math.floor((w-1)/4),conf?6:5);blocs=[{nom:`${light?r-1:r} × ${conf?'6':'4'} min au seuil`,detail:'Allure « confortablement difficile »'+(pc?' ~'+pc.seuil:'')+'. Récupération 2 min en trottinant.'}]}
  return{type:'course',titre:odd?'Fractionné court':'Fractionné seuil',duree:Math.min(dur,55),intensite:'intense',echauffement:warm,blocs,retour:'10 min de footing lent + étirements',conseil:'La dernière répétition doit ressembler à la première. Sinon, ralentis.'}}

function renfoSession(p,w,rnd,short){const mat=p.materiel||['aucun'];const light=w%4===0;const sets=(p.principal==='muscle'?4:3)-(light?1:0);
  const reps=Math.min(10+(w-1),15),sec=Math.min(30+5*(w-1),60);
  const blocs=[...pickEx('jambes',mat,short?1:2,rnd).map(x=>({nom:x,detail:`${sets} × ${reps} répétitions · repos 60 s`})),
    ...pickEx('haut',mat,short?1:2,rnd).map(x=>({nom:x,detail:`${sets} × ${Math.max(6,reps-2)} répétitions · repos 60 s`})),
    ...pickEx('gainage',['aucun'],short?1:2,rnd).map(x=>({nom:x,detail:x==='Mountain climbers'?`${sets} × 30 s · repos 30 s`:`${sets} × ${sec} s · repos 30 s`})),
    ...(short?[]:pickEx('coureur',['aucun'],1,rnd).map(x=>({nom:x,detail:`${sets} × 12 par jambe`})))];
  if(p.principal==='poids'&&!short)blocs.push({nom:'Finisher cardio',detail:'6 min : 20 s jumping jacks / 10 s repos'});
  return{type:'renfo',titre:p.principal==='muscle'?'Renforcement complet':'Renfo & gainage du coureur',duree:short?20:Math.min(+p.duree||45,50),intensite:'moderee',
    echauffement:'5 min : rotations articulaires, 20 jumping jacks, 10 squats lents',blocs,retour:'5 min d\'étirements : fessiers, pectoraux, dos',
    conseil:'Charge ou difficulté à ajuster pour que les 2 dernières répétitions soient dures mais propres.'}}

function mobSession(){return{type:'mobilite',titre:'Mobilité & récupération',duree:20,intensite:'facile',echauffement:'Respiration profonde 1 min',
  blocs:[{nom:'Rotations de hanches',detail:'10 de chaque côté'},{nom:'Fente basse avec étirement du psoas',detail:'2 × 40 s par jambe'},{nom:'Chien tête en bas → cobra',detail:'8 enchaînements lents'},{nom:'Étirement des mollets au mur',detail:'2 × 40 s par jambe'},{nom:'Auto-massage (rouleau ou balle)',detail:'5 min mollets et cuisses'}],
  retour:'Marche tranquille 10 min si possible',conseil:'Une séance qui aide à mieux encaisser la charge des autres jours.'}}
const restDay=p=>({type:'repos',titre:'Repos',duree:0,intensite:'facile',echauffement:'',blocs:[],retour:'',conseil:p.principal==='poids'?'Repos actif : vise 8 000 pas dans la journée (marche, vélo, escaliers).':'Récupération : sommeil, hydratation et une marche légère si tu en as envie.'});

function localTraining(p){const w=weekIndex(p),rnd=seeded(WEEK+'t');const jours=[...(p.jours||[])].map(Number).sort((a,b)=>a-b);const n=jours.length;
  const pat={0:[],1:['mixte'],2:['ef','mixte'],3:['ef','renfo','sl'],4:p.principal==='muscle'?['renfo','ef','renfo','sl']:['ef','renfo','fr','sl'],
    5:['ef','renfo','fr','renfo','sl'],6:['ef','renfo','fr','mob','renfo','sl'],7:['ef','renfo','fr','mob','renfo','sl','repos']}[n];
  const days=[];for(let i=0;i<7;i++){const k=jours.indexOf(i);let s;
    if(k<0)s=restDay(p);else{const t=pat[k];
      if(t==='ef'||t==='fr'||t==='sl')s=runSession(t,p,w);else if(t==='renfo')s=renfoSession(p,w,rnd);else if(t==='mob')s=mobSession();else if(t==='repos')s=restDay(p);
      else{const r=runSession('ef',p,w),f=renfoSession(p,w,rnd,true);s={...r,type:'mixte',titre:'Course + renfo express',duree:Math.min(+p.duree||45,r.duree+20),blocs:[...r.blocs,...f.blocs],conseil:'Enchaîne le renfo juste après la course, muscles encore chauds.'}}}
    days.push({day:i,...s})}
  return{weekKey:WEEK,source:'local',semaine:w,focus:w%4===0?'Semaine allégée pour assimiler':'Construire l\'endurance, renforcer le corps',days}}

/* ---------- local meals ---------- */
const R=[
 ['pdj','Porridge avoine, banane et beurre de cacahuète',420,15,['flocons d\'avoine 60 g','lait 200 ml','1 banane','beurre de cacahuète 1 c. à s.'],'lactose arachide vege',5],
 ['pdj','Skyr, fruits rouges et granola',350,25,['skyr 200 g','fruits rouges 100 g','granola 30 g'],'lactose vege',3],
 ['pdj','Omelette 3 œufs, pain complet et tomate',430,26,['3 œufs','pain complet 2 tranches','1 tomate'],'oeuf gluten vege',8],
 ['pdj','Tartines complètes avocat et œuf',410,18,['pain complet 2 tranches','1/2 avocat','2 œufs'],'oeuf gluten vege',8],
 ['pdj','Smoothie bowl banane, épinards, soja et flocons',380,18,['1 banane','épinards 1 poignée','lait de soja 250 ml','flocons d\'avoine 40 g','graines de chia 1 c. à s.'],'vegan soja vege',5],
 ['pdj','Fromage blanc, pomme, cannelle et noix',330,20,['fromage blanc 200 g','1 pomme','cannelle','noix 15 g'],'lactose noix vege',3],
 ['pdj','Pancakes avoine-banane',400,20,['flocons d\'avoine 50 g','1 banane','2 œufs','fromage blanc 100 g'],'oeuf lactose vege',12],
 ['pdj','Tofu brouillé, épinards et pain complet',380,24,['tofu ferme 150 g','épinards 1 poignée','pain complet 2 tranches','curcuma'],'vegan soja gluten vege',10],
 ['repas','Poulet, riz basmati et brocolis',560,45,['blanc de poulet 150 g','riz basmati 70 g cru','brocolis 200 g','huile d\'olive 1 c. à c.'],'viande',20],
 ['repas','Saumon au four, patate douce et haricots verts',580,38,['pavé de saumon 130 g','patate douce 200 g','haricots verts 150 g'],'poisson',25],
 ['repas','Bowl quinoa, pois chiches, légumes rôtis et feta',540,22,['quinoa 60 g cru','pois chiches 120 g','courgette','poivron','feta 30 g'],'lactose vege',25],
 ['repas','Chili sin carne et riz',560,26,['haricots rouges 150 g','lentilles 50 g crues','tomates concassées 200 g','oignon','riz 60 g cru','épices chili'],'vegan vege',30],
 ['repas','Pâtes complètes à la bolognaise de dinde',600,40,['pâtes complètes 80 g crues','dinde hachée 130 g','sauce tomate 150 g','oignon','parmesan 10 g'],'viande gluten lactose',20],
 ['repas','Curry de lentilles corail et riz',570,24,['lentilles corail 70 g crues','lait de coco léger 100 ml','tomates concassées 150 g','épinards','riz 50 g cru','curry'],'vegan vege',25],
 ['repas','Salade niçoise',500,35,['thon au naturel 1 boîte','2 œufs','haricots verts 100 g','pommes de terre 150 g','tomates','olives'],'poisson oeuf',15],
 ['repas','Wok de bœuf, légumes et nouilles de riz',580,38,['bœuf émincé 130 g','nouilles de riz 70 g','poivron','carotte','oignon','sauce soja'],'viande soja',20],
 ['repas','Omelette aux champignons, salade et pain complet',480,28,['3 œufs','champignons 150 g','salade verte','pain complet 1 tranche'],'oeuf gluten vege',15],
 ['repas','Cabillaud et purée brocoli-pomme de terre',470,36,['dos de cabillaud 150 g','pommes de terre 200 g','brocolis 150 g','citron'],'poisson',25],
 ['repas','Buddha bowl tofu mariné, riz complet et edamame',560,32,['tofu ferme 150 g','riz complet 60 g cru','edamame 80 g','carotte','sauce soja'],'vegan soja vege',25],
 ['repas','Wrap complet poulet, crudités et sauce yaourt',520,38,['1 tortilla complète','blanc de poulet 120 g','salade, tomate, concombre','yaourt grec 50 g'],'viande gluten lactose',10],
 ['repas','Soupe de légumes et tartines de houmous',450,16,['soupe de légumes maison 400 ml','pain complet 2 tranches','houmous 50 g'],'vegan gluten vege',15],
 ['repas','Poke bowl saumon, riz, avocat et concombre',600,34,['saumon cru ou fumé 120 g','riz 70 g cru','1/2 avocat','concombre','sauce soja'],'poisson soja',15],
 ['repas','Escalope de dinde, semoule complète et ratatouille',540,42,['escalope de dinde 150 g','semoule complète 60 g crue','ratatouille 250 g'],'viande gluten',20],
 ['repas','Galette de sarrasin jambon, œuf et emmental',520,30,['1 galette de sarrasin','jambon blanc 2 tranches','1 œuf','emmental 20 g','salade verte'],'porc oeuf lactose',10],
 ['repas','Filet mignon de porc, lentilles et carottes',560,44,['filet mignon 140 g','lentilles vertes 60 g crues','carottes 150 g'],'porc',30],
 ['repas','Gratin de courgettes à la ricotta et quinoa',500,24,['courgettes 300 g','ricotta 80 g','quinoa 50 g cru','parmesan 10 g'],'lactose vege',35],
 ['repas','Crevettes ail-citron, riz et courgettes',480,34,['crevettes 150 g','riz 60 g cru','courgettes 200 g','ail','citron'],'poisson',15],
 ['repas','Steak haché 5 %, pommes de terre au four et salade',590,40,['steak haché 5 % 1 pièce','pommes de terre 250 g','salade verte'],'viande',30],
 ['repas','Shakshuka et pain complet',470,24,['3 œufs','tomates concassées 250 g','poivron','oignon','pain complet 1 tranche'],'oeuf gluten vege',20],
 ['col','Pomme et 20 amandes',210,5,['1 pomme','amandes 20 g'],'noix vegan vege',1],
 ['col','Yaourt grec et miel',180,15,['yaourt grec 150 g','miel 1 c. à c.'],'lactose vege',1],
 ['col','Skyr nature et un fruit',160,17,['skyr 150 g','1 fruit de saison'],'lactose vege',1],
 ['col','Houmous et bâtonnets de carotte',180,6,['houmous 50 g','2 carottes'],'vegan vege',3],
 ['col','2 œufs durs et tomates cerises',170,13,['2 œufs','tomates cerises'],'oeuf vege',10],
 ['col','Lait de soja et flocons d\'avoine',230,12,['lait de soja 250 ml','flocons d\'avoine 30 g'],'vegan soja vege',1],
 ['col','Fromage blanc et compote sans sucre ajouté',150,13,['fromage blanc 150 g','1 compote'],'lactose vege',1]
].map(([m,nom,kcal,prot,ing,tags,temps])=>({m,nom,kcal,prot,ing,tags:tags.split(' '),temps}));

function allowedRecipes(p){const dis=words(p.deteste),al=norm(p.allergies),like=words(p.aime);
  const ALG={lactose:['lactose','lait'],gluten:['gluten','ble'],arachide:['arachide','cacahuete'],noix:['noix','fruits a coque','amande'],oeuf:['oeuf'],soja:['soja'],poisson:['poisson','crustace','fruits de mer','crevette']};
  const banned=Object.keys(ALG).filter(k=>ALG[k].some(x=>al.includes(x)));
  return R.filter(r=>{const t=r.tags,reg=p.regime;
    if(reg==='vegetarien'&&(t.includes('viande')||t.includes('porc')||t.includes('poisson')))return false;
    if(reg==='pescetarien'&&(t.includes('viande')||t.includes('porc')))return false;
    if(reg==='vegan'&&!t.includes('vegan'))return false;
    if(reg==='sansporc'&&t.includes('porc'))return false;
    if(banned.some(b=>t.includes(b)))return false;
    const txt=norm(r.nom+' '+r.ing.join(' '));if(dis.some(d=>txt.includes(d)))return false;
    if(p.cuisine==='rapide'&&r.temps>25)return false;return true})
   .map(r=>({...r,score:words(p.aime).filter(l=>norm(r.nom+' '+r.ing.join(' ')).includes(l)).length}))}
function rotate(pool,n,rnd){if(!pool.length)return[];const liked=pool.filter(r=>r.score>0),rest=pool.filter(r=>!r.score);
  let list=[...shuffle(liked,rnd),...shuffle(liked,rnd),...shuffle(rest,rnd)];const out=[];let i=0;while(out.length<n){out.push(list[i%list.length]);i++}return shuffle(out,rnd)}
const toMeal=(r,moment)=>({moment,nom:r.nom,ingredients:r.ing,kcal:r.kcal,prot:r.prot,temps:r.temps});
const RAYONS=[['Fruits & légumes',['banane','pomme','fruit','tomate','avocat','epinard','brocoli','courgette','poivron','oignon','carotte','haricots verts','salade','concombre','champignon','citron','ail','patate','pommes de terre','ratatouille','legume']],
 ['Viandes, poissons & œufs',['poulet','dinde','boeuf','steak','porc','filet','jambon','saumon','cabillaud','thon','crevette','oeuf']],
 ['Crèmerie',['lait','skyr','fromage','yaourt','feta','ricotta','parmesan','emmental']],
 ['Féculents & légumineuses',['riz','pates','quinoa','semoule','pain','tortilla','galette','nouilles','flocons','lentilles','pois chiches','haricots rouges','edamame','granola']],
 ['Épicerie',['']]];
function shoppingFrom(meals){const map=new Map();for(const d of meals)for(const m of d.repas)for(const i of m.ingredients){const k=i.replace(/\s+\d.*$/,'').replace(/^\d+(\/\d+)?\s+/,'').trim();const key=norm(k);if(!map.has(key))map.set(key,{n:k,c:0});map.get(key).c++}
  const groups=RAYONS.map(([r])=>({rayon:r,items:[]}));
  for(const [key,v] of map){const gi=RAYONS.findIndex(([,kw])=>kw.some(w=>w===''||key.includes(w)));groups[gi].items.push(v.n+(v.c>1?` (×${v.c})`:''))}
  return groups.filter(g=>g.items.length).map(g=>({...g,items:g.items.sort((a,b)=>a.localeCompare(b,'fr'))}))}
function localMeals(p){const rnd=seeded(WEEK+'m'),pool=allowedRecipes(p);const pdj=rotate(pool.filter(r=>r.m==='pdj'),7,rnd),rep=rotate(pool.filter(r=>r.m==='repas'),14,rnd),col=rotate(pool.filter(r=>r.m==='col'),7,rnd);
  const jours=[];for(let i=0;i<7;i++){const repas=[];if(pdj[i])repas.push(toMeal(pdj[i],'Petit-déjeuner'));if(rep[2*i])repas.push(toMeal(rep[2*i],'Déjeuner'));if(col[i]&&p.collation)repas.push(toMeal(col[i],'Collation'));if(rep[2*i+1])repas.push(toMeal(rep[2*i+1],'Dîner'));jours.push({day:i,repas})}
  const t=targets(p);return{weekKey:WEEK,source:'local',cibles:{kcal:t.kcal,prot:t.prot},jours,courses:shoppingFrom(jours),astuces:'Ajuste les portions de féculents pour approcher ta cible : +/− 20 g de riz ou pâtes crus ≈ 70 kcal.'}}

function adaptLocal(s,ci){const c=clone(s);const notes=[];
  if(c.type==='repos')return c;
  if(ci.energie<=2||ci.courbatures){c.intensite='facile';c.titre+=' · version allégée';const keep=Math.max(1,Math.ceil(c.blocs.length*0.6));c.blocs=c.blocs.slice(0,keep).map(b=>({...b,detail:b.detail+' — réduis le volume d\'un tiers, aucune intensité.'}));
    if(c.type==='course')c.blocs=[{nom:`${Math.max(20,Math.round((c.duree||40)*0.6))} min de footing très facile`,detail:'Ou course/marche si les jambes sont lourdes. Objectif : faire circuler, pas performer.'}];
    notes.push(ci.courbatures?'Courbatures : on garde le mouvement mais sans charge.':'Énergie basse : séance raccourcie, l\'essentiel est d\'y aller.')}
  if(ci.temps&&c.duree>ci.temps){const r=ci.temps/c.duree;c.duree=ci.temps;c.blocs=c.blocs.slice(0,Math.max(1,Math.round(c.blocs.length*r)));notes.push(`Adaptée à ${ci.temps} min : échauffement raccourci à 5 min, on garde le cœur de séance.`);c.echauffement='5 min progressifs'}
  if(ci.energie>=5&&!ci.courbatures)notes.push('Grosse forme : tu peux ajouter une série au renfo ou 5 min de course facile, sans forcer.');
  c.conseil=(notes.join(' ')+' '+(c.conseil||'')).trim();c.adaptee=true;return c}
