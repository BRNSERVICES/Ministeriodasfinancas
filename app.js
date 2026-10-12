(function(){
'use strict';

/* ---------- utilidades ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const money=n=>brl.format(n);
const uid=()=>(window.crypto&&crypto.randomUUID)?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>ymd(new Date());
const ym=s=>s.slice(0,7);
const parseYmd=s=>{const p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2]);};
function addMonths(s,n){const p=s.split('-').map(Number);const t=new Date(p[0],p[1]-1+n,1);const last=new Date(t.getFullYear(),t.getMonth()+1,0).getDate();t.setDate(Math.min(p[2],last));return ymd(t);}
const shiftMonth=(m,n)=>addMonths(m+'-01',n).slice(0,7);
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const monthLabel=m=>cap(parseYmd(m+'-01').toLocaleDateString('pt-BR',{month:'long',year:'numeric'}));
const safeColor=c=>/^#[0-9a-f]{6}$/i.test(c)?c:'#8A8F94';
const fmtInput=n=>(Math.round(n*100)/100).toFixed(2).replace('.',',');
function parseMoney(s){
  s=String(s==null?'':s).replace(/R\$|\s/g,'');
  if(!s) return NaN;
  if(s.indexOf(',')>=0) s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
  const n=parseFloat(s);
  return isFinite(n)?Math.round(Math.abs(n)*100)/100:NaN;
}

/* ---------- estado e armazenamento ---------- */
const KEY='mf:v1',OLD_KEY='tostao:v1';
const DEF=[
  ['c-moradia','Moradia','out','#3F6C8C'],['c-mercado','Mercado','out','#5E9C76'],
  ['c-transporte','Transporte','out','#C58B2B'],['c-restaurantes','Restaurantes','out','#C0584A'],
  ['c-saude','Saúde','out','#8A5FA8'],['c-lazer','Lazer','out','#D27A9E'],
  ['c-educacao','Educação','out','#4A8F9E'],['c-assinaturas','Assinaturas','out','#7E7F9A'],
  ['c-outros','Outros','out','#8A8F94'],
  ['c-salario','Salário','in','#12795A'],['c-freelance','Freelance','in','#3E9B8A'],
  ['c-rendimentos','Rendimentos','in','#6BA368'],['c-outras','Outras receitas','in','#8A9A5B']
];
function newProfileData(){
  return {
    accounts:[{id:uid(),name:'Carteira',kind:'dinheiro',initial:0}],
    categories:DEF.map(c=>({id:c[0],name:c[1],type:c[2],color:c[3]})),
    tx:[],budgets:{},goals:[],rules:[]
  };
}
function freshState(){
  const id=uid();
  return {v:1,active:id,theme:'auto',profiles:[{id:id,name:'Pessoal'}],data:{[id]:newProfileData()}};
}
function validState(o){
  if(!o||!Array.isArray(o.profiles)||!o.profiles.length||!o.data||typeof o.data!=='object') return false;
  if(!o.data[o.active]) return false;
  return o.profiles.every(p=>{const d=o.data[p.id];return d&&Array.isArray(d.accounts)&&Array.isArray(d.categories)&&Array.isArray(d.tx)&&d.budgets&&typeof d.budgets==='object';});
}
let memState=null;
function load(){
  try{
    const r=localStorage.getItem(KEY)||localStorage.getItem(OLD_KEY);
    if(r){const o=JSON.parse(r);if(validState(o)) return o;}
  }catch(e){}
  return memState;
}
function normalize(s){
  s.profiles.forEach(function(p){
    const d=s.data[p.id];
    d.goals=d.goals||[];d.rules=d.rules||[];
    d.accounts.forEach(function(a){
      if(a.closing===undefined) a.closing=null;
      if(a.due===undefined) a.due=null;
      if(a.payAcc===undefined) a.payAcc=null;
    });
  });
  return s;
}
const CFG=window.MF_CONFIG||null;
const CLOUD=!!(CFG&&CFG.url&&CFG.key);
const UIKEY='mf:ui';
let sb=null;
if(CLOUD){
  try{sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});}
  catch(e){sb=null;}
}
let USER=null;
let S=CLOUD?{v:1,active:'',theme:'auto',profiles:[],data:{}}:normalize(load()||freshState());
function save(){
  if(CLOUD){
    try{localStorage.setItem(UIKEY,JSON.stringify({active:S.active,theme:S.theme}));}catch(e){}
    scheduleFlush();
    return;
  }
  try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){memState=S;}
}
const P=()=>S.data[S.active];
const cat=id=>P().categories.find(c=>c.id===id)||{id:'',name:'Sem categoria',color:'#8A8F94',type:'out'};
const acc=id=>P().accounts.find(a=>a.id===id)||{id:'',name:'Conta removida',kind:'conta',initial:0};
const V={view:'painel',month:ym(today()),filter:'todos',q:'',accf:'',animate:true};
const KIND={conta:'Conta corrente',dinheiro:'Dinheiro',cartao:'Cartão de crédito',poupanca:'Poupança'};

/* ---------- cartão de crédito ---------- */
function invMonth(date,closing){
  const d=parseYmd(date);
  return d.getDate()>(closing||31)?shiftMonth(ym(date),1):ym(date);
}
function dueDate(m,a){
  if(!a.due) return null;
  if(!a.closing||a.due>a.closing) return m+'-'+pad(a.due);
  return shiftMonth(m,1)+'-'+pad(a.due);
}
function cardInvoices(a){
  const map={};
  const slot=m=>(map[m]=map[m]||{m:m,total:0,paid:0,items:0});
  for(const t of P().tx){
    if(t.acc===a.id&&(t.type==='out'||t.type==='in')){
      const i=slot(invMonth(t.date,a.closing));
      i.total+=t.type==='out'?t.amount:-t.amount;i.items++;
    }
    if(t.type==='tr'&&t.acc2===a.id&&t.invoice&&t.paid) slot(t.invoice).paid+=t.amount;
  }
  return Object.values(map).map(function(i){
    i.total=Math.round(i.total*100)/100;
    i.open=Math.round((i.total-i.paid)*100)/100;
    i.due=dueDate(i.m,a);
    return i;
  }).sort((x,y)=>y.m.localeCompare(x.m));
}

/* ---------- recorrências ---------- */
const FREQ={weekly:'toda semana',monthly:'todo mês',yearly:'todo ano'};
function addDays(s,n){const d=parseYmd(s);d.setDate(d.getDate()+n);return ymd(d);}
function ruleDate(r,n){
  return r.freq==='weekly'?addDays(r.start,n*7):addMonths(r.start,r.freq==='yearly'?12*n:n);
}
function generateRules(until){
  let changed=false;
  P().rules.forEach(function(r){
    if(!r.active) return;
    let guard=0;
    for(;;){
      const d=ruleDate(r,r.count);
      if(d>until||(r.end&&d>r.end)||++guard>500) break;
      P().tx.push({id:uid(),type:r.type,desc:r.desc,amount:r.amount,date:d,cat:r.cat,acc:r.acc,acc2:'',paid:false,group:null,rule:r.id});
      r.count++;changed=true;
    }
  });
  if(changed) save();
}

/* ---------- cálculos ---------- */
const monthTx=m=>P().tx.filter(t=>ym(t.date)===m);
function totals(m){
  let i=0,o=0,ip=0,op=0;
  for(const t of monthTx(m)){
    if(t.type==='in'){i+=t.amount;if(t.paid)ip+=t.amount;}
    else if(t.type==='out'){o+=t.amount;if(t.paid)op+=t.amount;}
  }
  return {i:i,o:o,ip:ip,op:op};
}
function spendByCat(m){
  const r={};
  for(const t of monthTx(m)) if(t.type==='out') r[t.cat]=(r[t.cat]||0)+t.amount;
  return r;
}
function accBalance(a){
  let b=a.initial||0;
  for(const t of P().tx){
    if(!t.paid) continue;
    if(t.type==='in'&&t.acc===a.id) b+=t.amount;
    else if(t.type==='out'&&t.acc===a.id) b-=t.amount;
    else if(t.type==='tr'){if(t.acc===a.id) b-=t.amount;if(t.acc2===a.id) b+=t.amount;}
  }
  return Math.round(b*100)/100;
}
function insights(m,T,PT){
  const out=[];
  if(PT.o>0&&T.o>0){
    const d=(T.o-PT.o)/PT.o*100;
    out.push('Suas despesas '+(d>=0?'subiram':'caíram')+' '+Math.abs(Math.round(d))+'% em relação ao mês anterior ('+money(PT.o)+').');
  }
  const sc=spendByCat(m);
  const top=Object.entries(sc).sort((a,b)=>b[1]-a[1])[0];
  if(top&&T.o>0) out.push(cat(top[0]).name+' é a maior despesa do mês: '+money(top[1])+', '+Math.round(top[1]/T.o*100)+'% do total.');
  const ex=P().categories.filter(c=>c.type==='out'&&P().budgets[c.id]>0&&(sc[c.id]||0)>P().budgets[c.id]);
  if(ex.length) out.push('Orçamento estourado em '+ex.map(c=>c.name).join(', ')+'.');
  const pend=monthTx(m).filter(t=>!t.paid&&t.type!=='tr').length;
  if(pend) out.push(pend+(pend>1?' lançamentos ainda esperam':' lançamento ainda espera')+' efetivação.');
  P().accounts.filter(a=>a.kind==='cartao').forEach(function(a){
    const inv=cardInvoices(a).filter(i=>i.open>0.005&&i.due).sort((x,y)=>x.due.localeCompare(y.due))[0];
    if(!inv) return;
    const days=Math.round((parseYmd(inv.due)-parseYmd(today()))/864e5);
    if(days<=10) out.push('A fatura do '+a.name+' ('+money(inv.open)+') '+(days<0?'venceu em ':'vence em ')+inv.due.split('-').reverse().join('/')+'.');
  });
  return out;
}

/* ---------- ícones e navegação ---------- */
const IC={
  painel:'<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
  lanc:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  contas:'<path d="M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h2"/>',
  orc:'<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
  rel:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ajustes:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'
};
const icon=n=>'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+IC[n]+'</svg>';
const NAV=[['painel','Painel'],['lanc','Lançamentos'],['contas','Contas'],['orc','Planejar'],['rel','Relatórios'],['ajustes','Ajustes']];

