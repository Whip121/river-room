import assert from 'node:assert/strict';
export async function runHTTPChecks(origin='http://localhost:3000'){
  const request=async(route,data,token)=>{const res=await fetch(origin+route,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,data:await res.json()};};
  const created=await request('/api/rooms',{name:'测试房主',settings:{capacity:3,buyIn:1000,smallBlind:5,bigBlind:10,turnSeconds:60},bots:0});assert.equal(created.status,201);
  const room=created.data.view.id,owner=created.data.token,ownerId=created.data.view.me;
  const joined=await request(`/api/rooms/${room}/join`,{name:'测试好友'});assert.equal(joined.status,200);const guest=joined.data.token,guestId=joined.data.view.me;
  assert.equal(joined.data.view.players[0].stack,joined.data.view.players[1].stack);
  const unauthorized=await request(`/api/rooms/${room}`);assert.equal(unauthorized.status,401);
  const illegalStart=await request(`/api/rooms/${room}/action`,{action:'start'},guest);assert.equal(illegalStart.status,403);
  const started=await request(`/api/rooms/${room}/action`,{action:'start'},owner);assert.equal(started.status,200);let current=started.data.view;
  assert(current.players.find(p=>p.id===ownerId).hole.every(Number.isInteger));assert.equal(JSON.stringify(current.players.find(p=>p.id===guestId).hole),'[null,null]');assert(!('deck'in current));
  const guestView=await request(`/api/rooms/${room}`,null,guest);assert.equal(JSON.stringify(guestView.data.view.players.find(p=>p.id===ownerId).hole),'[null,null]');assert(guestView.data.view.players.find(p=>p.id===guestId).hole.every(Number.isInteger));
  const bad=await request(`/api/rooms/${room}/action`,{action:'raise',amount:11,handNo:current.handNo,revision:current.revision},owner);assert.equal(bad.status,400);
  const good=await request(`/api/rooms/${room}/action`,{action:'call',handNo:current.handNo,revision:current.revision},owner);assert.equal(good.status,200);current=good.data.view;
  const duplicate=await request(`/api/rooms/${room}/action`,{action:'call',handNo:current.handNo,revision:current.revision-1},owner);assert.equal(duplicate.status,409);
  current=(await request(`/api/rooms/${room}`,null,guest)).data.view;
  const check=await request(`/api/rooms/${room}/action`,{action:'check',handNo:current.handNo,revision:current.revision},guest);assert.equal(check.status,200);assert.equal(check.data.view.street,'flop');
  const resume=await request(`/api/rooms/${room}`,null,owner);assert.equal(resume.data.view.me,ownerId);assert.equal(resume.data.view.handNo,1);
  const left=await request(`/api/rooms/${room}/action`,{action:'leave'},owner);assert.equal(left.status,200);assert.equal(left.data.view.hostId,guestId);
  const bot=await request(`/api/rooms/${room}/action`,{action:'addBot',difficulty:'hard'},guest);assert.equal(bot.status,200);const botId=bot.data.view.players.find(p=>p.bot).id;
  const removed=await request(`/api/rooms/${room}/action`,{action:'removeBot',playerId:botId},guest);assert.equal(removed.status,200);assert.equal(removed.data.view.players.length,1);assert.equal(removed.data.view.players[0].id,guestId);
  await request(`/api/rooms/${room}/action`,{action:'leave'},guest);
  const full=await request('/api/rooms',{name:'满桌房主',settings:{capacity:2,buyIn:1000,smallBlind:5,bigBlind:10,turnSeconds:60,deckType:'short'},bots:1});const fullRoom=full.data.view.id;
  const watched=await request(`/api/rooms/${fullRoom}/join`,{name:'观众'});assert.equal(watched.data.watching,true);assert.equal(watched.data.view.role,'spectator');assert.equal(watched.data.view.settings.deckType,'short');
  const admin=await request(`/api/rooms/${fullRoom}/action`,{action:'admin',password:'126399'},watched.data.token);assert.equal(admin.status,200);assert.equal(admin.data.view.admin,true);assert.equal(admin.data.view.adminActive,true);
  const startedFull=await request(`/api/rooms/${fullRoom}/action`,{action:'start'},full.data.token);assert.equal(startedFull.status,200);const adminCards=await request(`/api/rooms/${fullRoom}`,null,watched.data.token);assert(adminCards.data.view.players.every(p=>p.hole.every(Number.isInteger)));
  const publicCards=await request(`/api/rooms/${fullRoom}`,null,full.data.token);assert(publicCards.data.view.players.find(p=>p.bot).hole.every(c=>c===null));assert.equal(publicCards.data.view.adminActive,true);
  return {room,checks:['双人独立会话加入','统一入场筹码','未登录访问拒绝','房主权限','双方底牌隔离','非法下注拒绝','重复操作拒绝','跨客户端轮流行动','会话恢复','房主转交','电脑添加与移除','满桌自动观战','管理员查看与公开提示','短牌房间设置']};
}
