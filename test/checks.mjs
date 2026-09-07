import assert from 'node:assert/strict';
import * as E from '../public/engine.mjs';
const c=(rank,suit=0)=>(rank-2)*4+suit;
function table(n=3,stacks){const r=E.makeRoom('TESTROOM',{capacity:n,buyIn:2000});for(let i=0;i<n;i++)E.addPlayer(r,String(i),'玩家'+i);if(stacks)r.players.forEach((p,i)=>p.stack=stacks[i]);return r;}
export async function runChecks(){
  const passed=[];const test=(name,fn)=>{fn();passed.push(name);};
  test('九类牌型与五张最优组合',()=>{
    const examples=[[[14,0],[11,1],[9,2],[5,3],[2,0]],[[14,0],[14,1],[9,2],[5,3],[2,0]],[[14,0],[14,1],[9,2],[9,3],[2,0]],[[14,0],[14,1],[14,2],[5,3],[2,0]],[[6,0],[5,1],[4,2],[3,3],[2,0]],[[14,0],[11,0],[9,0],[5,0],[2,0]],[[14,0],[14,1],[14,2],[5,3],[5,0]],[[14,0],[14,1],[14,2],[14,3],[2,0]],[[14,0],[13,0],[12,0],[11,0],[10,0]]];
    examples.forEach((cs,i)=>assert.equal(E.evaluate(cs.map(x=>c(...x))).category,i));
    assert.equal(E.evaluate([c(14),c(14,1),c(14,2),c(13),c(13,1),c(13,2),c(2)]).category,6);
  });
  test('短牌使用 6–A，A6789 为顺子且同花大于葫芦',()=>{
    const short=E.deckCards(true);assert.equal(short.length,36);assert.equal(Math.min(...short),c(6));
    assert.equal(E.evaluate([c(14),c(6,1),c(7,2),c(8,3),c(9)],true).category,4);
    const flush=E.evaluate([c(14),c(12),c(10),c(8),c(6)],true);
    const full=E.evaluate([c(14),c(14,1),c(14,2),c(13),c(13,1)],true);assert(flush.score>full.score);
  });
  test('A2345 为最小顺子；踢脚牌参与比较',()=>{
    assert(E.evaluate([c(14),c(2,1),c(3),c(4),c(5)]).score<E.evaluate([c(2),c(3,1),c(4),c(5),c(6)]).score);
    assert(E.evaluate([c(14),c(14,1),c(13),c(9),c(2)]).score>E.evaluate([c(14),c(14,1),c(12),c(9),c(2)]).score);
  });
  test('洗牌无重复',()=>{const d=E.shuffle();assert.equal(d.length,52);assert.equal(new Set(d).size,52);});
  test('两人桌庄家小盲先行动，翻牌后大盲先行动',()=>{
    const r=table(2);E.startHand(r);assert.equal(r.dealer,0);assert.equal(r.sb,'0');assert.equal(r.bb,'1');assert.equal(r.actorId,'0');E.act(r,'0','call');assert.equal(r.actorId,'1');E.act(r,'1','check');assert.equal(r.street,'flop');assert.equal(r.actorId,'1');
  });
  test('多人桌盲注轮转及大盲保留加注权',()=>{
    const r=table(4);E.startHand(r);assert.equal(r.actorId,'3');E.act(r,'3','call');E.act(r,'0','call');E.act(r,'1','call');assert.equal(r.actorId,'2');assert(E.legalActions(r,'2').canRaise);E.act(r,'2','check');assert.equal(r.actorId,'1');
  });
  test('禁止越权、非法过牌与不足额加注',()=>{
    const r=table(3);E.startHand(r);assert.throws(()=>E.act(r,'1','fold'));assert.throws(()=>E.act(r,'0','check'));assert.throws(()=>E.act(r,'0','raise',25));assert.equal(r.currentBet,20);
  });
  test('单次不足额全下不重新开放已行动玩家加注',()=>{
    const r=table(4,[30,200,200,200]);E.startHand(r);E.act(r,'3','call');E.act(r,'0','allin');E.act(r,'1','call');E.act(r,'2','call');assert.equal(r.actorId,'3');assert.equal(E.legalActions(r,'3').canRaise,false);assert.throws(()=>E.act(r,'3','allin'));
  });
  test('累积短全下达到完整加注增量后重新开放加注',()=>{
    const r=table(4,[30,40,200,200]);E.startHand(r);E.act(r,'3','call');E.act(r,'0','allin');E.act(r,'1','allin');E.act(r,'2','call');assert.equal(r.actorId,'3');assert.equal(E.legalActions(r,'3').canRaise,true);
  });
  test('主池、边池及未跟注筹码正确分配',()=>{
    const r=table(3);r.status='playing';r.board=[c(2),c(3,1),c(7,2),c(9,3),c(11)];
    r.players.forEach((p,i)=>{p.inHand=true;p.total=(i+1)*100;p.stack=0;p.hole=[c(14-i,1),c(14-i,2)];});E.settle(r);assert.deepEqual(r.players.map(p=>p.stack),[300,200,100]);assert.equal(r.pots.length,3);
  });
  test('平局零头从庄家左侧分配',()=>{
    const r=table(3);r.dealer=0;r.board=[10,11,12,13,14].map(x=>c(x));r.players.forEach((p,i)=>{p.inHand=true;p.total=5;p.stack=0;p.hole=[c(2+i,1),c(7+i,2)];});r.players[2].folded=true;E.settle(r);assert.deepEqual(r.players.map(p=>p.stack),[7,8,0]);
  });
  test('所有对手弃牌时不强制亮底牌',()=>{const r=table(2);E.startHand(r);E.act(r,r.actorId,'fold');assert.equal(r.status,'showdown');const v=E.publicView(r,'0');assert.deepEqual(v.players.find(p=>p.id==='1').hole,[null,null]);});
  test('服务端视图不泄露牌堆、烧牌或对手底牌',()=>{
    const r=table(3);E.startHand(r);const v=E.publicView(r,'0');assert(!('deck'in v));assert(!('burn'in v));assert.deepEqual(v.players[1].hole,[null,null]);assert(v.players[0].hole.every(Number.isInteger));
  });
  test('补筹等于入场筹码，进行中的全下预约下一手补筹',()=>{
    const r=table(2,[100,100]);E.startHand(r);E.act(r,'0','allin');E.rebuy(r,'0');assert.equal(r.players[0].stack,0);assert(r.players[0].rebuyPending);E.act(r,'1','call');const p=r.players.find(p=>p.stack===0);if(p){E.rebuy(r,p.id);assert.equal(p.stack,2000);}assert.throws(()=>E.rebuy(r,r.players.find(p=>p.stack>0).id));
  });
  test('行动超时自动弃牌，免费行动时自动过牌',()=>{
    const r=table(2);E.startHand(r,100);E.tick(r,30101);assert.equal(r.status,'showdown');const q=table(2);E.startHand(q,100);E.act(q,'0','call',null,100);E.tick(q,30101);assert.equal(q.street,'flop');
  });
  test('预约补筹后赢回筹码时取消补筹，不覆盖赢得的筹码',()=>{
    const r=table(2);r.players[0].rebuyPending=true;r.players[0].stack=4000;const before=r.players[0].invested;E.startHand(r);assert.equal(r.players[0].stack+r.players[0].bet,4000);assert.equal(r.players[0].invested,before);assert.equal(r.players[0].rebuyPending,false);
  });
  test('新玩家不进入当前手牌，房主离开后转交',()=>{
    const r=E.makeRoom('TEST',{capacity:3});E.addPlayer(r,'0','甲');E.addPlayer(r,'1','乙');E.startHand(r);E.addPlayer(r,'2','丙');assert(!r.players[2].inHand);E.leave(r,'0');assert.equal(r.hostId,'1');
  });
  test('观战视图无下注权限、隐藏底牌并显示总体输赢',()=>{
    const r=table(2);E.startHand(r);E.addSpectator(r,'watch','观众');const v=E.publicView(r,'watch');assert.equal(v.role,'spectator');assert.equal(v.legal,null);assert.equal(v.spectatorCount,1);assert(v.players.every(p=>p.hole.every(c=>c===null)));assert.equal(v.players[0].net,0);
  });
  test('连续三手开局弃牌警告，第五手标记电脑接管',()=>{
    const r=table(2);for(let h=1;h<=5;h++){E.startHand(r);while(r.status==='playing'&&r.actorId!=='0'){const l=E.legalActions(r,r.actorId);E.act(r,r.actorId,l.canCheck?'check':'call');}E.act(r,'0','fold');if(h===3)assert.match(r.players[0].warning,/3 手/);}assert.equal(r.players[0].kicked,true);
  });
  test('连续五手开局全下触发接管，改变打法会清除警告',()=>{
    const r=table(2);const prepare=(hand,currentBet=20)=>{r.status='playing';r.handNo=hand;r.street='preflop';r.actorId='0';r.currentBet=currentBet;r.minRaise=20;for(const p of r.players){p.inHand=true;p.folded=false;p.acted=false;p.bet=0;p.total=0;p.stack=1000;p.hole=[c(14),c(13)];}};
    for(let h=1;h<=5;h++){prepare(h);E.act(r,'0','allin');if(h===3)assert.match(r.players[0].warning,/3 手/);}assert.equal(r.players[0].kicked,true);
    const q=table(2);for(let h=1;h<=3;h++){q.status='playing';q.handNo=h;q.street='preflop';q.actorId='0';q.currentBet=20;q.minRaise=20;q.players.forEach(p=>{p.inHand=true;p.folded=false;p.acted=false;p.bet=0;p.total=0;p.stack=1000;p.hole=[c(14),c(13)]});E.act(q,'0','fold');}q.status='playing';q.handNo=4;q.street='preflop';q.actorId='0';q.currentBet=0;q.players.forEach(p=>{p.inHand=true;p.folded=false;p.acted=false;p.bet=0;p.total=0;p.stack=1000;p.hole=[c(14),c(13)]});E.act(q,'0','check');assert.equal(q.players[0].warning,null);assert.equal(q.players[0].foldOpenStreak,0);
  });
  test('电脑决策不使用其他玩家真实底牌',()=>{
    const r=table(3);E.startHand(r);r.players[0].bot=true;r.players[0].difficulty='medium';let seed=7;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const a=E.botDecision(r,r.players[0],rnd);r.players[1].hole=[c(14),c(14,1)];r.players[2].hole=[c(13),c(13,1)];seed=7;const b=E.botDecision(r,r.players[0],rnd);assert.deepEqual(a,b);
  });
  test('2–10 人共 270 手随机合法对局，筹码守恒且均可结束',()=>{
    let seed=91823;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let n=2;n<=10;n++)for(let h=0;h<30;h++){
      const r=table(n);E.startHand(r);let steps=0;
      while(r.status==='playing'){
        assert(++steps<250,'牌局未收敛');const l=E.legalActions(r,r.actorId),x=rnd();
        if(x<.10)E.act(r,r.actorId,'fold');else if(x<.20&&l.canAllIn)E.act(r,r.actorId,'allin');else if(x<.38&&l.canRaise)E.act(r,r.actorId,'raise',Math.min(l.maxTo,l.minTo+Math.floor(rnd()*100)));else E.act(r,r.actorId,l.canCheck?'check':'call');
        assert(r.players.every(p=>Number.isInteger(p.stack)&&p.stack>=0));
        const sum=r.players.reduce((s,p)=>s+p.stack+(r.status==='playing'?p.total:0),0);assert.equal(sum,n*2000);
      }
    }
  });
  test('2、6、10 人桌连续开局与自动补筹，累计带入等于筹码总量',()=>{
    for(const n of [2,6,10]){
      const r=table(n);r.players.forEach(p=>p.bot=true);
      for(let hand=0;hand<10;hand++){
        assert(E.startHand(r));let steps=0;
        while(r.status==='playing'){assert(++steps<100);const l=E.legalActions(r,r.actorId);E.act(r,r.actorId,l.canAllIn?'allin':l.canCheck?'check':'call');}
        assert.equal(r.players.reduce((sum,p)=>sum+p.stack,0),r.players.reduce((sum,p)=>sum+p.invested,0));
        assert.equal(r.handNo,hand+1);
      }
    }
  });
  return passed;
}
