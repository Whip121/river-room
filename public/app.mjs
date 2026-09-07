import {makeRoom,addPlayer,addSpectator,startHand,act,rebuy,leave,tick,publicView} from './engine.mjs';

const app=document.querySelector('#app');
const standalone=location.protocol==='file:' || globalThis.RIVER_STANDALONE===true;
let view=null,localRoom=null,me=null,localAdmin=false,roomCode=new URLSearchParams(location.search).get('room')?.toUpperCase()??'',secret='',busy=false,polling=false,connectionError=false,errorText='',raiseValue=null,lastTurn='',timerOffset=0;
const difficultyName={easy:'简单',medium:'中等',hard:'困难'};
const streetName={preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌'};
const suit=['♠','♥','♣','♦'];
const fmt=n=>Number(n).toLocaleString('zh-CN');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const newId=()=>crypto.randomUUID();
function readSaved(key){try{return localStorage.getItem(key)??'';}catch{return '';}}
function save(key,value){try{localStorage.setItem(key,value);}catch{}}
function toast(text){const t=document.querySelector('#toast');t.textContent=text;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3500);}
function card(c,empty=false){if(empty)return '<div class="card empty" aria-label="待发公共牌">♠</div>';if(c===null)return '<div class="card back" aria-label="隐藏底牌">♠</div>';const rank=2+Math.floor(c/4),label=({11:'J',12:'Q',13:'K',14:'A'})[rank]??rank;return `<div class="card ${c%4===1||c%4===3?'red':''}" aria-label="${suit[c%4]}${label}"><span>${label}</span><span class="suit">${suit[c%4]}</span></div>`;}
function header(){return `<header class="topbar"><div class="brand"><span class="brand-mark">♠</span><div><strong>河畔牌室</strong><small>RIVER ROOM</small></div></div><div class="top-right"><span class="tag">无限注德州扑克</span><span class="tag green"><span class="dot"></span>虚拟筹码</span>${view?'<button class="ghost small" data-action="rules">玩法说明</button>':''}</div></header>`;}
function footer(){return '<footer class="footer"><span>RIVER ROOM &nbsp; / &nbsp; 好友围桌，随时开局。</span><span>仅使用虚拟筹码 · 无充值、提现或现金兑换</span></footer>';}
function options(values,selected,labels){return values.map(v=>`<option value="${v}" ${String(v)===String(selected)?'selected':''}>${labels?labels(v):v}</option>`).join('');}
function rules(){return `<details class="rules" id="rules"><summary>牌局规则与补筹说明</summary><ol><li>长牌使用 52 张牌；短牌使用 6–A 共 36 张，A-6-7-8-9 算九高顺子，且同花大于葫芦、顺子大于三条。</li><li>每人两张底牌，与五张公共牌组合，选出最大的五张牌。庄位每手顺时针移动。</li><li>小盲、大盲自动扣除；两人桌庄家为小盲，翻牌前先行动，翻牌后后行动。</li><li>加注金额表示本轮总下注额。最低加注增量等于上一次完整加注增量；不足最低加注的全下不一定重新开放加注。</li><li>全下自动生成边池。平局分池，无法均分的零头从庄家左侧起依次分配。未被跟注的筹码退回。</li><li>输光后可补回入场筹码，正在牌局中的补筹下一手生效。电脑输光后自动补筹。</li><li>每手第一次行动连续 3 手弃牌或全下会警告；连续到第 5 手时离座并由中等电脑接管，原玩家转为观战。</li><li>房间满员后，新加入者自动观战。管理员查看模式开启时，牌桌会公开显示管理员正在查看所有底牌。</li><li>超时自动过牌；不能过牌则弃牌。离线超过一分钟会在下一手暂离。</li></ol></details>`;}
function renderLobby(){
  app.innerHTML=header()+`<main class="shell"><div class="intro"><div><div class="eyebrow">YOUR TABLE. YOUR PEOPLE.</div><h1>朋友到齐，就开一桌。</h1><p>设置人数与筹码，邀请好友；空位也可以交给电脑。</p></div><span class="tag">2–10 人 · 随时补筹</span></div>${standalone?'<div class="offline-note">当前是本机试玩版，可与电脑完整对局。联机服务启动后，同一网页支持创建房间与链接邀请。</div>':''}<div class="lobby"><section class="panel"><div class="panel-head"><h2><span class="step">01</span>创建房间</h2><span class="tag">好友桌</span></div><form id="create-form"><div class="form-grid"><div class="full"><label for="name">你的昵称</label><input id="name" name="name" maxlength="16" required autocomplete="nickname" placeholder="给牌桌上的你起个名字" value="${esc(readSaved('river-name'))}"></div><div><label for="capacity">座位数量</label><select id="capacity" name="capacity">${options([2,3,4,5,6,7,8,9,10],6,n=>n+' 人')}</select></div><div><label for="deckType">牌组类型</label><select id="deckType" name="deckType">${options(['long','short'],'long',v=>v==='long'?'长牌 · 52 张':'短牌 · 36 张')}</select></div><div><label for="buyIn">每人入场筹码</label><input id="buyIn" name="buyIn" type="number" min="100" max="1000000" step="1" value="2000" required></div><div><label for="smallBlind">小盲</label><input id="smallBlind" name="smallBlind" type="number" min="1" value="10" required></div><div><label for="bigBlind">大盲</label><input id="bigBlind" name="bigBlind" type="number" min="2" value="20" required></div><div><label for="bots">添加电脑</label><select id="bots" name="bots">${options([0,1,2,3,4,5],standalone?3:2,n=>n+' 位')}</select></div><div><label for="difficulty">电脑默认难度</label><select id="difficulty" name="difficulty">${options(['easy','medium','hard'],'medium',v=>difficultyName[v])}</select></div><div class="full"><label for="turnSeconds">每次行动时间</label><select id="turnSeconds" name="turnSeconds">${options([15,30,60],30,n=>n+' 秒')}</select><p class="hint">所有人使用相同的入场筹码。输光可补筹，下一手继续。</p></div></div>${errorText?`<div class="error-box">${esc(errorText)}</div>`:''}<button class="primary full-button" type="submit">${standalone?'创建本机牌桌':'创建房间'} &nbsp; ↗</button>${standalone?'':'<button class="sub-action" type="button" data-action="demo">先和电脑试玩</button>'}</form>${standalone?'':`<div class="divider"></div><form id="code-form"><label for="room-code">已有房间？输入房间码</label><div class="join-row"><input id="room-code" name="code" placeholder="10 位房间码" maxlength="10" required><button type="submit">加入</button></div></form>`}</section><div class="lobby-preview"><div class="table-preview"><div class="preview-outline"></div><div class="preview-top"><span>PRIVATE TABLE</span><span>♠ &nbsp; ♥ &nbsp; ♣ &nbsp; ♦</span></div><div class="preview-cards">${card(48)}${card(49)}</div><div class="preview-title">TAKE A SEAT</div><p class="preview-sub">留一个位置，给你的朋友。</p><div class="preview-chip">统一入场筹码 &nbsp; · &nbsp; 公平开局</div></div><div class="feature-row"><div class="feature"><span>↗</span><strong>链接邀请</strong><small>输入昵称，即可入座</small></div><div class="feature"><span>♣</span><strong>三档电脑</strong><small>简单、中等、困难</small></div><div class="feature"><span>↻</span><strong>输光可补</strong><small>下一手，继续对战</small></div></div>${rules()}</div></div>${footer()}</main>`;
}
function renderJoin(){app.innerHTML=header()+`<main class="shell"><section class="panel join-panel"><div class="eyebrow">YOU'RE INVITED</div><h1>牌桌给你留了位置。</h1><p>房间 <strong>${esc(roomCode)}</strong><br>输入昵称加入，筹码与其他玩家一致；座位已满时会自动进入观战。</p><form id="join-form"><label for="join-name">你的昵称</label><input id="join-name" name="name" required maxlength="16" value="${esc(readSaved('river-name'))}" placeholder="输入昵称">${errorText?`<div class="error-box">${esc(errorText)}</div>`:''}<button class="primary full-button" type="submit">加入牌桌 &nbsp; ↗</button><button type="button" class="sub-action" data-action="home">返回创建房间</button></form></section>${footer()}</main>`;}
function renderSeat(p,index,count){
  const theta=index/count*Math.PI*2,x=50+42*Math.sin(theta),y=50+39*Math.cos(theta),style=`--x:${x}%;--y:${y}%`;
  if(!p)return `<div class="seat" style="${style}"><div class="empty-seat"><span>＋</span>等待入座</div></div>`;
  const self=p.id===view.me,active=p.id===view.actorId;
  let note=p.leaving?'已离桌':p.sitOut?'下一手暂离':!p.connected?'连接中…':p.rebuyPending?'已预约补筹':p.stack===0&&p.inHand&&!p.folded&&view.status==='playing'?'已全下':p.stack===0?'等待补筹':p.lastAction||(!p.inHand&&view.status!=='waiting'?'下一手入座':p.bot?difficultyName[p.difficulty]+'电脑':'已入座');
  return `<div class="seat ${self?'self':''} ${active?'active':''} ${p.folded?'folded':''}" style="${style}"><div class="seat-body"><div class="avatar">${p.bot?'AI':esc(p.name.slice(0,1))}</div><div class="seat-name" title="${esc(p.name)}">${esc(p.name)}${self?' · 你':''}</div><div class="stack">${fmt(p.stack)}</div><div class="net ${p.net>=0?'win':'loss'}">${p.net>=0?'+':''}${fmt(p.net)}</div>${p.seat===view.dealer?'<span class="position-marker" title="庄家">D</span>':''}${p.id===view.sb||p.id===view.bb?`<span class="position-marker blind">${p.id===view.sb?'SB':'BB'}</span>`:''}</div>${p.hole.length?`<div class="hole">${p.hole.map(c=>card(c)).join('')}</div>`:''}<div class="seat-note">${active?'<span data-countdown></span> 秒 · 思考中':esc(note)}</div>${p.warning?`<div class="warning-note">⚠ ${esc(p.warning)}</div>`:''}${p.bet&&view.status==='playing'?`<div class="bet-tag">● 本轮 ${fmt(p.bet)}</div>`:''}</div>`;
}
function actionsHTML(){
  const p=view.players.find(p=>p.id===view.me),l=view.legal,host=view.hostId===view.me;
  if(view.role==='spectator')return '<div class="waiting-actions"><div><h3>你正在观战</h3><p>房间已满，你可以观看公共牌和公开行动，但不能下注。</p></div></div>';
  if(!p)return '';
  if(l){const key=`${view.handNo}-${view.street}-${view.actorId}-${view.currentBet}`;if(key!==lastTurn){raiseValue=Math.min(l.minTo,l.maxTo);lastTurn=key;}
    return `<div class="action-head"><strong>轮到你行动 <span data-countdown></span>s</strong><span class="muted">可用筹码 ${fmt(p.stack)}</span></div><div class="action-buttons"><button class="danger" data-action="fold">弃牌</button><button class="primary" data-action="${l.canCheck?'check':'call'}">${l.canCheck?'过牌':'跟注 '+fmt(l.toCall)}</button><button data-action="allin" ${l.canAllIn?'':'disabled'}>全下 ${fmt(p.stack)}</button></div>${l.canRaise?`<div class="raise-row"><label for="raise-amount">加注至</label><input id="raise-amount" aria-label="加注至本轮总额" type="number" min="${Math.min(l.minTo,l.maxTo)}" max="${l.maxTo}" step="1" value="${raiseValue}"><button class="gold" data-action="raise">${l.currentBet?'加注':'下注'} ↗</button><div class="presets"><button class="small ghost" data-action="preset" data-fraction="0">最小</button><button class="small ghost" data-action="preset" data-fraction="0.5">½ 底池</button><button class="small ghost" data-action="preset" data-fraction="1">底池</button></div></div>`:'<p class="hint">当前仅可跟注、过牌或弃牌；全下按钮只在规则允许时可用。</p>'}`;
  }
  const status=view.status==='waiting'?'等待开局':view.status==='showdown'?'本手结束':'等待其他玩家行动';
  return `<div class="waiting-actions"><div><h3>${p.sitOut?'你正在暂离':status}</h3><p>${view.status==='waiting'?'至少两人即可开局，房主可添加电脑。':view.status==='showdown'?'下一手将在 '+Math.max(0,Math.ceil((view.nextAt-Date.now()-timerOffset)/1000))+' 秒后开始。':!p.inHand?'你将在下一手入座。':p.folded?'你已弃牌，下一手继续。':'留意牌桌上的行动提示。'}</p></div>${p.stack===0?`<button class="gold" data-action="rebuy" ${p.rebuyPending?'disabled':''}>${p.rebuyPending?'已预约下一手补筹':'补筹 '+fmt(view.settings.buyIn)}</button>`:p.sitOut?'<button class="primary" data-action="sitOut">返回牌桌</button>':host&&view.status!=='playing'?`<button class="primary" data-action="start">${view.status==='waiting'?'开始对局':'开始下一手'} ↗</button>`:''}</div>`;
}
function renderRoom(){
  const r=view,p=r.players.find(p=>p.id===r.me)??{id:r.me,name:'观战者',seat:0,sitOut:false,invested:0,rebuys:0,stack:0};
  const host=r.hostId===r.me,count=r.settings.capacity,origin=p.seat;
  const seats=Array.from({length:count},(_,i)=>r.players.find(p=>p.seat===(origin+i)%count));
  app.innerHTML=header()+`<main class="shell"><div class="room-heading"><div><h1>${localRoom?'本机试玩桌':'好友对战房间'} <span class="tag green">${r.players.length}/${count} 人</span></h1><div class="subline"><span>${localRoom?'仅当前页面':`房间 ${esc(r.id)}`}</span><span>·</span><span>无限注 · 可补筹 · ${r.settings.deckType==='short'?'短牌 36 张':'长牌 52 张'}</span><span class="connection">${connectionError?'连接中，正在自动重试…':localRoom?'本机模式': '● 已连接'}</span></div></div><div class="room-tools"><button data-action="invite" ${localRoom?'disabled title="本机试玩不支持邀请"':''}>↗ 复制邀请链接</button><button class="ghost" data-action="admin">${r.admin?'管理员已开启':'管理员模式'}</button>${r.role==='player'?`<button class="ghost" data-action="sitOut">${p.sitOut?'返回牌桌':'下手暂离'}</button>`:''}<button class="ghost" data-action="leave">离开</button></div></div>${localRoom?'<div class="offline-note">本机试玩 · 对手为电脑，当前页面不会连接其他玩家。联机请使用运行中的网页服务创建房间。</div>':''}${r.adminActive?'<div class="admin-banner">⚠ 本房间有管理员正在查看所有玩家底牌</div>':''}${r.role==='spectator'?'<div class="spectator-banner">👁 当前以观战身份进入，不能参与下注</div>':''}<div class="game-grid"><div class="game-left"><div class="table-surface"><div class="felt"></div><div class="table-brand">RIVER ROOM &nbsp; ♠</div><div class="board-area"><div class="pot"><small>${r.status==='showdown'?'本手总底池':'当前底池'}</small>${fmt(r.pot)}</div><div class="community">${Array.from({length:5},(_,i)=>card(r.board[i],r.board[i]===undefined)).join('')}</div><div class="street-label">${r.status==='waiting'?'等待房主开局':r.status==='showdown'?'摊牌结算':streetName[r.street]} &nbsp; / &nbsp; 第 ${r.handNo||'—'} 手</div></div><div class="seats">${seats.map((q,i)=>renderSeat(q,i,count)).join('')}</div></div><div class="status-strip"><span>盲注 <strong>${fmt(r.settings.smallBlind)} / ${fmt(r.settings.bigBlind)}</strong></span><span>入场筹码 ${fmt(r.settings.buyIn)} · ${r.settings.turnSeconds} 秒行动</span></div><section class="actions" aria-label="你的行动">${actionsHTML()}</section>${r.status==='showdown'?`<div class="summary" role="status">${r.results.map(x=>`<strong>${esc(x.name)}</strong> 赢得 <strong>${fmt(x.amount)}</strong> · ${esc(x.hand)}`).join('<br>')}${r.pots.length>1?'<br>'+r.pots.map((pot,i)=>`${pot.refund?'退回未跟注筹码':i===0?'主池':'边池 '+i} ${fmt(pot.amount)} → ${pot.winners.map(esc).join('、')}`).join('<br>'):''}</div>`:''}${rules()}</div><aside class="sidebar"><section class="panel"><h2>牌桌设置 <span class="tag">${host?'你是房主':'好友房'}</span></h2><dl class="facts"><div><dt>座位</dt><dd>${count} 人桌</dd></div><div><dt>筹码制度</dt><dd>输光可补筹</dd></div><div><dt>你的累计带入</dt><dd>${fmt(p.invested)}</dd></div><div><dt>你的补筹次数</dt><dd>${p.rebuys} 次</dd></div></dl></section><section class="panel"><div class="panel-head" style="margin:0"><h2>在座玩家</h2><small>${r.players.length} / ${count} · ${r.spectatorCount} 人观战</small></div><div class="roster">${r.players.map(q=>`<div class="roster-row"><span class="avatar">${q.bot?'AI':esc(q.name.slice(0,1))}</span><div class="roster-name">${esc(q.name)}${q.id===r.hostId?' ♛':''}<small>${q.bot?difficultyName[q.difficulty]+'电脑':q.id===r.me?'你':q.connected?'在线':'离线'} · <span class="${q.net>=0?'win':'loss'}">${q.net>=0?'+':''}${fmt(q.net)}</span></small></div>${q.bot&&host?`<select aria-label="${esc(q.name)}难度" data-bot-id="${q.id}" ${r.status==='playing'?'disabled':''}>${options(['easy','medium','hard'],q.difficulty,d=>difficultyName[d])}</select><button class="ghost small" aria-label="移除${esc(q.name)}" data-action="removeBot" data-player-id="${q.id}" ${r.status==='playing'?'disabled':''}>×</button>`:''}</div>`).join('')}</div>${host?`<div class="bot-add"><select id="new-bot-difficulty" aria-label="新电脑难度">${options(['easy','medium','hard'],'medium',d=>difficultyName[d])}</select><button class="small" data-action="addBot" ${r.players.length>=count?'disabled':''}>＋ 电脑</button></div>`:''}</section><section class="panel"><h2>牌局记录</h2><div class="history">${r.logs.length?[...r.logs].reverse().map(x=>`<p><span>#${x.hand||'—'}</span>${esc(x.text)}</p>`).join(''):'<p class="muted">开局后，行动记录显示在这里。</p>'}</div></section></aside></div>${footer()}</main>`;
  updateClock();
}
function render(){if(view)renderRoom();else if(roomCode&&!standalone)renderJoin();else renderLobby();}
function updateClock(){if(!view)return;const n=Math.max(0,Math.ceil((view.deadline-Date.now()-timerOffset)/1000));document.querySelectorAll('[data-countdown]').forEach(e=>e.textContent=n);}
async function request(endpoint,body){const response=await fetch(endpoint,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(secret?{Authorization:'Bearer '+secret}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok){const e=new Error(data.error||'连接失败，请稍后重试');e.status=response.status;throw e;}return data;}
function accept(next,force=false){if(view&&next.id===view.id&&next.revision<view.revision)return;timerOffset=next.serverNow-Date.now();const changed=force||!view||view.revision!==next.revision||view.actorId!==next.actorId||connectionError;view=next;connectionError=false;if(changed)renderRoom();else updateClock();}
async function poll(){if(!view||localRoom||polling||busy)return;polling=true;try{const d=await request(`/api/rooms/${roomCode}`);accept(d.view);}catch(e){if(e.status===401){view=null;secret='';errorText=e.message;render();}else if(!connectionError){connectionError=true;renderRoom();}}finally{polling=false;}}
function startLocal(b){roomCode='LOCAL';me=newId();localRoom=makeRoom(roomCode,b.settings);addPlayer(localRoom,me,b.name);const n=Math.max(0,Math.min(Number(b.bots),localRoom.settings.capacity-1));for(let i=0;i<n;i++)addPlayer(localRoom,newId(),`电脑 ${i+1}`,{bot:true,difficulty:b.difficulty});accept(publicView(localRoom,me,Date.now(),localAdmin),true);}
async function command(action,extra={}){
  if(busy||!view)return;busy=true;
  try{
    if(action==='allin'&&!confirm(`确认全下 ${fmt(view.players.find(p=>p.id===view.me).stack)} 筹码？`))return;
    if(action==='leave'&&!confirm('确定离开房间？未结束的手牌会弃牌；重新加入将获得新座位。'))return;
    if(localRoom){
      if(['fold','check','call','raise','allin'].includes(action)){
        act(localRoom,me,action,extra.amount);
        const kicked=localRoom.players.find(p=>p.id===me&&p.kicked);
        if(kicked){const botId=newId(),originalName=kicked.name;kicked.id=botId;kicked.name=`${originalName} · 托管`;kicked.bot=true;kicked.difficulty='medium';kicked.kicked=false;if(localRoom.actorId===me)localRoom.actorId=botId;if(localRoom.sb===me)localRoom.sb=botId;if(localRoom.bb===me)localRoom.bb=botId;if(localRoom.hostId===me)localRoom.hostId=localRoom.players.find(p=>!p.bot&&p.id!==botId)?.id??null;addSpectator(localRoom,me,originalName);localAdmin=false;localRoom.adminActive=false;}
      }
      else if(action==='admin'){if(extra.password!=='126399')throw new Error('管理员密码错误');localAdmin=true;localRoom.adminActive=true;}
      else if(action==='start'){if(!startHand(localRoom))throw new Error('至少需要两位有筹码、未暂离的玩家');}
      else if(action==='rebuy')rebuy(localRoom,me);
      else if(action==='addBot'){let n=1;while(localRoom.players.some(p=>p.name===`电脑 ${n}`))n++;addPlayer(localRoom,newId(),`电脑 ${n}`,{bot:true,difficulty:extra.difficulty});}
      else if(action==='difficulty'){if(localRoom.status==='playing')throw new Error('本手结束后可调整');localRoom.players.find(p=>p.id===extra.playerId).difficulty=extra.difficulty;}
      else if(action==='removeBot'){if(localRoom.status==='playing')throw new Error('本手结束后可移除');localRoom.players=localRoom.players.filter(p=>p.id!==extra.playerId);}
      else if(action==='sitOut'){const p=localRoom.players.find(p=>p.id===me);p.sitOut=!p.sitOut;}
      else if(action==='leave'){goHome();return;}
      localRoom.revision++;accept(publicView(localRoom,me,Date.now(),localAdmin),true);
    }else{const d=await request(`/api/rooms/${roomCode}/action`,{action,...extra,handNo:view.handNo,revision:view.revision});if(action==='leave'){save('river-token-'+roomCode,'');goHome();return;}accept(d.view,true);}
  }catch(e){toast(e.message);}finally{busy=false;poll();}
}
function goHome(){view=null;localRoom=null;roomCode='';secret='';errorText='';if(!standalone)history.replaceState(null,'',location.pathname);render();}
app.addEventListener('input',e=>{if(e.target.id==='raise-amount')raiseValue=Number(e.target.value);});
app.addEventListener('change',e=>{
  if(e.target.id==='capacity'){const b=document.querySelector('#bots'),n=Number(e.target.value);b.innerHTML=options(Array.from({length:n},(_,i)=>i),Math.min(Number(b.value),n-1),v=>v+' 位');}
  if(e.target.dataset.botId)command('difficulty',{playerId:e.target.dataset.botId,difficulty:e.target.value});
});
app.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(e.target));
  if(e.target.id==='code-form'){roomCode=data.code.trim().toUpperCase();if(!/^[A-Z0-9]{10}$/.test(roomCode)){toast('请输入 10 位房间码');return;}history.replaceState(null,'','?room='+roomCode);errorText='';render();return;}
  busy=true;const button=e.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
  try{
    if(e.target.id==='create-form'){
      save('river-name',data.name);const b={name:data.name,settings:{capacity:Number(data.capacity),buyIn:Number(data.buyIn),smallBlind:Number(data.smallBlind),bigBlind:Number(data.bigBlind),turnSeconds:Number(data.turnSeconds),deckType:data.deckType},bots:Number(data.bots),difficulty:data.difficulty};
      if(standalone){startLocal(b);return;}
      const d=await request('/api/rooms',b);roomCode=d.view.id;secret=d.token;save('river-token-'+roomCode,secret);history.replaceState(null,'','?room='+roomCode);accept(d.view,true);
    }else if(e.target.id==='join-form'){
      save('river-name',data.name);secret='';const d=await request(`/api/rooms/${roomCode}/join`,{name:data.name});secret=d.token;save('river-token-'+roomCode,secret);accept(d.view,true);if(d.watching)toast('房间已满，已自动进入观战');
    }
  }catch(err){toast(err.message==='Failed to fetch'?'联机服务未启动，可先和电脑试玩。':err.message);}finally{busy=false;if(button)button.disabled=false;}
});
app.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action;
  if(action==='home'){goHome();return;}
  if(action==='rules'){const d=document.querySelector('#rules');d.open=true;d.scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(action==='demo'){
    const form=document.querySelector('#create-form');if(!form.reportValidity())return;const d=Object.fromEntries(new FormData(form));try{startLocal({name:d.name,settings:{capacity:Number(d.capacity),buyIn:Number(d.buyIn),smallBlind:Number(d.smallBlind),bigBlind:Number(d.bigBlind),turnSeconds:Number(d.turnSeconds),deckType:d.deckType},bots:Math.max(1,Number(d.bots)),difficulty:d.difficulty});}catch(err){toast(err.message);}return;
  }
  if(action==='admin'){const password=prompt('请输入管理员密码');if(password!==null)await command('admin',{password});return;}
  if(action==='invite'){const url=new URL(location.href);url.search='?room='+roomCode;try{await navigator.clipboard.writeText(url.href);toast('邀请链接已复制，发给朋友即可加入');}catch{prompt('复制这个链接邀请朋友：',url.href);}return;}
  if(action==='preset'){const l=view.legal,n=Number(button.dataset.fraction);raiseValue=Math.min(l.maxTo,Math.max(l.minTo,l.currentBet+Math.round((view.pot+l.toCall)*n)));document.querySelector('#raise-amount').value=raiseValue;return;}
  await command(action,action==='raise'?{amount:Number(document.querySelector('#raise-amount').value)}:action==='addBot'?{difficulty:document.querySelector('#new-bot-difficulty').value}:action==='removeBot'?{playerId:button.dataset.playerId}:{});
});
setInterval(()=>{
  if(localRoom&&!busy){try{const localSelf=localRoom.players.find(p=>p.id===me)??localRoom.spectators.find(s=>s.id===me);if(localSelf)localSelf.lastSeen=Date.now();if(tick(localRoom)){localRoom.revision++;accept(publicView(localRoom,me,Date.now(),localAdmin),true);}}catch(e){toast('牌局更新失败：'+e.message);}}
  updateClock();
},350);
setInterval(poll,1000);
if(roomCode&&!standalone){secret=readSaved('river-token-'+roomCode);if(secret){try{const d=await request(`/api/rooms/${roomCode}`);accept(d.view,true);}catch(e){errorText=e.message;render();}}else render();}else render();

// A small optional agent surface: read the visible table or make a legal poker action.
if(document.modelContext?.registerTool){
  try {Promise.resolve(document.modelContext.registerTool({name:'read_poker_table',description:'Read only the cards and actions visible to the current player.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async()=>({content:[{type:'text',text:JSON.stringify(view??{status:'lobby'})}]})})).catch(()=>{});} catch {}
}