/* ---------- componentes ---------- */
function row(t){
  const c=cat(t.cat);
  const sign=t.type==='in'?'+ ':t.type==='out'?'− ':'';
  let bits;
  if(t.type==='tr') bits='<span>'+esc(acc(t.acc).name)+' para '+esc(acc(t.acc2).name)+'</span>';
  else bits='<span><i class="dot" style="background:'+safeColor(c.color)+'"></i>'+esc(c.name)+'</span><span>'+esc(acc(t.acc).name)+'</span>';
  if(t.rule) bits+='<span>recorrente</span>';
  if(!t.paid) bits+=(t.date<today()?'<span class="late">atrasado</span>':'<span>pendente</span>');
  return '<li class="row"><button class="chk'+(t.paid?' on':'')+'" data-act="toggle" data-id="'+esc(t.id)+'" aria-pressed="'+(t.paid?'true':'false')+'" aria-label="'+(t.paid?'Marcar como pendente':'Marcar como efetivado')+': '+esc(t.desc)+'"></button>'
    +'<button class="rowmain" data-act="edit" data-id="'+esc(t.id)+'"><span class="rdesc">'+esc(t.desc)+'</span><span class="rmeta">'+bits+'</span></button>'
    +'<span class="amt '+t.type+'">'+sign+money(t.amount)+'</span></li>';
}
function emptyBox(){
  return '<div class="panel empty-box"><h2>Comece pelo primeiro lançamento</h2><p class="note">Registre uma despesa ou receita, ou digite uma frase na barra acima.</p>'
    +'<div class="row-btn"><button class="btn primary" data-act="new-tx">Novo lançamento</button>'+(CLOUD?'':'<button class="btn" data-act="sample">Carregar dados de exemplo</button>')+'</div></div>';
}

/* ---------- telas ---------- */
const VIEWS={};

VIEWS.painel=function(){
  const m=V.month,T=totals(m),PT=totals(shiftMonth(m,-1));
  if(!P().tx.length) return emptyBox();
  const saldo=T.i-T.o,real=T.ip-T.op;
  const over=T.o>T.i;
  const pct=T.i>0?Math.min(100,T.o/T.i*100):(T.o>0?100:0);
  const now=m===ym(today());
  let mark='';
  if(now){const d=new Date();const dim=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();mark='<span class="mark" style="left:calc('+(d.getDate()/dim*100).toFixed(1)+'% - 1px)" title="Hoje"></span>';}
  let cap1;
  if(!T.i&&!T.o) cap1='Nenhum lançamento neste mês.';
  else if(over) cap1='As despesas passam das receitas em '+money(T.o-T.i)+'.';
  else cap1='Você usou '+Math.round(pct)+'% do que recebe neste mês.'+(now?' A marca indica o dia de hoje.':'');
  const anim=V.animate;V.animate=false;
  const ins=insights(m,T,PT);
  const pend=monthTx(m).filter(t=>!t.paid).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6);
  const sc=spendByCat(m);
  const topc=Object.entries(sc).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxc=topc.length?topc[0][1]:1;
  return '<section class="hero" aria-label="Resumo do mês"><h2>Saldo previsto do mês</h2>'
    +'<p class="big'+(saldo<0?' neg':'')+'">'+money(saldo)+'</p>'
    +'<div class="bandwrap" role="img" aria-label="'+esc(cap1)+'"><div class="band"><div class="fill'+(over?' over':'')+(anim?' anim':'')+'" style="--w:'+pct.toFixed(1)+'%"></div></div>'+mark+'</div>'
    +'<p class="bandcap">'+esc(cap1)+'</p>'
    +'<div class="stats">'
    +'<div class="stat"><span>Receitas</span><b class="pos">'+money(T.i)+'</b><small>recebido '+money(T.ip)+'</small></div>'
    +'<div class="stat"><span>Despesas</span><b class="negc">'+money(T.o)+'</b><small>pago '+money(T.op)+'</small></div>'
    +'<div class="stat"><span>Realizado até agora</span><b class="'+(real<0?'negc':'pos')+'">'+money(real)+'</b><small>só o que foi efetivado</small></div>'
    +'</div></section>'
    +(ins.length?'<section class="panel"><h2>Resumo do mês</h2><ul class="insights">'+ins.map(i=>'<li>'+esc(i)+'</li>').join('')+'</ul></section>':'')
    +'<div class="grid2">'
    +'<section class="panel"><h2>Falta efetivar</h2>'+(pend.length?'<ul class="list">'+pend.map(row).join('')+'</ul>':'<p class="empty">Tudo o que estava previsto neste mês já foi efetivado.</p>')+'</section>'
    +'<section class="panel"><h2>Para onde foi o dinheiro</h2>'+(topc.length?topc.map(function(e){const c=cat(e[0]);return '<div class="catbar"><span class="nm"><i class="dot" style="background:'+safeColor(c.color)+'"></i>'+esc(c.name)+'</span><span class="num">'+money(e[1])+'</span><div class="bar"><i style="width:'+(e[1]/maxc*100).toFixed(1)+'%;background:'+safeColor(c.color)+'"></i></div></div>';}).join(''):'<p class="empty">Sem despesas neste mês.</p>')+'</section>'
    +'</div>';
};

