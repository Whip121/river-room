// Pure poker rules. The server owns the authoritative instance.
export const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const HAND_NAMES = ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺'];
const fail = message => { throw new Error(message); };
const BLOCKED_NAMES=['傻逼','傻b','煞笔','操你','草你','妈的','尼玛','他妈','狗日','狗东西','贱人','婊子','畜生','废物','垃圾','脑残','智障','滚蛋','去死','王八蛋','龟儿子'];
export function validateName(value){
  const name=Array.from(String(value??'').normalize('NFKC').trim()).slice(0,16).join('');
  if(!name)fail('请填写昵称');
  const plain=name.toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu,'');
  if(BLOCKED_NAMES.some(word=>plain.includes(word))||/(?:你|他|她|它|谁|.+的).{0,2}(?:爸爸|妈妈|爸|妈|爹|父亲|母亲)/u.test(plain))fail('昵称含有侮辱性或冒充他人亲属的内容，请更换昵称');
  return name;
}
export function validateAvatar(value){
  const avatar=String(value??'').trim();if(!avatar)return '';
  if(/^https:\/\/[^\s]{1,1000}$/i.test(avatar))return avatar;
  if(/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar)&&avatar.length<=140000)return avatar;
  fail('头像仅支持 HTTPS 图片链接，或 100KB 以内的 PNG、JPEG、WebP 图片');
}
const live = r => r.players.filter(p => p.inHand && !p.folded);
const actors = r => live(r).filter(p => p.stack > 0);
const ordered = r => [...r.players].sort((a,b) => a.seat-b.seat);
function after(r, seat, predicate) {
  const ps=ordered(r).filter(predicate);
  return ps.find(p=>p.seat>seat) ?? ps[0];
}
function randomInt(n) {
  const a=new Uint32Array(1), max=Math.floor(4294967296/n)*n;
  do { globalThis.crypto.getRandomValues(a); } while(a[0]>=max);
  return a[0]%n;
}
export function deckCards(shortDeck=false) { return Array.from({length:shortDeck?36:52},(_,i)=>i+(shortDeck?16:0)); }
export function shuffle(cards=deckCards()) {
  const deck=[...cards];
  for(let i=deck.length-1;i>0;i--){const j=randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
export function evaluate5(cards,shortDeck=false) {
  const ranks=cards.map(c=>2+Math.floor(c/4)).sort((a,b)=>b-a);
  const groups=[...new Set(ranks)].map(v=>[v,ranks.filter(r=>r===v).length]).sort((a,b)=>b[1]-a[1] || b[0]-a[0]);
  const unique=[...new Set(ranks)];
  const flush=cards.every(c=>c%4===cards[0]%4);
  const straight=unique.length===5 ? (unique[0]-unique[4]===4 ? unique[0] : !shortDeck&&unique.join(',')==='14,5,4,3,2' ? 5 : shortDeck&&unique.join(',')==='14,9,8,7,6' ? 9 : 0) : 0;
  let category=0, kickers=ranks;
  if(flush&&straight){category=8;kickers=[straight];}
  else if(groups[0][1]===4){category=7;kickers=[groups[0][0],groups[1][0]];}
  else if(groups[0][1]===3&&groups[1][1]===2){category=6;kickers=[groups[0][0],groups[1][0]];}
  else if(flush){category=5;}
  else if(straight){category=4;kickers=[straight];}
  else if(groups[0][1]===3){category=3;kickers=groups.map(g=>g[0]);}
  else if(groups[0][1]===2&&groups[1][1]===2){category=2;kickers=groups.map(g=>g[0]);}
  else if(groups[0][1]===2){category=1;kickers=groups.map(g=>g[0]);}
  const strength=shortDeck?(category===5?6:category===6?5:category):category;
  let score=strength;
  for(let i=0;i<5;i++)score=score*15+(kickers[i]??0);
  return {score,category,name:HAND_NAMES[category],cards:[...cards]};
}
export function evaluate(cards,shortDeck=false) {
  if(cards.length<5 || cards.length>7)fail('需要 5 至 7 张牌');
  let best=null;
  for(let a=0;a<cards.length-4;a++)for(let b=a+1;b<cards.length-3;b++)for(let c=b+1;c<cards.length-2;c++)for(let d=c+1;d<cards.length-1;d++)for(let e=d+1;e<cards.length;e++){
    const v=evaluate5([cards[a],cards[b],cards[c],cards[d],cards[e]],shortDeck);
    if(!best||v.score>best.score)best=v;
  }
  return best;
}
export function settings(input={}) {
  const s={capacity:Number(input.capacity??6),buyIn:Number(input.buyIn??2000),smallBlind:Number(input.smallBlind??10),bigBlind:Number(input.bigBlind??20),turnSeconds:Number(input.turnSeconds??30),deckType:input.deckType==='short'?'short':'long',tableShape:input.tableShape==='round'?'round':'oval'};
  if(!Number.isInteger(s.capacity)||s.capacity<2||s.capacity>10)fail('人数应为 2–10 人');
  if(!Number.isInteger(s.buyIn)||s.buyIn<100||s.buyIn>1000000)fail('入场筹码应为 100–1,000,000 的整数');
  if(!Number.isInteger(s.smallBlind)||!Number.isInteger(s.bigBlind)||s.smallBlind<1||s.bigBlind<s.smallBlind*2||s.bigBlind>s.buyIn/5)fail('大盲至少为小盲的 2 倍，且不超过入场筹码的 1/5');
  if(![15,30,60].includes(s.turnSeconds))fail('行动时间无效');
  return s;
}
export function makeRoom(id,input={}) {
  return {id,settings:settings(input),hostId:null,players:[],spectators:[],adminActive:false,status:'waiting',handNo:0,dealer:-1,sb:null,bb:null,board:[],deck:[],burn:[],street:'preflop',currentBet:0,minRaise:20,actorId:null,deadline:null,nextAt:null,settlementUntil:null,handSummary:[],results:[],pots:[],logs:[],revision:0,createdAt:Date.now(),updatedAt:Date.now()};
}
export function log(r,text){r.logs.push({hand:r.handNo,text});r.logs=r.logs.slice(-60);}
export function addPlayer(r,id,name,{bot=false,difficulty='medium',avatar='',now=Date.now()}={}) {
  if(r.players.length>=r.settings.capacity)fail('房间已满');
  name=validateName(name);avatar=validateAvatar(avatar);
  if(!['easy','medium','hard'].includes(difficulty))fail('电脑难度无效');
  const seats=new Set(r.players.map(p=>p.seat)); let seat=0;while(seats.has(seat))seat++;
  const p={id,name,avatar,seat,bot,difficulty,stack:r.settings.buyIn,invested:r.settings.buyIn,rebuys:0,hole:[],bet:0,total:0,inHand:false,folded:false,acted:false,lastActBet:0,lastAction:'',lastSeen:now,sitOut:false,leaving:false,rebuyPending:false,readyNext:false,handStartStack:r.settings.buyIn,firstActionHand:0,foldOpenStreak:0,allinOpenStreak:0,warning:null,kicked:false};
  r.players.push(p); if(!r.hostId&&!bot)r.hostId=id;
  log(r,`${name} 加入房间`);return p;
}
export function addSpectator(r,id,name,{avatar='',now=Date.now()}={}) {
  name=validateName(name);avatar=validateAvatar(avatar);
  r.spectators??=[];const s={id,name,avatar,lastSeen:now};r.spectators.push(s);log(r,`${name} 进入观战`);return s;
}
function pay(p,amount){const n=Math.min(p.stack,amount);p.stack-=n;p.bet+=n;p.total+=n;return n;}
function turn(r,p,now){r.actorId=p?.id??null;r.deadline=p?now+(p.bot?1100:r.settings.turnSeconds*1000):null;}
function draw(r,n){for(let i=0;i<n;i++)r.board.push(r.deck.pop());}
export function startHand(r,now=Date.now(),fixedDeck) {
  if(r.status==='playing'||r.status==='settlement')fail('本手尚未结束');
  r.players=r.players.filter(p=>!p.leaving);
  for(const p of r.players){
    if((p.rebuyPending||p.bot)&&p.stack===0){p.stack=r.settings.buyIn;p.invested+=r.settings.buyIn;p.rebuys++;}
    p.rebuyPending=false;
  }
  const eligible=p=>p.stack>0&&!p.sitOut;
  if(r.players.filter(eligible).length<2){r.status='waiting';r.nextAt=null;return false;}
  r.status='playing';r.handNo++;r.board=[];r.burn=[];r.deck=fixedDeck?[...fixedDeck]:shuffle(deckCards(r.settings.deckType==='short'));r.results=[];r.pots=[];r.handSummary=[];r.nextAt=null;r.settlementUntil=null;r.street='preflop';r.currentBet=r.settings.bigBlind;r.minRaise=r.settings.bigBlind;
  for(const p of r.players){p.inHand=eligible(p);p.folded=false;p.hole=[];p.bet=0;p.total=0;p.acted=false;p.readyNext=false;p.handStartStack=p.stack;p.lastActBet=0;p.lastAction=p.inHand?'':'等待入座';}
  const dealer=after(r,r.dealer,eligible);r.dealer=dealer.seat;
  const sb=r.players.filter(eligible).length===2?dealer:after(r,dealer.seat,eligible);
  const bb=after(r,sb.seat,eligible);r.sb=sb.id;r.bb=bb.id;
  const dealOrder=[...ordered(r).filter(p=>eligible(p)&&p.seat>dealer.seat),...ordered(r).filter(p=>eligible(p)&&p.seat<=dealer.seat)];
  for(let i=0;i<2;i++)for(const p of dealOrder)p.hole.push(r.deck.pop());
  pay(sb,r.settings.smallBlind);sb.lastAction='小盲';pay(bb,r.settings.bigBlind);bb.lastAction='大盲';
  log(r,`第 ${r.handNo} 手 · 盲注 ${r.settings.smallBlind}/${r.settings.bigBlind}`);
  turn(r,after(r,bb.seat,p=>p.inHand&&p.stack>0),now);
  progress(r,bb.seat,now);return true;
}
export function legalActions(r,id) {
  const p=r.players.find(p=>p.id===id);
  if(!p||r.status!=='playing'||r.actorId!==id)return null;
  const due=Math.max(0,r.currentBet-p.bet),maxTo=p.bet+p.stack;
  const otherCanBet=actors(r).some(o=>o.id!==id);
  const reopened=!p.acted || p.lastAction==='过牌' || r.currentBet-p.lastActBet>=r.minRaise;
  return {canCheck:due===0,toCall:Math.min(p.stack,due),due,minTo:r.currentBet+r.minRaise,maxTo,canRaise:otherCanBet&&reopened&&maxTo>r.currentBet,canAllIn:maxTo<=r.currentBet||(otherCanBet&&reopened),currentBet:r.currentBet};
}
export function act(r,id,action,amount,now=Date.now()) {
  const legal=legalActions(r,id);if(!legal)fail('还没有轮到你行动');
  const p=r.players.find(p=>p.id===id);const openingAction=r.street==='preflop'&&p.firstActionHand!==r.handNo;let kind=action;
  if(kind==='allin'){
    if(!legal.canAllIn)fail('本轮加注尚未重新开放');
    if(legal.maxTo>r.currentBet){kind='raise';amount=legal.maxTo;}else kind='call';
  }
  if(kind==='fold'){p.folded=true;p.lastAction='弃牌';}
  else if(kind==='check'){if(!legal.canCheck)fail('需要跟注或弃牌');p.lastAction='过牌';}
  else if(kind==='call'){if(legal.due===0)fail('无需跟注，请过牌');const n=pay(p,legal.toCall);p.lastAction=p.stack===0?`全下 ${p.bet}`:`跟注 ${n}`;}
  else if(kind==='raise'){
    amount=Number(amount);
    if(!legal.canRaise)fail('当前不能加注');
    if(!Number.isSafeInteger(amount)||amount>legal.maxTo||amount<=r.currentBet)fail('加注金额无效');
    if(amount<legal.minTo&&amount!==legal.maxTo)fail(`最少加注至 ${legal.minTo}`);
    const increment=amount-r.currentBet;
    if(increment>=r.minRaise){r.minRaise=increment;for(const q of actors(r))if(q.id!==id)q.acted=false;}
    pay(p,amount-p.bet);r.currentBet=amount;p.lastAction=p.stack===0?`全下 ${amount}`:`${legal.currentBet===0?'下注':'加注至'} ${amount}`;
  }else fail('无效操作');
  p.acted=true;p.lastActBet=r.currentBet;
  if(openingAction&&!p.bot){
    p.firstActionHand=r.handNo;
    p.foldOpenStreak=action==='fold'?(p.foldOpenStreak??0)+1:0;
    p.allinOpenStreak=action==='allin'?(p.allinOpenStreak??0)+1:0;
    if(p.foldOpenStreak===0&&p.allinOpenStreak===0)p.warning=null;
    const streak=Math.max(p.foldOpenStreak,p.allinOpenStreak),kindName=p.foldOpenStreak>=p.allinOpenStreak?'连续开局弃牌':'连续开局全下';
    if(streak===3){p.warning=`${kindName}已达 3 手；若第 5 手仍持续，将由电脑接管`;log(r,`⚠ ${p.name} ${p.warning}`);}
    if(streak>=5){p.kicked=true;p.warning=`${kindName}已达 5 手，座位由电脑接管`;log(r,`⚠ ${p.name} ${p.warning}`);}
  }
  log(r,`${p.name} · ${p.lastAction}`);progress(r,p.seat,now);
}
function progress(r,lastSeat,now) {
  if(live(r).length===1){settle(r,now);return;}
  const active=actors(r);
  const needs=p=>p.inHand&&!p.folded&&p.stack>0&&(!p.acted||p.bet<r.currentBet);
  // A lone player may only match outstanding wagers, never bet into dry side pots.
  if(active.length<=1 && (!active.length||active[0].bet>=r.currentBet)){
    while(r.board.length<5){r.burn.push(r.deck.pop());draw(r,r.board.length===0?3:1);}r.street='river';settle(r,now);return;
  }
  if(active.some(needs)){turn(r,after(r,lastSeat,needs),now);return;}
  if(r.street==='river'){settle(r,now);return;}
  r.street=STREETS[STREETS.indexOf(r.street)+1];r.burn.push(r.deck.pop());draw(r,r.street==='flop'?3:1);
  r.currentBet=0;r.minRaise=r.settings.bigBlind;
  for(const p of r.players){p.bet=0;p.acted=false;p.lastActBet=0;if(p.inHand&&!p.folded&&p.stack>0)p.lastAction='';}
  turn(r,after(r,r.dealer,p=>p.inHand&&!p.folded&&p.stack>0),now);
}
export function settle(r,now=Date.now()) {
  const contenders=live(r);const payouts=new Map();const levels=[...new Set(r.players.map(p=>p.total).filter(n=>n>0))].sort((a,b)=>a-b);
  let previous=0;r.pots=[];
  for(const level of levels){
    const contributors=r.players.filter(p=>p.total>=level);
    const amount=(level-previous)*contributors.length;previous=level;
    if(contributors.length===1){const p=contributors[0];p.stack+=amount;r.pots.push({amount,winners:[p.name],refund:true});continue;}
    const eligible=contenders.filter(p=>p.total>=level);
    if(!eligible.length)fail('底池状态异常');
    let winners=eligible;
    if(eligible.length>1){const ranked=eligible.map(p=>({p,score:evaluate([...p.hole,...r.board],r.settings.deckType==='short').score}));const best=Math.max(...ranked.map(x=>x.score));winners=ranked.filter(x=>x.score===best).map(x=>x.p);}
    winners.sort((a,b)=>((a.seat-r.dealer-1+r.settings.capacity)%r.settings.capacity)-((b.seat-r.dealer-1+r.settings.capacity)%r.settings.capacity));
    const share=Math.floor(amount/winners.length);let extra=amount%winners.length;
    for(const p of winners){const n=share+(extra-->0?1:0);p.stack+=n;payouts.set(p.id,(payouts.get(p.id)??0)+n);}
    r.pots.push({amount,winners:winners.map(p=>p.name),refund:false});
  }
  r.results=[...payouts].map(([id,amount])=>{const p=r.players.find(p=>p.id===id);return {id,name:p.name,amount,hand:contenders.length>1?evaluate([...p.hole,...r.board],r.settings.deckType==='short').name:'其他玩家弃牌'};});
  r.handSummary=r.players.filter(p=>p.inHand).map(p=>({id:p.id,name:p.name,avatar:p.avatar??'',delta:p.stack-(p.handStartStack??p.stack),stack:p.stack})).sort((a,b)=>b.delta-a.delta);
  r.showCards=contenders.length>1;r.status='settlement';r.actorId=null;r.deadline=null;r.nextAt=null;r.settlementUntil=now+5000;
  for(const x of r.results)log(r,`${x.name} 赢得 ${x.amount} · ${x.hand}`);
}
export function readyNext(r,id,now=Date.now()){
  if(r.status!=='showdown')fail('请等待结算画面结束');
  const p=r.players.find(p=>p.id===id);if(!p||p.bot||p.leaving)fail('当前不能准备下一手');
  p.readyNext=true;log(r,`${p.name} 已准备下一手`);
  const required=r.players.filter(p=>!p.bot&&!p.leaving&&!p.sitOut&&now-p.lastSeen<60000);
  const eligible=r.players.filter(p=>!p.sitOut&&(p.stack>0||p.bot||p.rebuyPending));
  if(required.every(p=>p.readyNext)&&eligible.length>=2)return startHand(r,now);
  return false;
}
export function rebuy(r,id) {
  const p=r.players.find(p=>p.id===id);if(!p)fail('座位不存在');
  if(p.stack!==0)fail('筹码输光后可以补筹');
  if(r.status==='playing'&&p.inHand){p.rebuyPending=true;log(r,`${p.name} 预约下一手补筹`);return;}
  p.stack=r.settings.buyIn;p.invested+=r.settings.buyIn;p.rebuys++;p.rebuyPending=false;log(r,`${p.name} 补筹 ${r.settings.buyIn}`);
}
export function leave(r,id,now=Date.now()) {
  const p=r.players.find(p=>p.id===id);if(!p)return;
  p.leaving=true;p.sitOut=true;
  if(r.actorId===id)act(r,id,'fold',null,now);
  // Keep contributed chips in the current hand until settlement.
  else if(r.status==='playing'&&p.inHand&&!p.folded&&p.stack>0){p.folded=true;p.lastAction='离桌弃牌';if(live(r).length===1)settle(r,now);}
  if(r.status!=='playing')r.players=r.players.filter(p=>p.id!==id);
  if(r.hostId===id)r.hostId=r.players.find(q=>!q.bot&&!q.leaving)?.id??null;
  log(r,`${p.name} 离开房间`);
}
// Monte Carlo uses only this bot's cards, public cards and opponent count.
export function botDecision(r,p,random=Math.random) {
  const l=legalActions(r,p.id);if(!l)return null;
  const pot=r.players.reduce((n,q)=>n+q.total,0),opponents=live(r).length-1;
  let equity=0;
  if(p.difficulty==='easy')equity=0.2+random()*0.65;
  else {
    const known=new Set([...p.hole,...r.board]),pool=deckCards(r.settings.deckType==='short').filter(c=>!known.has(c));
    const rounds=p.difficulty==='hard'?100:28;
    for(let i=0;i<rounds;i++){
      const d=[...pool];for(let j=d.length-1;j>0;j--){const k=Math.floor(random()*(j+1));[d[j],d[k]]=[d[k],d[j]];}
      const board=[...r.board];while(board.length<5)board.push(d.pop());
      const my=evaluate([...p.hole,...board],r.settings.deckType==='short').score;let ties=1,beaten=false;
      for(let j=0;j<opponents;j++){const v=evaluate([d.pop(),d.pop(),...board],r.settings.deckType==='short').score;if(v>my){beaten=true;break;}if(v===my)ties++;}
      if(!beaten)equity+=1/ties;
    }equity/=rounds;
  }
  const odds=l.toCall/(pot+l.toCall||1),bluff=random()<(p.difficulty==='hard'?0.07:0.025);
  if(l.canRaise&&(equity>Math.max(0.55,1/(opponents+1)+0.2)||bluff)){
    const to=Math.min(l.maxTo,Math.max(l.minTo,r.currentBet+Math.round(Math.max(pot, r.settings.bigBlind*2)*(p.difficulty==='hard'?0.7:0.5))));
    return {action:'raise',amount:to};
  }
  if(l.canCheck)return {action:'check'};
  if(equity+ (p.difficulty==='easy'?0.13:0.015)>=odds)return {action:'call'};
  return {action:'fold'};
}
export function tick(r,now=Date.now()) {
  let changed=false;
  if(r.status==='playing'&&r.deadline<=now){const p=r.players.find(p=>p.id===r.actorId);if(p){const d=p.bot?botDecision(r,p):{action:legalActions(r,p.id).canCheck?'check':'fold'};act(r,p.id,d.action,d.amount,now);changed=true;}}
  if(r.status==='settlement'&&r.settlementUntil<=now){r.status='showdown';r.settlementUntil=null;changed=true;}
  return changed;
}
export function publicView(r,id,now=Date.now(),isAdmin=false) {
  const spectator=(r.spectators??[]).find(s=>s.id===id);
  const required=r.players.filter(p=>!p.bot&&!p.leaving&&!p.sitOut&&now-p.lastSeen<60000);
  return {id:r.id,settings:r.settings,hostId:r.hostId,status:r.status,handNo:r.handNo,dealer:r.dealer,sb:r.sb,bb:r.bb,board:r.board,street:r.street,currentBet:r.currentBet,actorId:r.actorId,deadline:r.deadline,nextAt:r.nextAt,settlementUntil:r.settlementUntil,handSummary:r.handSummary??[],readyCount:required.filter(p=>p.readyNext).length,requiredReady:required.length,results:r.results,pots:r.pots,logs:r.logs.slice(-30),revision:r.revision,serverNow:now,me:id,role:spectator?'spectator':'player',spectatorCount:(r.spectators??[]).filter(s=>now-s.lastSeen<15000).length,admin:isAdmin,adminActive:!!r.adminActive,legal:spectator?null:legalActions(r,id),pot:r.players.reduce((n,p)=>n+p.total,0),players:ordered(r).map(p=>({id:p.id,name:p.name,avatar:p.avatar??'',seat:p.seat,bot:p.bot,difficulty:p.difficulty,stack:p.stack,invested:p.invested,net:p.stack+p.total-p.invested,rebuys:p.rebuys,bet:p.bet,inHand:p.inHand,folded:p.folded,lastAction:p.lastAction,sitOut:p.sitOut,leaving:p.leaving,rebuyPending:p.rebuyPending,readyNext:p.readyNext,warning:p.warning,kicked:p.kicked,connected:p.bot||now-p.lastSeen<15000,hole:isAdmin||p.id===id||((r.status==='showdown'||r.status==='settlement')&&r.showCards&&p.inHand&&!p.folded)?p.hole:p.hole.map(()=>null)}))};
}
