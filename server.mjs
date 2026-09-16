import http from 'node:http';
import {readFile,writeFile,rename,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,createHash,webcrypto} from 'node:crypto';
import {makeRoom,addPlayer,addSpectator,startHand,readyNext,act,rebuy,leave,tick,publicView,log} from './public/engine.mjs';

globalThis.crypto ??= webcrypto;
const base=path.dirname(fileURLToPath(import.meta.url));
const runtimeEnv=typeof process==='undefined'?{}:process.env;
const dataDir=runtimeEnv.DATA_DIR?path.resolve(runtimeEnv.DATA_DIR):path.join(base,'data');
const publicDir=path.join(base,'public');
const rooms=new Map(),queues=new Map(),rates=new Map();
await mkdir(dataDir,{recursive:true});
function normalize(record){record.sessions??={};record.admins??={};record.room.spectators??=[];record.room.adminActive??=false;record.room.settings.deckType??='long';record.room.settings.tableShape??='oval';record.room.handSummary??=[];record.room.settlementUntil??=null;for(const p of record.room.players){p.avatar??='';p.readyNext??=false;p.handStartStack??=p.stack;p.firstActionHand??=0;p.foldOpenStreak??=0;p.allinOpenStreak??=0;p.warning??=null;p.kicked??=false;}for(const s of record.room.spectators)s.avatar??='';return record;}
for(const name of await readdir(dataDir))if(/^[A-Z0-9]{10}\.json$/.test(name)){
  try {const record=normalize(JSON.parse(await readFile(path.join(dataDir,name),'utf8')));rooms.set(record.room.id,record);}catch{console.error('Could not restore room file:',name);}
}
const sha=s=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const uid=()=>randomBytes(12).toString('hex');
function serial(id,fn){const p=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(fn);queues.set(id,p);p.finally(()=>{if(queues.get(id)===p)queues.delete(id);}).catch(()=>{});return p;}
async function save(record){const target=path.join(dataDir,`${record.room.id}.json`);await writeFile(target+'.tmp',JSON.stringify(record),{mode:0o600});await rename(target+'.tmp',target);rooms.set(record.room.id,record);}
function problem(message,status=400){const e=new Error(message);e.status=status;throw e;}
function authenticate(record,req){const raw=req.headers.authorization?.replace(/^Bearer /,'');const key=raw&&sha(raw),id=key&&record.sessions[key];if(!id||(!record.room.players.some(p=>p.id===id&&!p.leaving)&&!record.room.spectators.some(s=>s.id===id)))problem('请重新加入房间',401);return {id,key};}
const viewFor=(record,id,now=Date.now())=>publicView(record.room,id,now,!!record.admins[id]);
function host(r,id){if(r.hostId!==id)problem('只有房主可以操作',403);}
function rate(req,limit=100){const key=req.socket.remoteAddress??'local',now=Date.now();let item=rates.get(key);if(!item||now>item.until){item={n:0,until:now+60000};rates.set(key,item);}if(++item.n>limit)problem('操作太频繁，请稍后再试',429);}
async function body(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>180000)problem('请求过大',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{problem('请求格式无效');}}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function api(req,res,url){
  if(req.method==='POST'){
    rate(req,200);
    const origin=req.headers.origin;
    if(origin&&new URL(origin).host!==req.headers.host)problem('来源不受信任',403);
  }
  if(url.pathname==='/api/rooms'&&req.method==='POST'){
    if(rooms.size>=200)problem('当前房间数量已达上限',503);
    const b=await body(req);let code;do{code=randomBytes(6).toString('hex').slice(0,10).toUpperCase();}while(rooms.has(code));
    const r=makeRoom(code,b.settings),id=uid(),secret=token();addPlayer(r,id,b.name,{avatar:b.avatar});
    const count=Number(b.bots??0);if(!Number.isInteger(count)||count<0||count>=r.settings.capacity)problem('电脑人数无效');
    for(let i=0;i<count;i++)addPlayer(r,uid(),`电脑 ${i+1}`,{bot:true,difficulty:b.difficulty??'medium'});
    await save({room:r,sessions:{[sha(secret)]:id},admins:{}});json(res,201,{token:secret,view:publicView(r,id)});return;
  }
  const match=url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{10})(?:\/(join|action))?$/);
  if(!match)problem('接口不存在',404);
  const [,code,op]=match,b=req.method==='POST'?await body(req):null;
  await serial(code,async()=>{
    const original=rooms.get(code);if(!original)problem('房间不存在，请检查链接',404);
    const record=structuredClone(original),r=record.room,now=Date.now();let id;
    if(op==='join'&&req.method==='POST'){
      const secret=token();id=uid();const watching=r.players.length>=r.settings.capacity;
      if(watching)addSpectator(r,id,b.name,{avatar:b.avatar,now});else addPlayer(r,id,b.name,{avatar:b.avatar,now});
      record.sessions[sha(secret)]=id;r.revision++;r.updatedAt=now;
      await save(record);json(res,200,{token:secret,view:viewFor(record,id),watching});return;
    }
    const auth=authenticate(record,req);id=auth.id;const me=r.players.find(p=>p.id===id)??r.spectators.find(s=>s.id===id);const needsHeartbeat=now-me.lastSeen>5000;me.lastSeen=now;
    let changed=false;
    if(!op&&req.method==='GET'){changed=tick(r,now);}
    else if(op==='action'&&req.method==='POST'){
      // Check the deadline before accepting a late client action.
      changed=tick(r,now);
      if(['fold','check','call','raise','allin'].includes(b.action)){
        if(!r.players.some(p=>p.id===id))problem('观战者不能参与下注',403);
        if(!Number.isInteger(b.handNo)||b.handNo!==r.handNo)problem('牌局已更新，请重试',409);
        if(b.revision!==original.room.revision||changed){r.revision++;r.updatedAt=now;await save(record);problem('牌局已更新，请按当前状态操作',409);}
        act(r,id,b.action,b.amount,now);
        const kicked=r.players.find(p=>p.id===id&&p.kicked);
        if(kicked){const botId=uid(),spectatorId=uid(),originalName=kicked.name;kicked.id=botId;kicked.name=`${originalName} · 托管`;kicked.bot=true;kicked.difficulty='medium';kicked.kicked=false;if(r.actorId===id)r.actorId=botId;if(r.sb===id)r.sb=botId;if(r.bb===id)r.bb=botId;if(r.hostId===id)r.hostId=r.players.find(p=>!p.bot&&p.id!==botId)?.id??null;addSpectator(r,spectatorId,originalName,{now});record.sessions[auth.key]=spectatorId;delete record.admins[id];r.adminActive=Object.keys(record.admins).length>0;id=spectatorId;}
      }else if(b.action==='admin'){
        if(String(b.password)!=='126399')problem('管理员密码错误',403);record.admins[id]=true;r.adminActive=true;log(r,'管理员查看模式已开启，所有在场人员均可看到此提示');
      }else if(b.action==='adminClose'){
        if(!record.admins[id])problem('管理员模式尚未开启');delete record.admins[id];r.adminActive=Object.keys(record.admins).length>0;log(r,'一位管理员已关闭查看模式');
      }else if(b.action==='ready'){
        if(!r.players.some(p=>p.id===id))problem('观战者无需准备',403);readyNext(r,id,now);
      }else if(b.action==='start'){host(r,id);if(r.status!=='waiting')problem('请等待所有玩家准备下一手');if(!startHand(r,now))problem('至少需要两位有筹码、未暂离的玩家');}
      else if(b.action==='rebuy')rebuy(r,id);
      else if(b.action==='addBot'){
        host(r,id);let n=1;while(r.players.some(p=>p.name===`电脑 ${n}`))n++;addPlayer(r,uid(),`电脑 ${n}`,{bot:true,difficulty:b.difficulty??'medium'});
      }else if(b.action==='removeBot'){
        host(r,id);if(r.status==='playing')problem('请在本手结束后移除电脑');const target=r.players.find(p=>p.id===b.playerId&&p.bot);if(!target)problem('电脑不存在');r.players=r.players.filter(p=>p.id!==target.id);
      }else if(b.action==='difficulty'){
        host(r,id);if(r.status==='playing')problem('请在本手结束后调整难度');const p=r.players.find(p=>p.id===b.playerId&&p.bot);if(!p||!['easy','medium','hard'].includes(b.difficulty))problem('难度无效');p.difficulty=b.difficulty;
      }else if(b.action==='sitOut'){if(!r.players.some(p=>p.id===id))problem('观战者没有座位');me.sitOut=!me.sitOut;log(r,`${me.name} ${me.sitOut?'将在下一手暂离':'返回牌桌'}`);}
      else if(b.action==='leave'){if(r.players.some(p=>p.id===id))leave(r,id,now);else r.spectators=r.spectators.filter(s=>s.id!==id);delete record.sessions[auth.key];delete record.admins[id];r.adminActive=Object.keys(record.admins).length>0;}
      else problem('无效操作');
      changed=true;
    }else problem('请求方法无效',405);
    if(changed){r.revision++;r.updatedAt=now;}
    if(changed||needsHeartbeat)await save(record);
    json(res,200,{view:viewFor(record,id,now)});
  });
}
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
export const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){await api(req,res,url);return;}
    if(!['GET','HEAD'].includes(req.method))problem('请求方法无效',405);
    const assets={'/':'index.html','/app.mjs':'app.mjs','/engine.mjs':'engine.mjs','/style.css':'style.css','/favicon.svg':'favicon.svg'};
    const file=assets[url.pathname];if(!file)problem('页面不存在',404);
    const content=await readFile(path.join(publicDir,file));res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
  }catch(e){if(!res.headersSent)json(res,e.status??400,{error:e.status===500?'服务暂时不可用':e.message});else res.end();}
});
setInterval(()=>{
  for(const [code,record]of rooms){
    const r=record.room;if(r.status!=='playing'&&r.status!=='showdown')continue;
    if(!r.players.some(p=>!p.bot&&!p.leaving&&Date.now()-p.lastSeen<90000)&&!r.spectators.some(s=>Date.now()-s.lastSeen<90000))continue;
    serial(code,async()=>{const next=structuredClone(rooms.get(code));if(tick(next.room)){next.room.revision++;next.room.updatedAt=Date.now();await save(next);}}).catch(e=>console.error('Room update failed:',e.message));
  }
  for(const [key,value]of rates)if(value.until<Date.now())rates.delete(key);
},500).unref();
const port=Number(runtimeEnv.PORT??3000);server.listen(port,runtimeEnv.HOST??'0.0.0.0',()=>console.log(`River Room running: http://localhost:${port}`));