function filtered(){
  const q=V.q.trim().toLowerCase();
  return monthTx(V.month).filter(function(t){
    if(V.filter==='in'&&t.type!=='in') return false;
    if(V.filter==='out'&&t.type!=='out') return false;
    if(V.filter==='tr'&&t.type!=='tr') return false;
    if(V.filter==='pend'&&t.paid) return false;
    if(V.accf&&t.acc!==V.accf&&t.acc2!==V.accf) return false;
    if(q&&!(t.desc.toLowerCase().indexOf(q)>=0||cat(t.cat).name.toLowerCase().indexOf(q)>=0)) return false;
    return true;
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
function listHtml(){
  const L=filtered();
  if(!L.length) return '<p class="empty">Nenhum lançamento com esses filtros.</p>';
  let html='',cur='',i=0,o=0;
  for(const t of L){
    if(t.date!==cur){
      if(cur) html+='</ul>';
      cur=t.date;
      html+='<div class="dayh">'+esc(parseYmd(t.date).toLocaleDateString('pt-BR',{weekday:'short',day:'numeric',month:'short'}))+'</div><ul class="list">';
    }
    html+=row(t);
    if(t.type==='in') i+=t.amount; else if(t.type==='out') o+=t.amount;
  }
  html+='</ul><div class="sumline"><span>Receitas <b class="pos">'+money(i)+'</b></span><span>Despesas <b class="negc">'+money(o)+'</b></span></div>';
  return html;
}
VIEWS.lanc=function(){
  const F=[['todos','Todos'],['in','Receitas'],['out','Despesas'],['tr','Transferências'],['pend','Pendentes']];
  return '<section class="panel"><div class="chips" role="group" aria-label="Filtrar por tipo">'
    +F.map(f=>'<button data-act="filter" data-id="'+f[0]+'" aria-pressed="'+(V.filter===f[0])+'">'+f[1]+'</button>').join('')+'</div>'
    +'<div class="filters"><input type="text" data-q placeholder="Buscar por descrição ou categoria" value="'+esc(V.q)+'" aria-label="Buscar"><select data-accf aria-label="Filtrar por conta"><option value="">Todas as contas</option>'
    +P().accounts.map(a=>'<option value="'+esc(a.id)+'"'+(V.accf===a.id?' selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select></div>'
    +'<div id="list">'+(P().tx.length?listHtml():'<p class="empty">Nenhum lançamento ainda. Use o botão Novo lançamento ou a barra de lançamento rápido.</p>')+'</div></section>'+rulesHtml();
};

function accountPanel(){
  if(!CLOUD||!USER) return '';
  return '<section class="panel"><h2>Conta</h2><p class="note">Você entrou como <strong>'+esc(USER.email||'')+'</strong>. Seus dados aparecem em qualquer aparelho em que você entrar.</p><button class="btn" data-act="signout">Sair</button></section>';
}

function rulesHtml(){
  const R=P().rules;
  return '<section class="panel"><h2>Lançamentos recorrentes</h2><p class="note">Cadastre aluguel, salário e assinaturas uma vez. Os lançamentos dos próximos meses são criados sozinhos.</p>'
    +(R.length?'<ul class="list">'+R.map(function(r){
      return '<li class="row" style="grid-template-columns:minmax(0,1fr) auto"><button class="rowmain" data-act="rule-edit" data-id="'+esc(r.id)+'"><span class="rdesc">'+esc(r.desc)+(r.active?'':' (pausada)')+'</span><span class="rmeta"><span>'+FREQ[r.freq]+', desde '+esc(r.start.split('-').reverse().join('/'))+(r.end?' até '+esc(r.end.split('-').reverse().join('/')):'')+'</span><span>'+esc(acc(r.acc).name)+'</span></span></button><span class="amt '+r.type+'">'+(r.type==='in'?'+ ':'− ')+money(r.amount)+'</span></li>';
    }).join('')+'</ul>':'<p class="empty">Nenhuma recorrência cadastrada.</p>')
    +'<div style="margin-top:14px"><button class="btn primary" data-act="rule-add">Nova recorrência</button></div></section>';
}

VIEWS.contas=function(){
  const A=P().accounts;
  const total=A.reduce((s,a)=>s+accBalance(a),0);
  return '<section class="hero"><h2>Saldo total</h2><p class="big'+(total<0?' neg':'')+'" style="margin:0">'+money(total)+'</p><p class="bandcap" style="margin:10px 0 0">Considera apenas lançamentos efetivados. O saldo de um cartão negativo é o que você deve nele.</p></section>'
    +'<section class="panel"><h2>Contas e cartões</h2>'
    +A.map(function(a){
      const b=accBalance(a);
      let inv='';
      if(a.kind==='cartao'){
        const L=cardInvoices(a).slice(0,4);
        inv='<div class="invs"><small class="invinfo">'+(a.closing?'Fecha dia '+a.closing+(a.due?' e vence dia '+a.due:'')+'.':'Defina o dia de fechamento em Editar para separar as faturas.')+'</small>'
          +L.map(function(i){
            return '<div class="invrow"><span>Fatura de '+esc(monthLabel(i.m).toLowerCase())+(i.due?'<small> vence '+esc(i.due.split('-').reverse().join('/'))+'</small>':'')+'</span>'
              +'<span class="num">'+money(i.total)+(i.paid?'<small> pago '+money(i.paid)+'</small>':'')+'</span>'
              +(i.open>0.005?'<button class="btn small" data-act="pay-invoice" data-id="'+esc(a.id)+'" data-m="'+esc(i.m)+'">Pagar</button>':'<span class="pos">quitada</span>')+'</div>';
          }).join('')+'</div>';
      }
      return '<div class="acwrap"><div class="acard"><div><strong>'+esc(a.name)+'</strong><small>'+esc(KIND[a.kind]||'Conta')+'</small></div><div style="display:flex;align-items:center;gap:12px"><span class="abal '+(b<0?'negc':'')+'">'+money(b)+'</span><button class="btn small" data-act="edit-account" data-id="'+esc(a.id)+'">Editar</button></div></div>'+inv+'</div>';
    }).join('')
    +'<div style="margin-top:14px"><button class="btn primary" data-act="add-account">Nova conta</button></div></section>';
};

function budgetsHtml(){
  const sc=spendByCat(V.month);
  const cats=P().categories.filter(c=>c.type==='out');
  return '<section class="panel"><h2>Orçamento de '+esc(monthLabel(V.month))+'</h2><p class="note">Defina um limite mensal por categoria. O mesmo limite vale para todos os meses.</p><ul class="list">'
    +cats.map(function(c){
      const lim=P().budgets[c.id]||0,sp=sc[c.id]||0,col=safeColor(c.color);
      const pct=lim>0?Math.min(100,sp/lim*100):0,over=lim>0&&sp>lim;
      return '<li class="brow"><div class="bhead"><span class="nm"><i class="dot" style="background:'+col+'"></i><strong>'+esc(c.name)+'</strong><span class="num" style="color:var(--muted)">'+money(sp)+'</span></span>'
        +'<input type="text" inputmode="decimal" data-budget="'+esc(c.id)+'" value="'+(lim?fmtInput(lim):'')+'" placeholder="Limite" aria-label="Limite mensal de '+esc(c.name)+'"></div>'
        +'<div class="bar"><i style="width:'+pct.toFixed(1)+'%;background:'+(over?'var(--out)':col)+'"></i></div>'
        +'<small>'+(lim?(over?'Passou '+money(sp-lim)+' do limite':'Restam '+money(lim-sp)):'Sem limite definido')+'</small></li>';
    }).join('')+'</ul></section>';
};

VIEWS.orc=function(){return budgetsHtml()+goalsHtml();};

function goalsHtml(){
  const G=P().goals;
  const body=G.length?'<ul class="list">'+G.map(function(g){
    const saved=g.deposits.reduce((s,d)=>s+d.amount,0);
    const pct=Math.max(0,Math.min(100,saved/g.target*100));
    const left=Math.max(0,g.target-saved);
    let extra;
    if(left<=0) extra='Meta alcançada.';
    else if(g.date){
      const now=new Date(),end=parseYmd(g.date);
      const months=Math.max(1,(end.getFullYear()-now.getFullYear())*12+end.getMonth()-now.getMonth());
      extra=end<now?'O prazo já passou. Faltam '+money(left)+'.':'Faltam '+money(left)+'. Guardando '+money(left/months)+' por mês você chega lá até '+monthLabel(ym(g.date)).toLowerCase()+'.';
    }else extra='Faltam '+money(left)+'.';
    return '<li class="brow"><div class="bhead" style="grid-template-columns:minmax(0,1fr) auto"><span class="nm"><strong>'+esc(g.name)+'</strong></span><span class="num">'+money(saved)+' de '+money(g.target)+'</span></div>'
      +'<div class="bar"><i style="width:'+pct.toFixed(1)+'%;background:var(--in)"></i></div><small>'+esc(extra)+'</small>'
      +'<div class="set-actions" style="margin-top:8px"><button class="btn small" data-act="goal-dep" data-id="'+esc(g.id)+'">Guardar</button><button class="btn small" data-act="goal-wd" data-id="'+esc(g.id)+'">Retirar</button><button class="btn small" data-act="goal-edit" data-id="'+esc(g.id)+'">Editar</button></div></li>';
  }).join('')+'</ul>':'<p class="empty">Nenhuma meta ainda. Crie uma para uma viagem, uma reserva de emergência ou uma compra grande.</p>';
  return '<section class="panel"><h2>Metas de economia</h2><p class="note">O valor guardado em uma meta é um controle à parte e não movimenta suas contas.</p>'+body+'<div style="margin-top:14px"><button class="btn primary" data-act="goal-add">Nova meta</button></div></section>';
}

VIEWS.rel=function(){
  const m=V.month,sc=spendByCat(m);
  const ent=Object.entries(sc).sort((a,b)=>b[1]-a[1]);
  const tot=ent.reduce((s,e)=>s+e[1],0);
  let donut='<p class="empty">Sem despesas neste mês.</p>';
  if(tot>0){
    let off=25;
    const segs=ent.map(function(e){const p=e[1]/tot*100;const s='<circle r="15.9155" cx="21" cy="21" fill="none" stroke="'+safeColor(cat(e[0]).color)+'" stroke-width="6" stroke-dasharray="'+p.toFixed(3)+' '+(100-p).toFixed(3)+'" stroke-dashoffset="'+off.toFixed(3)+'"><title>'+esc(cat(e[0]).name)+': '+money(e[1])+'</title></circle>';off-=p;return s;}).join('');
    donut='<div class="donutwrap"><svg class="donut" viewBox="0 0 42 42" width="200" height="200" role="img" aria-label="Despesas por categoria">'+segs+'<text x="21" y="22.2" text-anchor="middle" font-size="3.6">'+esc(money(tot))+'</text></svg><div>'
      +ent.map(function(e){const c=cat(e[0]);return '<div class="catbar"><span class="nm"><i class="dot" style="background:'+safeColor(c.color)+'"></i>'+esc(c.name)+'</span><span class="num">'+money(e[1])+' <span style="color:var(--muted);font-weight:400">('+Math.round(e[1]/tot*100)+'%)</span></span></div>';}).join('')+'</div></div>';
  }
  const months=[];for(let k=5;k>=0;k--) months.push(shiftMonth(m,-k));
  const data=months.map(mm=>({m:mm,t:totals(mm)}));
  const mx=Math.max(1,...data.map(d=>Math.max(d.t.i,d.t.o)));
  const H=170;
  const bars=data.map(function(d,k){
    const x=k*100+14,hi=d.t.i/mx*H,ho=d.t.o/mx*H;
    const lab=parseYmd(d.m+'-01').toLocaleDateString('pt-BR',{month:'short'}).replace('.','');
    return '<rect x="'+x+'" y="'+(H-hi+10)+'" width="32" height="'+hi.toFixed(1)+'" rx="4" fill="var(--in)"><title>Receitas de '+esc(lab)+': '+money(d.t.i)+'</title></rect>'
      +'<rect x="'+(x+36)+'" y="'+(H-ho+10)+'" width="32" height="'+ho.toFixed(1)+'" rx="4" fill="var(--out)"><title>Despesas de '+esc(lab)+': '+money(d.t.o)+'</title></rect>'
      +'<text x="'+(x+34)+'" y="'+(H+30)+'" text-anchor="middle" font-size="13" fill="var(--muted)">'+esc(lab)+'</text>';
  }).join('');
  return '<section class="panel"><h2>Despesas por categoria</h2>'+donut+'</section>'
    +'<section class="panel"><h2>Últimos seis meses</h2><div class="scroll"><svg viewBox="0 0 600 '+(H+42)+'" width="100%" style="min-width:480px;max-height:260px" role="img" aria-label="Receitas e despesas por mês">'+bars+'</svg></div>'
    +'<div class="legend"><span><i class="dot" style="background:var(--in)"></i>Receitas</span><span><i class="dot" style="background:var(--out)"></i>Despesas</span></div></section>'
    +'<section class="panel"><h2>Exportar</h2><p class="note">Gera uma tabela do mês atual para copiar e colar no Excel ou no Google Planilhas.</p><button class="btn" data-act="export-csv">Exportar mês em CSV</button></section>';
};

VIEWS.ajustes=function(){
  const p=P();
  return accountPanel()+'<section class="panel"><h2>Perfis</h2><p class="note">Cada perfil tem contas, categorias e lançamentos próprios. Use um para você e outro para a casa, por exemplo.</p>'
    +S.profiles.map(pr=>'<div class="set-row"><strong>'+esc(pr.name)+(pr.id===S.active?' (ativo)':'')+'</strong><div class="set-actions"><button class="btn small" data-act="rename-profile" data-id="'+esc(pr.id)+'">Renomear</button></div></div>').join('')
    +'<div style="margin-top:14px"><button class="btn primary" data-act="add-profile">Novo perfil</button></div></section>'
    +'<section class="panel"><h2>Categorias do perfil ativo</h2>'
    +p.categories.map(c=>'<div class="set-row"><span style="display:flex;align-items:center;gap:10px"><i class="dot" style="background:'+safeColor(c.color)+'"></i>'+esc(c.name)+' <span style="color:var(--muted);font-size:13px">'+(c.type==='in'?'receita':'despesa')+'</span></span><button class="btn small" data-act="edit-cat" data-id="'+esc(c.id)+'">Editar</button></div>').join('')
    +'<div style="margin-top:14px"><button class="btn primary" data-act="add-cat">Nova categoria</button></div></section>'
    +'<section class="panel"><h2>Aparência</h2><div class="f" style="max-width:260px"><label for="theme">Tema</label><select id="theme" data-theme-sel><option value="auto"'+(S.theme==='auto'?' selected':'')+'>Automático</option><option value="light"'+(S.theme==='light'?' selected':'')+'>Claro</option><option value="dark"'+(S.theme==='dark'?' selected':'')+'>Escuro</option></select></div></section>'
    +'<section class="panel"><h2>Seus dados</h2><p class="note">'+(CLOUD?'Seus dados ficam salvos na nuvem. Exporte uma cópia para guardar ou importe um backup feito na versão que salva só no navegador.':'Os dados ficam salvos neste navegador. Exporte uma cópia para guardar ou levar a outro aparelho.')+'</p><div class="set-actions">'
    +'<button class="btn" data-act="export-json">Exportar tudo</button><button class="btn" data-act="import-json">Importar</button>'
    +(CLOUD?'':'<button class="btn" data-act="sample">Carregar exemplo neste perfil</button><button class="btn danger" data-act="reset">Apagar tudo</button>')+'</div></section>';
};

/* ---------- render ---------- */
function applyTheme(){
  const r=document.documentElement;
  if(S.theme==='auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme',S.theme);
}
function render(){
  applyTheme();
  const lim=addDays(today(),60);
  generateRules(lim>V.month+'-31'?lim:V.month+'-31');
  $('#nav').innerHTML=NAV.map(n=>'<button data-act="nav" data-id="'+n[0]+'"'+(V.view===n[0]?' aria-current="page"':'')+'>'+icon(n[0])+'<span>'+n[1]+'</span></button>').join('');
  $('#monthlabel').textContent=monthLabel(V.month);
  $('#monthnav').hidden=(V.view==='contas'||V.view==='ajustes');
  $('#profile').innerHTML=S.profiles.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===S.active?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  $('#view').innerHTML=VIEWS[V.view]();
}

/* ---------- diálogo de lançamento ---------- */
const dtx=$('#dtx'),ftx=$('#ftx');
let editingId=null;
function fillCats(type,sel){
  const list=P().categories.filter(c=>c.type===type);
  $('#f-cat').innerHTML=list.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===sel?' selected':'')+'>'+esc(c.name)+'</option>').join('');
}
function syncType(){
  const type=ftx.elements['ttype'].value;
  $('#g-cat').hidden=(type==='tr');
  $('#g-acc2').hidden=(type!=='tr');
  $('#l-acc').textContent=type==='tr'?'Sai de':'Conta';
  $('#l-paid').textContent=type==='in'?'Já recebido':type==='out'?'Já pago':'Já efetivada';
  if(type!=='tr') fillCats(type,$('#f-cat').value);
  updInvHint();
}
function updInvHint(){
  const h=$('#invhint'),type=ftx.elements['ttype'].value;
  const a=P().accounts.find(x=>x.id===$('#f-acc').value),d=$('#f-date').value;
  if(a&&a.kind==='cartao'&&d&&(type==='out'||type==='in')){
    const m=invMonth(d,a.closing),dd=dueDate(m,a);
    h.textContent='Entra na fatura de '+monthLabel(m).toLowerCase()+(dd?', com vencimento em '+dd.split('-').reverse().join('/')+'.':'.');
    h.hidden=false;
  }else h.hidden=true;
}
function syncRep(){ $('#g-count').hidden=($('#f-rep').value==='none'); }
function openTx(t){
  editingId=t&&t.id?t.id:null;
  const accs=P().accounts;
  const opts=accs.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('');
  $('#f-acc').innerHTML=opts;$('#f-acc2').innerHTML=opts;
  t=t||{};
  const type=t.type||'out';
  ftx.elements['ttype'].value=type;
  fillCats(type===('tr')?'out':type,t.cat);
  $('#f-desc').value=t.desc||'';
  $('#f-amount').value=t.amount?fmtInput(t.amount):'';
  $('#f-date').value=t.date||(ym(today())===V.month?today():V.month+'-01');
  if(t.acc) $('#f-acc').value=t.acc;
  if(t.acc2) $('#f-acc2').value=t.acc2; else if(accs.length>1) $('#f-acc2').value=accs[1].id;
  $('#f-paid').checked=!!t.paid;
  $('#f-rep').value='none';$('#f-count').value=12;
  $('#g-repeat').hidden=!!editingId;
  $('#dtx-title').textContent=editingId?'Editar lançamento':'Novo lançamento';
  const del=$('#tx-del');del.hidden=!editingId;del.textContent='Excluir';delete del.dataset.armed;
  $('#txerr').textContent='';
  syncType();syncRep();
  if(!dtx.open) dtx.showModal();
  if(!editingId) $('#f-desc').focus();
}
ftx.addEventListener('change',function(e){
  if(e.target.name==='ttype') syncType();
  if(e.target.name==='rep') syncRep();
  if(e.target.id==='f-acc'||e.target.id==='f-date') updInvHint();
});
ftx.addEventListener('submit',function(e){
  e.preventDefault();
  const f=ftx.elements;
  const type=f['ttype'].value,desc=f['desc'].value.trim(),amount=parseMoney(f['amount'].value),date=f['date'].value;
  const err=$('#txerr');
  if(!desc){err.textContent='Escreva uma descrição.';return;}
  if(!(amount>0)){err.textContent='Informe um valor maior que zero, por exemplo 48,90.';return;}
  if(!date){err.textContent='Escolha a data.';return;}
  const a1=f['acc'].value,a2=f['acc2'].value;
  if(type==='tr'&&a1===a2){err.textContent='Escolha duas contas diferentes para a transferência.';return;}
  const base={type:type,desc:desc,amount:amount,date:date,cat:type==='tr'?'':f['cat'].value,acc:a1,acc2:type==='tr'?a2:'',paid:f['paid'].checked};
  if(editingId){
    const t=P().tx.find(x=>x.id===editingId);
    if(t) Object.assign(t,base);
  }else{
    const rep=f['rep'].value;
    const n=rep==='none'?1:Math.max(2,Math.min(60,parseInt(f['count'].value,10)||2));
    const group=n>1?uid():null;
    for(let i=0;i<n;i++){
      P().tx.push(Object.assign({},base,{id:uid(),desc:rep==='inst'?desc+' ('+(i+1)+'/'+n+')':desc,date:addMonths(date,i),paid:i===0?base.paid:false,group:group}));
    }
  }
  V.month=ym(date);
  save();dtx.close();render();
});
$('#tx-del').addEventListener('click',function(e){
  const b=e.currentTarget;
  if(!b.dataset.armed){b.dataset.armed='1';b.textContent='Confirmar exclusão';setTimeout(function(){if(b.dataset.armed){delete b.dataset.armed;b.textContent='Excluir';}},4000);return;}
  P().tx=P().tx.filter(x=>x.id!==editingId);
  save();dtx.close();render();
});

/* ---------- diálogo genérico ---------- */
const dgen=$('#dgen'),fgen=$('#fgen');
let gen=null;
function fieldHtml(f){
  const id='g-'+f.name;
  let ctl;
  if(f.type==='select') ctl='<select id="'+id+'" name="'+f.name+'">'+f.options.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===f.value?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>';
  else if(f.type==='color') ctl='<input type="color" id="'+id+'" name="'+f.name+'" value="'+safeColor(f.value)+'">';
  else if(f.type==='date') ctl='<input type="date" id="'+id+'" name="'+f.name+'" value="'+esc(f.value||'')+'">';
  else ctl='<input type="text" id="'+id+'" name="'+f.name+'" value="'+esc(f.value||'')+'"'+(f.type==='money'?' inputmode="decimal"':f.type==='int'?' inputmode="numeric"':'')+' autocomplete="off">';
  return '<div class="f"'+(f.showIf?' data-showif="'+esc(f.showIf)+'"':'')+'><label for="'+id+'">'+esc(f.label)+'</label>'+ctl+'</div>';
}
function applyShowIf(){
  fgen.querySelectorAll('[data-showif]').forEach(function(w){
    const p=w.dataset.showif.split('='),el=fgen.elements[p[0]];
    w.hidden=!el||el.value!==p[1];
  });
}
fgen.addEventListener('change',applyShowIf);
function formDialog(o){
  gen=o;
  $('#dgen-title').textContent=o.title;
  $('#dgen-fields').innerHTML=o.fields.map(fieldHtml).join('');
  $('#dgen-err').textContent='';
  const del=$('#dgen-del');del.hidden=!o.onDelete;del.textContent='Excluir';delete del.dataset.armed;
  applyShowIf();
  dgen.showModal();
  const first=dgen.querySelector('input,select');if(first) first.focus();
}
fgen.addEventListener('submit',function(e){
  e.preventDefault();
  const v={};
  for(const el of fgen.elements) if(el.name) v[el.name]=el.value;
  const msg=gen.onSubmit(v);
  if(msg){$('#dgen-err').textContent=msg;return;}
  save();dgen.close();render();
});
$('#dgen-del').addEventListener('click',function(e){
  const b=e.currentTarget;
  if(!b.dataset.armed){b.dataset.armed='1';b.textContent='Confirmar exclusão';setTimeout(function(){if(b.dataset.armed){delete b.dataset.armed;b.textContent='Excluir';}},4000);return;}
  const msg=gen.onDelete();
  if(msg){$('#dgen-err').textContent=msg;delete b.dataset.armed;b.textContent='Excluir';return;}
  save();dgen.close();render();
});

function accountDialog(a){
  const isNew=!a;
  const payOpts=[['','Escolher na hora de pagar']].concat(P().accounts.filter(x=>x.kind!=='cartao'&&(!a||x.id!==a.id)).map(x=>[x.id,x.name]));
  formDialog({
    title:isNew?'Nova conta':'Editar conta',
    fields:[
      {name:'name',label:'Nome',value:a?a.name:''},
      {name:'kind',label:'Tipo',type:'select',value:a?a.kind:'conta',options:Object.entries(KIND)},
      {name:'initial',label:'Saldo inicial',type:'money',value:a?fmtInput(a.initial||0):'0,00'},
      {name:'closing',label:'Dia de fechamento da fatura (1 a 28)',type:'int',value:a&&a.closing?String(a.closing):'',showIf:'kind=cartao'},
      {name:'due',label:'Dia de vencimento (1 a 28)',type:'int',value:a&&a.due?String(a.due):'',showIf:'kind=cartao'},
      {name:'payAcc',label:'Pagar a fatura com',type:'select',value:a&&a.payAcc?a.payAcc:'',options:payOpts,showIf:'kind=cartao'}
    ],
    onSubmit:function(v){
      const name=v.name.trim();if(!name) return 'Dê um nome para a conta.';
      let ini=parseMoney(v.initial);if(isNaN(ini)) ini=0;
      if(/^\s*-/.test(v.initial)) ini=-ini;
      let closing=null,due=null,payAcc=null;
      if(v.kind==='cartao'){
        closing=parseInt(v.closing,10);due=parseInt(v.due,10);
        if(!(closing>=1&&closing<=28)) return 'Informe o dia de fechamento, de 1 a 28.';
        if(!(due>=1&&due<=28)) return 'Informe o dia de vencimento, de 1 a 28.';
        payAcc=v.payAcc||null;
      }
      if(isNew) P().accounts.push({id:uid(),name:name,kind:v.kind,initial:ini,closing:closing,due:due,payAcc:payAcc});
      else{a.name=name;a.kind=v.kind;a.initial=ini;a.closing=closing;a.due=due;a.payAcc=payAcc;}
      return null;
    },
    onDelete:isNew?null:function(){
      if(P().tx.some(t=>t.acc===a.id||t.acc2===a.id)) return 'Esta conta tem lançamentos. Mova ou exclua os lançamentos antes.';
      if(P().rules.some(r=>r.acc===a.id)) return 'Esta conta é usada em uma recorrência. Exclua ou altere a recorrência antes.';
      if(P().accounts.length<2) return 'Mantenha pelo menos uma conta.';
      P().accounts=P().accounts.filter(x=>x.id!==a.id);return null;
    }
  });
}
function payInvoice(a,m){
  const inv=cardInvoices(a).find(i=>i.m===m);
  if(!inv) return;
  const from=P().accounts.filter(x=>x.kind!=='cartao');
  const title='Pagar fatura de '+monthLabel(m).toLowerCase();
  if(!from.length){
    formDialog({title:title,fields:[],onSubmit:()=>'Cadastre uma conta corrente ou dinheiro para pagar a fatura.'});
    $('#dgen-err').textContent='Cadastre uma conta corrente ou dinheiro para pagar a fatura.';
    return;
  }
  formDialog({
    title:title,
    fields:[
      {name:'amount',label:'Valor',type:'money',value:fmtInput(inv.open)},
      {name:'from',label:'Pagar com',type:'select',value:a.payAcc&&from.some(x=>x.id===a.payAcc)?a.payAcc:from[0].id,options:from.map(x=>[x.id,x.name])},
      {name:'date',label:'Data',type:'date',value:today()}
    ],
    onSubmit:function(v){
      const am=parseMoney(v.amount);
      if(!(am>0)) return 'Informe o valor do pagamento.';
      if(!v.date) return 'Escolha a data.';
      P().tx.push({id:uid(),type:'tr',desc:'Pagamento da fatura de '+monthLabel(m).toLowerCase()+' ('+a.name+')',amount:am,date:v.date,cat:'',acc:v.from,acc2:a.id,paid:v.date<=today(),group:null,invoice:m});
      return null;
    }
  });
}
function goalDialog(g){
  const isNew=!g;
  formDialog({
    title:isNew?'Nova meta':'Editar meta',
    fields:[
      {name:'name',label:'Nome',value:g?g.name:''},
      {name:'target',label:'Valor da meta',type:'money',value:g?fmtInput(g.target):''},
      {name:'date',label:'Prazo (opcional)',type:'date',value:g?g.date||'':''}
    ],
    onSubmit:function(v){
      const name=v.name.trim();if(!name) return 'Dê um nome para a meta.';
      const t=parseMoney(v.target);if(!(t>0)) return 'Informe o valor da meta.';
      if(isNew) P().goals.push({id:uid(),name:name,target:t,date:v.date||'',deposits:[]});
      else{g.name=name;g.target=t;g.date=v.date||'';}
      return null;
    },
    onDelete:isNew?null:function(){P().goals=P().goals.filter(x=>x.id!==g.id);return null;}
  });
}
function goalMove(g,sign){
  formDialog({
    title:(sign>0?'Guardar em ':'Retirar de ')+g.name,
    fields:[{name:'amount',label:'Valor',type:'money',value:''},{name:'date',label:'Data',type:'date',value:today()}],
    onSubmit:function(v){
      const am=parseMoney(v.amount);
      if(!(am>0)) return 'Informe um valor maior que zero.';
      const saved=g.deposits.reduce((s,d)=>s+d.amount,0);
      if(sign<0&&am>saved+0.001) return 'Você só pode retirar até '+money(saved)+'.';
      g.deposits.push({id:uid(),amount:sign*am,date:v.date||today(),note:''});
      return null;
    }
  });
}
function ruleDialog(r){
  const isNew=!r;
  const catOpts=t=>P().categories.filter(c=>c.type===t).map(c=>[c.id,c.name]);
  const accOpts=P().accounts.map(a=>[a.id,a.name]);
  formDialog({
    title:isNew?'Nova recorrência':'Editar recorrência',
    fields:[
      {name:'type',label:'Tipo',type:'select',value:r?r.type:'out',options:[['out','Despesa'],['in','Receita']]},
      {name:'desc',label:'Descrição',value:r?r.desc:''},
      {name:'amount',label:'Valor',type:'money',value:r?fmtInput(r.amount):''},
      {name:'cat_out',label:'Categoria',type:'select',value:r&&r.type==='out'?r.cat:'',options:catOpts('out'),showIf:'type=out'},
      {name:'cat_in',label:'Categoria',type:'select',value:r&&r.type==='in'?r.cat:'',options:catOpts('in'),showIf:'type=in'},
      {name:'acc',label:'Conta',type:'select',value:r?r.acc:accOpts[0][0],options:accOpts},
      {name:'freq',label:'Frequência',type:'select',value:r?r.freq:'monthly',options:[['monthly','Todo mês'],['weekly','Toda semana'],['yearly','Todo ano']]},
      {name:'start',label:'Primeira data',type:'date',value:r?r.start:today()},
      {name:'end',label:'Termina em (opcional)',type:'date',value:r?r.end||'':''},
      {name:'active',label:'Situação',type:'select',value:r&&!r.active?'0':'1',options:[['1','Ativa'],['0','Pausada']]}
    ],
    onSubmit:function(v){
      const desc=v.desc.trim(),am=parseMoney(v.amount);
      if(!desc) return 'Escreva uma descrição.';
      if(!(am>0)) return 'Informe um valor maior que zero.';
      if(!v.start) return 'Escolha a primeira data.';
      if(v.end&&v.end<v.start) return 'A data final não pode ser anterior à primeira data.';
      const cat=v.type==='in'?v.cat_in:v.cat_out;
      if(isNew){
        const nr={id:uid(),type:v.type,desc:desc,amount:am,cat:cat,acc:v.acc,freq:v.freq,start:v.start,end:v.end||'',count:0,active:v.active==='1'};
        P().rules.push(nr);
        generateRules(addDays(today(),60));
        P().tx.forEach(function(t){if(t.rule===nr.id&&t.date<=today()) t.paid=true;});
      }else{
        if(r.count>0&&(v.start!==r.start||v.freq!==r.freq)) return 'A primeira data e a frequência não mudam depois que a recorrência já gerou lançamentos. Crie uma nova recorrência.';
        Object.assign(r,{type:v.type,desc:desc,amount:am,cat:cat,acc:v.acc,start:v.start,freq:v.freq,end:v.end||'',active:v.active==='1'});
        P().tx.forEach(function(t){
          if(t.rule===r.id&&!t.paid&&t.date>today()) Object.assign(t,{type:r.type,desc:desc,amount:am,cat:cat,acc:v.acc});
        });
      }
      return null;
    },
    onDelete:isNew?null:function(){
      P().tx=P().tx.filter(t=>!(t.rule===r.id&&!t.paid&&t.date>today()));
      P().tx.forEach(function(t){if(t.rule===r.id) t.rule=null;});
      P().rules=P().rules.filter(x=>x.id!==r.id);
      return null;
    }
  });
}
function catDialog(c){
  const isNew=!c;
  formDialog({
    title:isNew?'Nova categoria':'Editar categoria',
    fields:[
      {name:'name',label:'Nome',value:c?c.name:''},
      {name:'type',label:'Tipo',type:'select',value:c?c.type:'out',options:[['out','Despesa'],['in','Receita']]},
      {name:'color',label:'Cor',type:'color',value:c?c.color:'#3F6C8C'}
    ],
    onSubmit:function(v){
      const name=v.name.trim();if(!name) return 'Dê um nome para a categoria.';
      if(isNew) P().categories.push({id:uid(),name:name,type:v.type,color:v.color});
      else{
        if(c.type!==v.type&&P().tx.some(t=>t.cat===c.id)) return 'Esta categoria já tem lançamentos; não dá para mudar o tipo.';
        c.name=name;c.type=v.type;c.color=v.color;
      }
      return null;
    },
    onDelete:isNew?null:function(){
      if(P().tx.some(t=>t.cat===c.id)) return 'Esta categoria tem lançamentos. Mude a categoria deles antes de excluir.';
      P().categories=P().categories.filter(x=>x.id!==c.id);delete P().budgets[c.id];return null;
    }
  });
}
function profileDialog(p){
  const isNew=!p;
  formDialog({
    title:isNew?'Novo perfil':'Renomear perfil',
    fields:[{name:'name',label:'Nome',value:p?p.name:''}],
    onSubmit:function(v){
      const name=v.name.trim();if(!name) return 'Dê um nome para o perfil.';
      if(isNew){
        if(CLOUD){cloudNewProfile(name).catch(syncFail);return null;}
        const id=uid();S.profiles.push({id:id,name:name});S.data[id]=newProfileData();S.active=id;
      }
      else p.name=name;
      return null;
    },
    onDelete:(isNew||S.profiles.length<2)?null:function(){
      S.profiles=S.profiles.filter(x=>x.id!==p.id);delete S.data[p.id];
      if(S.active===p.id) S.active=S.profiles[0].id;return null;
    }
  });
}

/* ---------- diálogo de texto (exportar e importar) ---------- */
const dtxt=$('#dtxt');
function textDialog(title,note,text,importMode){
  $('#dtxt-title').textContent=title;
  $('#dtxt-note').textContent=note;
  const ta=$('#dtxt-area');ta.value=text;ta.readOnly=!importMode;
  $('#dtxt-err').textContent='';
  $('#dtxt-copy').hidden=!!importMode;$('#dtxt-copy').textContent='Copiar';
  $('#dtxt-go').hidden=!importMode;
  dtxt.showModal();
  if(!importMode){ta.focus();ta.select();} else ta.focus();
}
function csvMonth(){
  const q=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const rows=[['Data','Descrição','Tipo','Categoria','Conta','Valor','Efetivado'].join(';')];
  monthTx(V.month).sort((a,b)=>a.date.localeCompare(b.date)).forEach(function(t){
    const d=t.date.split('-').reverse().join('/');
    rows.push([d,q(t.desc),t.type==='in'?'Receita':t.type==='out'?'Despesa':'Transferência',q(t.type==='tr'?'':cat(t.cat).name),q(acc(t.acc).name+(t.type==='tr'?' > '+acc(t.acc2).name:'')),fmtInput(t.amount),t.paid?'Sim':'Não'].join(';'));
  });
  return rows.join('\n');
}

/* ---------- dados de exemplo ---------- */
function loadSample(){
  const p=P(),d=new Date(),t0=today();
  p.accounts=[
    {id:'a-cc',name:'Conta corrente',kind:'conta',initial:1500},
    {id:'a-card',name:'Cartão de crédito',kind:'cartao',initial:0,closing:10,due:20,payAcc:'a-cc'},
    {id:'a-cash',name:'Carteira',kind:'dinheiro',initial:120}
  ];
  p.tx=[];p.goals=[];p.rules=[];p.budgets={'c-mercado':900,'c-restaurantes':450,'c-lazer':300,'c-transporte':400};
  let seed=7;const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
  const r=(a,b)=>Math.round((a+rnd()*(b-a))*100)/100;
  for(let k=2;k>=0;k--){
    const base=addMonths(d.getFullYear()+'-'+pad(d.getMonth()+1)+'-01',-k).slice(0,7);
    const add=function(type,desc,c,amount,day,a,a2){
      const date=base+'-'+pad(day);
      p.tx.push({id:uid(),type:type,desc:desc,amount:amount,date:date,cat:c,acc:a,acc2:a2||'',paid:date<=t0,group:null});
    };
    add('in','Salário','c-salario',6500,5,'a-cc');
    if(k===1) add('in','Projeto de site','c-freelance',1800,18,'a-cc');
    add('out','Aluguel','c-moradia',1800,10,'a-cc');
    add('out','Energia elétrica','c-moradia',r(120,170),12,'a-cc');
    add('out','Internet','c-moradia',119.9,15,'a-cc');
    [3,10,17,24].forEach(dy=>add('out','Mercado','c-mercado',r(120,260),dy,'a-card'));
    [6,14,26].forEach(dy=>add('out','Restaurante','c-restaurantes',r(35,95),dy,'a-card'));
    [2,9,16,23].forEach(dy=>add('out','Transporte por app','c-transporte',r(18,60),dy,'a-card'));
    add('out','Cinema','c-lazer',r(50,90),20,'a-card');
    add('out','Streaming de vídeo','c-assinaturas',39.9,8,'a-card');
    add('out','Streaming de música','c-assinaturas',21.9,8,'a-card');
    add('out','Farmácia','c-saude',r(60,110),22,'a-cash');
    add('tr','Reserva para a carteira','',200,8,'a-cc','a-cash');
  }
  p.goals=[
    {id:uid(),name:'Reserva de emergência',target:10000,date:'',deposits:[{id:uid(),amount:2500,date:addMonths(t0,-2),note:''},{id:uid(),amount:1500,date:addMonths(t0,-1),note:''}]},
    {id:uid(),name:'Viagem de fim de ano',target:4000,date:addMonths(t0,8),deposits:[{id:uid(),amount:600,date:addMonths(t0,-1),note:''}]}
  ];
  p.rules=[{id:uid(),type:'out',desc:'Academia',amount:99.9,cat:'c-saude',acc:'a-card',freq:'monthly',start:addMonths(t0.slice(0,7)+'-03',-2),end:'',count:0,active:true}];
  generateRules(addDays(t0,60));
  p.tx.forEach(function(t){if(t.rule&&t.date<=t0) t.paid=true;});
  normalize(S);
  V.month=ym(t0);
}

/* ---------- lançamento rápido ---------- */
const KW={
  'Mercado':['mercado','supermercado','feira','padaria','açougue','acougue','hortifruti'],
  'Transporte':['uber','99','ônibus','onibus','gasolina','combustível','combustivel','metrô','metro','estacionamento','pedágio','pedagio'],
  'Restaurantes':['restaurante','lanche','pizza','ifood','almoço','almoco','jantar','café','cafe','bar'],
  'Moradia':['aluguel','condomínio','condominio','luz','água','agua','internet','gás','gas','iptu'],
  'Saúde':['farmácia','farmacia','médico','medico','dentista','consulta','remédio','remedio'],
  'Lazer':['cinema','show','viagem','jogo','parque'],
  'Educação':['curso','escola','faculdade','livro','mensalidade'],
  'Assinaturas':['netflix','spotify','assinatura','youtube','prime'],
  'Salário':['salário','salario'],
  'Freelance':['freela','freelance','projeto']
};
function daysAgo(n){const d=new Date();d.setDate(d.getDate()-n);return ymd(d);}
function quickParse(text){
  const low=text.trim().toLowerCase();
  if(!low) return null;
  let work=low,date=today();
  const dm=work.match(/(?:^|\s)dia\s+(\d{1,2})(?=\s|$)/);
  if(dm){
    const n=new Date(),dim=new Date(n.getFullYear(),n.getMonth()+1,0).getDate();
    date=n.getFullYear()+'-'+pad(n.getMonth()+1)+'-'+pad(Math.max(1,Math.min(+dm[1],dim)));
    work=work.replace(dm[0],' ');
  }else if(work.indexOf('anteontem')>=0){date=daysAgo(2);work=work.replace('anteontem',' ');}
  else if(work.indexOf('ontem')>=0){date=daysAgo(1);work=work.replace('ontem',' ');}
  else if(work.indexOf('hoje')>=0){work=work.replace('hoje',' ');}
  const am=work.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  const amount=am?parseMoney(am[1]):NaN;
  if(am) work=work.replace(am[0],' ');
  const isIn=['recebi','ganhei','receita','salário','salario','entrou','recebimento'].some(k=>low.indexOf(k)>=0);
  work=work.replace(/(gastei|paguei|comprei|recebi|ganhei|r\$|reais)/g,' ').replace(/\s+/g,' ').trim().replace(/^(?:(?:de|do|da|no|na|em|com|um|uma)\s+)+/,'');
  const type=isIn?'in':'out';
  let c=null;
  for(const nm in KW){ if(KW[nm].some(k=>low.indexOf(k)>=0)){const hit=P().categories.find(x=>x.type===type&&x.name===nm);if(hit){c=hit.id;break;}} }
  if(!c){const byName=P().categories.find(x=>x.type===type&&low.indexOf(x.name.toLowerCase())>=0);if(byName) c=byName.id;}
  if(!c){const fb=P().categories.find(x=>x.type===type&&x.name===(isIn?'Outras receitas':'Outros'))||P().categories.find(x=>x.type===type);c=fb?fb.id:'';}
  return {type:type,desc:work?cap(work):(isIn?'Receita':'Despesa'),amount:isNaN(amount)?0:amount,date:date,cat:c,acc:P().accounts[0].id,paid:date<=today()};
}


/* ====================== NUVEM (Supabase) ====================== */
const CLOUD_TABLES=['profiles','accounts','categories','recurrence_rules','transactions','budgets','goals','goal_deposits'];
let snap={},flushTimer=null,flushing=false,dirty=false,syncState='idle',needRender=false,lastLoad=0,recovering=false,authM='login';

function setSync(state,err){
  syncState=state;
  const b=$('#sync');if(!b||!CLOUD) return;
  const L={pending:'Alterações pendentes',saving:'Salvando…',ok:'Salvo na nuvem',error:'Erro ao sincronizar. Tentar de novo'};
  b.hidden=!L[state];b.textContent=L[state]||'';
  b.classList.toggle('error',state==='error');
  if(err&&state==='error') b.title=(err.message||String(err));
}
function syncFail(e){console.error(e);setSync('error',e);}

function rowsOf(st){
  const R={};
  const put=(t,key,row)=>{R[t+'|'+key]=row;};
  st.profiles.forEach(function(p){
    put('profiles',p.id,{id:p.id,owner_id:p.owner,name:p.name});
    const d=st.data[p.id];if(!d) return;
    d.accounts.forEach(a=>put('accounts',a.id,{id:a.id,profile_id:p.id,name:a.name,kind:a.kind,initial_balance:a.initial||0,closing_day:a.closing||null,due_day:a.due||null,pay_account_id:a.payAcc||null}));
    d.categories.forEach(c=>put('categories',c.id,{id:c.id,profile_id:p.id,name:c.name,type:c.type,color:c.color}));
    d.rules.forEach(r=>put('recurrence_rules',r.id,{id:r.id,profile_id:p.id,type:r.type,description:r.desc,amount:r.amount,category_id:r.cat||null,account_id:r.acc,frequency:r.freq,start_date:r.start,end_date:r.end||null,generated_count:r.count||0,active:!!r.active}));
    d.tx.forEach(t=>put('transactions',t.id,{id:t.id,profile_id:p.id,type:t.type,description:t.desc,amount:t.amount,date:t.date,category_id:t.cat||null,account_id:t.acc,account_to_id:t.acc2||null,paid:!!t.paid,series_id:t.group||null,rule_id:t.rule||null,paid_invoice:t.invoice?t.invoice+'-01':null}));
    Object.keys(d.budgets).forEach(cid=>put('budgets',p.id+':'+cid,{profile_id:p.id,category_id:cid,amount:d.budgets[cid]}));
    d.goals.forEach(function(g){
      put('goals',g.id,{id:g.id,profile_id:p.id,name:g.name,target_amount:g.target,target_date:g.date||null});
      g.deposits.forEach(x=>put('goal_deposits',x.id,{id:x.id,profile_id:p.id,goal_id:g.id,amount:x.amount,date:x.date,note:x.note||null}));
    });
  });
  return R;
}
function stateFromRows(R,ui){
  const st={v:1,active:'',theme:(ui&&ui.theme)||'auto',profiles:[],data:{}};
  R.profiles.forEach(function(p){
    st.profiles.push({id:p.id,name:p.name,owner:p.owner_id});
    st.data[p.id]={accounts:[],categories:[],tx:[],budgets:{},goals:[],rules:[]};
  });
  const D=id=>st.data[id];
  R.accounts.forEach(a=>{if(D(a.profile_id)) D(a.profile_id).accounts.push({id:a.id,name:a.name,kind:a.kind,initial:Number(a.initial_balance),closing:a.closing_day,due:a.due_day,payAcc:a.pay_account_id});});
  R.categories.forEach(c=>{if(D(c.profile_id)) D(c.profile_id).categories.push({id:c.id,name:c.name,type:c.type,color:c.color});});
  R.recurrence_rules.forEach(r=>{if(D(r.profile_id)) D(r.profile_id).rules.push({id:r.id,type:r.type,desc:r.description,amount:Number(r.amount),cat:r.category_id||'',acc:r.account_id,freq:r.frequency,start:r.start_date,end:r.end_date||'',count:r.generated_count,active:r.active});});
  R.transactions.forEach(t=>{
    if(!D(t.profile_id)) return;
    const o={id:t.id,type:t.type,desc:t.description,amount:Number(t.amount),date:t.date,cat:t.category_id||'',acc:t.account_id,acc2:t.account_to_id||'',paid:t.paid,group:t.series_id||null,rule:t.rule_id||null};
    if(t.paid_invoice) o.invoice=String(t.paid_invoice).slice(0,7);
    D(t.profile_id).tx.push(o);
  });
  R.budgets.forEach(b=>{if(D(b.profile_id)) D(b.profile_id).budgets[b.category_id]=Number(b.amount);});
  const goals={};
  R.goals.forEach(g=>{if(D(g.profile_id)){const o={id:g.id,name:g.name,target:Number(g.target_amount),date:g.target_date||'',deposits:[]};goals[g.id]=o;D(g.profile_id).goals.push(o);}});
  R.goal_deposits.forEach(x=>{if(goals[x.goal_id]) goals[x.goal_id].deposits.push({id:x.id,amount:Number(x.amount),date:x.date,note:x.note||''});});
  st.profiles.forEach(function(p){D(p.id).categories.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name,'pt-BR'):(a.type==='out'?-1:1));});
  st.active=(ui&&st.data[ui.active])?ui.active:(st.profiles[0]?st.profiles[0].id:'');
  return normalize(st);
}
async function fetchAll(table){
  const out=[];
  for(let from=0;;from+=1000){
    let q=sb.from(table).select('*');
    q=table==='budgets'?q.order('category_id'):q.order('created_at').order('id');
    const r=await q.range(from,from+999);
    if(r.error) throw r.error;
    out.push.apply(out,r.data);
    if(r.data.length<1000) break;
  }
  return out;
}
async function loadAll(){
  const R={};
  const res=await Promise.all(CLOUD_TABLES.map(t=>fetchAll(t)));
  CLOUD_TABLES.forEach((t,i)=>{R[t]=res[i];});
  lastLoad=Date.now();
  return R;
}
function resnap(){
  snap={};
  const cur=rowsOf(S);
  for(const k in cur) snap[k]=JSON.stringify(cur[k]);
}
function diff(){
  const cur=rowsOf(S),up=[],del=[];
  for(const k in cur){const j=JSON.stringify(cur[k]);if(snap[k]!==j) up.push([k,cur[k],j]);}
  for(const k in snap) if(!(k in cur)) del.push(k);
  return {up:up,del:del};
}
function dropLocalTx(id){
  for(const pid in S.data) S.data[pid].tx=S.data[pid].tx.filter(t=>t.id!==id);
  needRender=true;
}
async function upsertChunk(t,chunk){
  const rows=chunk.map(u=>u[1]);
  const r=await sb.from(t).upsert(rows,{onConflict:t==='budgets'?'profile_id,category_id':'id'});
  if(!r.error){chunk.forEach(u=>{snap[u[0]]=u[2];});return;}
  if(chunk.length>1){for(const u of chunk) await upsertChunk(t,[u]);return;}
  // recorrência gerada ao mesmo tempo em outro aparelho: descarta a cópia local
  if(r.error.code==='23505'&&t==='transactions'&&chunk[0][1].rule_id){dropLocalTx(chunk[0][1].id);return;}
  throw r.error;
}
async function applyDiff(df){
  const byT={};
  df.up.forEach(function(u){const t=u[0].split('|')[0];(byT[t]=byT[t]||[]).push(u);});
  for(const t of CLOUD_TABLES){
    const L=byT[t];if(!L) continue;
    if(t==='profiles'){
      for(const u of L){
        const isNew=!(u[0] in snap);
        const r=isNew?await sb.from('profiles').insert(u[1]):await sb.from('profiles').update({name:u[1].name}).eq('id',u[1].id);
        if(r.error) throw r.error;
        snap[u[0]]=u[2];
      }
      continue;
    }
    for(let i=0;i<L.length;i+=400) await upsertChunk(t,L.slice(i,i+400));
  }
  const delProfiles=new Set(df.del.filter(k=>k.indexOf('profiles|')===0).map(k=>k.split('|')[1]));
  for(const t of CLOUD_TABLES.slice().reverse()){
    const keys=df.del.filter(k=>k.indexOf(t+'|')===0);
    if(!keys.length) continue;
    if(t==='profiles'){
      for(const k of keys){const r=await sb.from('profiles').delete().eq('id',k.split('|')[1]);if(r.error) throw r.error;delete snap[k];}
      continue;
    }
    const rows=[];
    for(const k of keys){
      const row=JSON.parse(snap[k]);
      if(delProfiles.has(row.profile_id)){delete snap[k];continue;}
      rows.push([k,row]);
    }
    if(t==='budgets'){
      for(const x of rows){const r=await sb.from('budgets').delete().eq('profile_id',x[1].profile_id).eq('category_id',x[1].category_id);if(r.error) throw r.error;delete snap[x[0]];}
      continue;
    }
    for(let i=0;i<rows.length;i+=100){
      const chunk=rows.slice(i,i+100);
      const r=await sb.from(t).delete().in('id',chunk.map(x=>x[1].id));
      if(r.error) throw r.error;
      chunk.forEach(x=>{delete snap[x[0]];});
    }
  }
}
function scheduleFlush(){
  if(!USER) return;
  setSync('pending');
  if(flushing){dirty=true;return;}
  clearTimeout(flushTimer);
  flushTimer=setTimeout(flush,350);
}
async function flush(){
  if(!USER) return;
  if(flushing){dirty=true;return;}
  flushing=true;
  try{
    do{
      dirty=false;
      const df=diff();
      if(!df.up.length&&!df.del.length) break;
      setSync('saving');
      await applyDiff(df);
    }while(dirty);
    setSync('ok');
    if(needRender){needRender=false;render();}
  }catch(e){syncFail(e);}
  flushing=false;
}
async function flushNow(){
  clearTimeout(flushTimer);
  for(let i=0;i<200&&flushing;i++) await new Promise(r=>setTimeout(r,50));
  await flush();
}
async function serverCreateProfile(name){
  const id=uid();
  const r=await sb.from('profiles').insert({id:id,owner_id:USER.id,name:name});
  if(r.error) throw r.error;
  return id;
}
async function reloadAll(activeId){
  const R=await loadAll();
  S=stateFromRows(R,{active:activeId||S.active,theme:S.theme});
  resnap();
}
async function cloudNewProfile(name){
  setSync('saving');
  await flushNow();
  const id=await serverCreateProfile(name);
  await reloadAll(id);
  save();render();setSync('ok');
}
async function cloudImport(o){
  setSync('saving');
  await flushNow();
  let last='';
  for(const p of o.profiles){
    const src=o.data[p.id];
    const pid=await serverCreateProfile(p.name+' (importado)');
    // remove as categorias e a carteira padrão criadas pelo banco
    let r=await sb.from('categories').delete().eq('profile_id',pid);if(r.error) throw r.error;
    r=await sb.from('accounts').delete().eq('profile_id',pid);if(r.error) throw r.error;
    S.profiles.push({id:pid,name:p.name+' (importado)',owner:USER.id});
    S.data[pid]={accounts:[],categories:[],tx:[],budgets:{},goals:[],rules:[]};
    snap['profiles|'+pid]=JSON.stringify({id:pid,owner_id:USER.id,name:p.name+' (importado)'});
    const d=S.data[pid],m={};
    const nid=old=>m[old]||(m[old]=uid());
    src.accounts.forEach(a=>nid(a.id));
    src.categories.forEach(c=>nid(c.id));
    (src.rules||[]).forEach(x=>nid(x.id));
    const ref=old=>(old&&m[old])?m[old]:'';
    const firstAcc=src.accounts.length?m[src.accounts[0].id]:'';
    d.accounts=src.accounts.map(a=>Object.assign({},a,{id:m[a.id],payAcc:ref(a.payAcc)||null}));
    d.categories=src.categories.map(c=>Object.assign({},c,{id:m[c.id]}));
    d.rules=(src.rules||[]).map(x=>Object.assign({},x,{id:m[x.id],cat:ref(x.cat),acc:ref(x.acc)||firstAcc}));
    const series={};
    d.tx=src.tx.map(function(t){
      const g=t.group?(series[t.group]=series[t.group]||uid()):null;
      return Object.assign({},t,{id:uid(),cat:ref(t.cat),acc:ref(t.acc)||firstAcc,acc2:ref(t.acc2),group:g,rule:ref(t.rule)||null});
    });
    d.budgets={};
    Object.keys(src.budgets||{}).forEach(k=>{if(m[k]) d.budgets[m[k]]=src.budgets[k];});
    d.goals=(src.goals||[]).map(g=>Object.assign({},g,{id:uid(),deposits:(g.deposits||[]).map(x=>Object.assign({},x,{id:uid()}))}));
    last=pid;
  }
  if(last) S.active=last;
  save();render();
  await flushNow();
}
async function refreshFromServer(){
  if(!USER||flushing||syncState==='pending'||syncState==='error'||syncState==='saving') return;
  if(document.querySelector('dialog[open]')||Date.now()-lastLoad<15000) return;
  try{
    const R=await loadAll();
    if(flushing||syncState==='pending'||document.querySelector('dialog[open]')) return;
    S=stateFromRows(R,{active:S.active,theme:S.theme});
    resnap();render();
  }catch(e){console.error(e);}
}

/* ---------- login ---------- */
const authEl=$('#auth');
function showAuth(on){authEl.hidden=!on;$('.app').hidden=on;}
function authMsg(text,info){
  $('#authmsg').textContent=info?'':text;
  $('#authinfo').textContent=info?text:'';
}
function authMode(m){
  authM=m;
  const rec=m==='recovery',busy=m==='loading';
  $('#authtitle').textContent=rec?'Escolha uma nova senha':busy?'Carregando…':'Entrar';
  $('#a-email-wrap').hidden=rec||busy;
  $('#a-pass-label').textContent=rec?'Nova senha':'Senha';
  $('#a-pass-wrap').hidden=busy;
  $('#a-pass').autocomplete=rec?'new-password':'current-password';
  $('#a-signup').hidden=rec||busy;
  $('#a-forgot').hidden=rec||busy;
  $('#a-submit').hidden=busy;
  $('#a-submit').textContent=rec?'Salvar nova senha':'Entrar';
}
function friendly(e){
  const m=String((e&&e.message)||e||'');
  if(/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if(/already registered/i.test(m)) return 'Este e-mail já tem conta. Use Entrar.';
  if(/not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos e tente de novo.';
  if(/password/i.test(m)&&/(least|short|weak)/i.test(m)) return 'Use uma senha mais longa e difícil de adivinhar.';
  if(/rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  if(/fetch|network/i.test(m)) return 'Sem conexão com o servidor. Verifique sua internet.';
  return 'Não foi possível concluir. '+m;
}
function readCreds(){
  const email=$('#a-email').value.trim(),password=$('#a-pass').value;
  return {email:email,password:password};
}
if(CLOUD){
  $('#authform').addEventListener('submit',async function(e){
    e.preventDefault();authMsg('');
    if(!sb) return;
    const c=readCreds();
    try{
      if(authM==='recovery'){
        if(c.password.length<8){authMsg('Use pelo menos 8 caracteres.');return;}
        const r=await sb.auth.updateUser({password:c.password});
        if(r.error) throw r.error;
        recovering=false;$('#a-pass').value='';
        if(USER){showAuth(false);authMode('login');}
        return;
      }
      if(!c.email||!c.password){authMsg('Preencha e-mail e senha.');return;}
      const r=await sb.auth.signInWithPassword(c);
      if(r.error) throw r.error;
    }catch(err){authMsg(friendly(err));}
  });
  $('#a-signup').addEventListener('click',async function(){
    authMsg('');
    const c=readCreds();
    if(!c.email){authMsg('Informe seu e-mail.');return;}
    if(c.password.length<8){authMsg('Escolha uma senha com pelo menos 8 caracteres.');return;}
    try{
      const r=await sb.auth.signUp({email:c.email,password:c.password,options:{emailRedirectTo:window.location.origin}});
      if(r.error) throw r.error;
      if(!r.data.session) authMsg('Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, volte aqui e entre.',true);
    }catch(err){authMsg(friendly(err));}
  });
  $('#a-forgot').addEventListener('click',async function(){
    authMsg('');
    const c=readCreds();
    if(!c.email){authMsg('Informe seu e-mail para receber o link de redefinição.');return;}
    try{
      const r=await sb.auth.resetPasswordForEmail(c.email,{redirectTo:window.location.origin});
      if(r.error) throw r.error;
      authMsg('Se esse e-mail tiver conta, enviamos um link para criar uma nova senha.',true);
    }catch(err){authMsg(friendly(err));}
  });
  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='visible') refreshFromServer();
  });
  window.addEventListener('beforeunload',function(e){
    if(syncState==='pending'||syncState==='saving'||syncState==='error'){e.preventDefault();e.returnValue='';}
  });
}

async function startCloud(){
  try{
    authMode('loading');showAuth(true);authMsg('');
    let ui={};
    try{ui=JSON.parse(localStorage.getItem(UIKEY)||'{}');}catch(e){}
    let R=await loadAll();
    if(!R.profiles.length){
      await serverCreateProfile('Pessoal');
      R=await loadAll();
    }
    S=stateFromRows(R,ui);
    resnap();
    V.month=ym(today());V.animate=true;
    if(recovering) authMode('recovery'); else {authMode('login');showAuth(false);}
    render();setSync('ok');
  }catch(e){
    console.error(e);
    authMode('login');showAuth(true);
    authMsg('Não foi possível carregar seus dados. '+((e&&e.message)||'')+' Recarregue a página para tentar de novo.');
  }
}
function resetCloud(){
  S={v:1,active:'',theme:S.theme||'auto',profiles:[],data:{}};
  snap={};dirty=false;needRender=false;
  const b=$('#sync');if(b) b.hidden=true;
  $('#a-pass').value='';
}
function boot(){
  if(!CLOUD){render();return;}
  document.querySelector('.app').hidden=true;
  if(!sb){
    showAuth(true);authMode('login');
    authMsg('Não foi possível carregar a biblioteca de conexão. Recarregue a página.');
    return;
  }
  authMode('loading');showAuth(true);
  sb.auth.onAuthStateChange(function(ev,session){
    // não chamar o Supabase direto aqui dentro: adia para fora do callback
    setTimeout(function(){
      if(ev==='PASSWORD_RECOVERY'){recovering=true;authMode('recovery');showAuth(true);return;}
      if(ev==='SIGNED_OUT'){USER=null;resetCloud();authMode('login');showAuth(true);return;}
      if(ev==='INITIAL_SESSION'&&!session){authMode('login');showAuth(true);return;}
      if((ev==='SIGNED_IN'||ev==='INITIAL_SESSION')&&session){
        if(USER&&USER.id===session.user.id){USER=session.user;return;}
        USER=session.user;
        startCloud();
      }
    },0);
  });
}

/* ---------- eventos ---------- */
function arm(el,armedLabel,label,fn){
  if(!el.dataset.armed){
    el.dataset.armed='1';el.textContent=armedLabel;
    setTimeout(function(){if(el.dataset.armed){delete el.dataset.armed;el.textContent=label;}},4000);
    return;
  }
  fn();
}
const ACTS={
  nav:function(id){V.view=id;V.animate=true;render();window.scrollTo(0,0);},
  mprev:function(){V.month=shiftMonth(V.month,-1);V.animate=true;render();},
  mnext:function(){V.month=shiftMonth(V.month,1);V.animate=true;render();},
  'new-tx':function(){openTx(null);},
  toggle:function(id){const t=P().tx.find(x=>x.id===id);if(t){t.paid=!t.paid;save();render();}},
  edit:function(id){const t=P().tx.find(x=>x.id===id);if(t) openTx(t);},
  filter:function(id){V.filter=id;render();},
  close:function(id,el){const d=el.closest('dialog');if(d) d.close();},
  'add-account':function(){accountDialog(null);},
  'edit-account':function(id){accountDialog(P().accounts.find(a=>a.id===id));},
  'add-cat':function(){catDialog(null);},
  'edit-cat':function(id){catDialog(P().categories.find(c=>c.id===id));},
  'add-profile':function(){profileDialog(null);},
  'rename-profile':function(id){profileDialog(S.profiles.find(p=>p.id===id));},
  'pay-invoice':function(id,el){const a=P().accounts.find(x=>x.id===id);if(a) payInvoice(a,el.dataset.m);},
  'goal-add':function(){goalDialog(null);},
  'goal-edit':function(id){goalDialog(P().goals.find(g=>g.id===id));},
  'goal-dep':function(id){const g=P().goals.find(x=>x.id===id);if(g) goalMove(g,1);},
  'goal-wd':function(id){const g=P().goals.find(x=>x.id===id);if(g) goalMove(g,-1);},
  'rule-add':function(){if(!P().accounts.length) return;ruleDialog(null);},
  'rule-edit':function(id){ruleDialog(P().rules.find(r=>r.id===id));},
  signout:function(){if(sb) sb.auth.signOut();},
  'retry-sync':function(){flushNow();},
  'export-json':function(){textDialog('Exportar tudo','Copie este texto e guarde em um lugar seguro. Para restaurar, use Importar e cole o conteúdo.',JSON.stringify(S,null,2),false);},
  'import-json':function(){textDialog('Importar dados',CLOUD?'Cole aqui o texto exportado. Cada perfil do backup será criado como um novo perfil.':'Cole aqui o texto exportado. Isso substitui todos os dados atuais.','',true);},
  'export-csv':function(){textDialog('Exportar '+monthLabel(V.month),'Copie e cole em uma planilha. Separador: ponto e vírgula.',csvMonth(),false);},
  copy:function(){
    const ta=$('#dtxt-area');ta.focus();ta.select();
    let ok=false;
    try{ok=document.execCommand('copy');}catch(e){}
    const done=function(){$('#dtxt-copy').textContent='Copiado';};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ta.value).then(done,function(){if(ok) done();});}
    else if(ok) done();
  },
  'do-import':function(){
    const err=$('#dtxt-err');
    try{
      const o=JSON.parse($('#dtxt-area').value);
      if(!validState(o)){err.textContent='O texto não parece um export do Ministério das Finanças.';return;}
      if(CLOUD){normalize(o);dtxt.close();cloudImport(o).catch(syncFail);return;}
      o.theme=o.theme||'auto';S=normalize(o);save();dtxt.close();V.month=ym(today());render();
    }catch(e){err.textContent='Não consegui ler esse texto. Cole o conteúdo completo do export.';}
  },
  sample:function(id,el){
    if(CLOUD) return;
    if(P().tx.length) return arm(el,'Confirmar: substituir dados do perfil','Carregar exemplo neste perfil',function(){loadSample();save();render();});
    loadSample();save();render();
  },
  reset:function(id,el){if(CLOUD) return;arm(el,'Confirmar: apagar tudo','Apagar tudo',function(){S=freshState();V.view='painel';V.month=ym(today());save();render();});}
};
document.addEventListener('click',function(e){
  const el=e.target.closest('[data-act]');
  if(!el) return;
  const fn=ACTS[el.dataset.act];
  if(fn) fn(el.dataset.id,el,e);
});
document.addEventListener('input',function(e){
  if(e.target.matches('[data-q]')){V.q=e.target.value;const l=$('#list');if(l) l.innerHTML=listHtml();}
});
document.addEventListener('change',function(e){
  const t=e.target;
  if(t.id==='profile'){S.active=t.value;save();render();}
  else if(t.matches('[data-accf]')){V.accf=t.value;const l=$('#list');if(l) l.innerHTML=listHtml();}
  else if(t.matches('[data-theme-sel]')){S.theme=t.value;save();applyTheme();}
  else if(t.matches('[data-budget]')){
    const v=parseMoney(t.value),id=t.dataset.budget;
    if(isNaN(v)||v<=0) delete P().budgets[id]; else P().budgets[id]=v;
    save();render();
  }
});
$('#quick').addEventListener('submit',function(e){
  e.preventDefault();
  const inp=$('#quickin');
  const p=quickParse(inp.value);
  if(!p) return;
  inp.value='';
  openTx(p);
});

boot();
})();
