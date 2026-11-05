(() => {
"use strict";
const PROJECT_CODE = "ZS3Z7F";
const API_URL = "https://attention-lab-production.up.railway.app/api/hw2/submit";
const $ = id => document.getElementById(id);
const screens = [...document.querySelectorAll(".screen")];
const state = {
  participant:"", consent:false, eyeEnabled:false, eyeStatus:"not_started",
  calibrationClicks:0, validationErrors:[], validationPassed:false, gazeSamples:[],
  gazeCurrent:null, gazeListener:null, currentExperiment:1, currentTrials:[], trialIndex:0,
  experimentData:{1:[],2:[]}, practiceDone:false, currentTrialStart:0, firstClick:null,
  clickLog:[], trialGaze:[], taskActive:false, uploadResults:{}, eyeQuality:{}, breakTimer:null
};
const POINTS = [{x:10,y:12},{x:50,y:12},{x:90,y:12},{x:10,y:50},{x:50,y:50},{x:90,y:50},{x:10,y:88},{x:50,y:88},{x:90,y:88}];
const VAL_POINTS = [{x:18,y:22},{x:82,y:22},{x:50,y:50},{x:18,y:78},{x:82,y:78}];
function show(id, phase){ screens.forEach(s=>s.classList.toggle("active",s.id===`screen-${id}`)); $("topPhase").textContent=phase||id.toUpperCase(); window.scrollTo(0,0); }
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2300);}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;}
function sd(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));}
function pct(x){return Number.isFinite(x)?`${(x*100).toFixed(1)}%`:"—";}
function ms(x){return Number.isFinite(x)?`${Math.round(x)} ms`:"—";}
function shuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function makeTrials(exp){
  const out=[];
  if(exp===1){
    for(const distractors of [4,12])for(const salience of ["low","high"])for(let i=0;i<10;i++)
      out.push({experiment:1,condition:`${distractors===4?"few":"many"}_${salience}`,distractor_count:distractors,salience,layout:i%5,target_slot:(i*5)%6});
  }else{
    for(const congruency of ["congruent","incongruent"])for(const cue of ["none","consequence"])for(let i=0;i<10;i++)
      out.push({experiment:2,condition:`${congruency}_${cue}`,congruency,cue,correct_side:i%2===0?"left":"right",color_variant:i%2});
  }
  return shuffle(out).map((t,i)=>({...t,trial_id:i+1}));
}
function begin(){
  state.participant=$("participantId").value.trim();
  state.consent=$("consent").checked;
  if(!state.participant){$("homeError").textContent="请先填写被试编号。";return;}
  if(!state.consent){$("homeError").textContent="请先阅读并勾选参与同意。";return;}
  if($("deviceType").value!=="desktop"){ $("homeError").textContent="请使用电脑和鼠标完成实验，以确保 Hover 操作与眼动估计正常。";return;}
  $("homeError").textContent="";
  show("instructions","MISSION BRIEFING");
}
$("participantId").addEventListener("input",()=>{$("startBtn").disabled=!$("participantId").value.trim()||!$("consent").checked;});
$("consent").addEventListener("change",()=>{$("startBtn").disabled=!$("participantId").value.trim()||!$("consent").checked;});
$("startBtn").addEventListener("click",begin);
$("toEyeBtn").addEventListener("click",()=>show("eye-intro","EYE TRACKING SETUP"));
$("skipEyeBtn").addEventListener("click",()=>{state.eyeEnabled=false;state.eyeStatus="declined";startPractice();});
$("beginCalibrationBtn").addEventListener("click",startEye);
$("cameraToggle").addEventListener("click",()=>{$("cameraDock").classList.add("hidden");});
function startEye(){
  if(!window.webgazer){$("eyeSetupError").textContent="眼动模块加载失败。请刷新页面或选择仅行为数据模式。";return;}
  $("beginCalibrationBtn").disabled=true;
  $("eyeSetupError").textContent="正在请求摄像头权限…";
  try{
    webgazer.setRegression("ridge").setTracker("TFFacemesh");
    webgazer.showVideoPreview(true).showPredictionPoints(false).showFaceOverlay(false).showFaceFeedbackBox(false);
    webgazer.setGazeListener((data,ts)=>{
      if(data&&Number.isFinite(data.x)&&Number.isFinite(data.y)){
        state.gazeCurrent={x:data.x,y:data.y,t:performance.now()};
        if(state.taskActive)state.trialGaze.push({x:Math.round(data.x),y:Math.round(data.y),t:Math.round(performance.now()-state.currentTrialStart)});
      }
    });
    webgazer.begin().then(()=>{
      state.eyeEnabled=true;state.eyeStatus="calibrating";$("cameraDock").classList.remove("hidden");
      $("eyeSetupError").textContent="摄像头已连接。请开始校准。";
      setTimeout(()=>{show("calibration","EYE CALIBRATION");setupCalibration();},1200);
    }).catch(err=>{$("eyeSetupError").textContent="无法启动摄像头："+(err.message||"请检查权限");$("beginCalibrationBtn").disabled=false;});
  }catch(e){$("eyeSetupError").textContent="眼动模块初始化失败："+e.message;$("beginCalibrationBtn").disabled=false;}
}
function setupCalibration(){
  const field=$("calibrationField"), points=[...field.querySelectorAll(".cal-point")];
  points.forEach((p,i)=>{p.style.left=POINTS[i].x+"%";p.style.top=POINTS[i].y+"%";p.dataset.clicks="0";p.classList.remove("done");});
  state.calibrationClicks=0;$("calCount").textContent="0";$("calStatus").textContent="依次点击每个圆点 5 次。";
  points.forEach(p=>p.addEventListener("click",()=>{
    const n=Number(p.dataset.clicks)+1;p.dataset.clicks=n;state.calibrationClicks++;$("calCount").textContent=state.calibrationClicks;
    p.style.transform=`translate(-50%,-50%) scale(${Math.max(.65,1-n*.06)})`;
    if(n>=5){p.classList.add("done");p.disabled=true;}
    if(state.calibrationClicks>=45){$("calStatus").textContent="校准完成。请进入验证环节。";$("calContinueBtn").disabled=false;}
  }));
}
$("calContinueBtn").addEventListener("click",()=>{state.eyeStatus="validating";show("validation","EYE VALIDATION");$("validationStartBtn").classList.remove("hidden");});
$("validationStartBtn").addEventListener("click",runValidation);
async function runValidation(){
  $("validationStartBtn").disabled=true;$("validationNote").textContent="验证进行中：请注视每个目标并点击。";
  const target=$("validationTarget");let errs=[];
  for(let i=0;i<VAL_POINTS.length;i++){
    const p=VAL_POINTS[i],x=window.innerWidth*p.x/100,y=window.innerHeight*p.y/100;
    target.style.left=x+"px";target.style.top=y+"px";target.style.display="grid";
    $("valProgress").textContent=`${i+1} / 5`;
    await new Promise(resolve=>{
      const handler=async()=>{
        target.removeEventListener("click",handler);
        const samples=[];
        for(let k=0;k<8;k++){if(state.gazeCurrent)samples.push({x:state.gazeCurrent.x,y:state.gazeCurrent.y});await new Promise(r=>setTimeout(r,70));}
        if(samples.length){const gx=mean(samples.map(s=>s.x)),gy=mean(samples.map(s=>s.y));errs.push(Math.hypot(gx-x,gy-y));}
        resolve();
      };
      target.addEventListener("click",handler,{once:true});
    });
  }
  target.style.display="none";
  const error=mean(errs);state.validationErrors=errs;state.validationPassed=Number.isFinite(error)&&error<=180;
  $("valError").textContent=Number.isFinite(error)?`${Math.round(error)} px`:"无有效预测";
  $("valStatus").textContent=state.validationPassed?"通过": "未通过";
  $("valStatus").style.color=state.validationPassed?"#c7f36b":"#ff6c71";
  state.eyeStatus=state.validationPassed?"validated":"low_quality";
  state.eyeQuality={meanValidationErrorPx:Number.isFinite(error)?Math.round(error):null,validationPoints:errs.length,passed:state.validationPassed};
  $("validationNote").textContent=state.validationPassed?"验证通过。正式任务将记录注视估计。":"验证未达到预设标准（平均误差 ≤ 180 px）。你可以重新校准，或继续完成行为任务；报告会标记眼动数据质量不足。";
  $("validationStartBtn").classList.add("hidden");
  const btn=document.createElement("button");btn.className="btn btn-primary";btn.textContent=state.validationPassed?"进入练习 →":"继续（眼动质量不足） →";btn.onclick=()=>startPractice();$("validationNote").after(btn);
}
function stopEye(){try{if(window.webgazer)webgazer.end();}catch(e){}$("cameraDock").classList.add("hidden");}
function startPractice(){show("practice","PRACTICE TRIAL");state.practiceDone=false;renderPractice();}
function renderPractice(){
  const area=$("practiceArea");area.innerHTML="";
  const modal=document.createElement("div");modal.className="coupon-modal";
  modal.innerHTML='<div class="coupon-ribbon">NEW MEMBER BONUS</div><h3>恭喜！你获得 100 元专属优惠券</h3><p class="sub">限时领取，立即开启你的训练计划。</p><div class="coupon-value"><strong>¥100</strong><span>满 199 元可用 · 今日有效</span></div><div class="coupon-buttons"><button class="claim-btn">立即领取</button><button class="claim-btn alt">开心收下</button></div><div class="coupon-noise"><span>会员专享权益</span><span>限时倒计时 09:59</span><span>热门课程推荐</span></div><div class="coupon-footer"><span class="coupon-extra">更多活动规则 · 了解详情</span><button class="decline-target high">暂不领取</button></div>';
  area.append(modal);modal.querySelector(".decline-target").onclick=()=>{$("practiceStatus").textContent="练习完成！正式任务即将开始。";$("practiceBtn").textContent="开始正式实验 →";state.practiceDone=true;};
  $("practiceBtn").onclick=()=>{if(!state.practiceDone){toast("请先点击“暂不领取”完成练习。");return;}startExperiment(1);};
}
function startExperiment(exp){
  state.currentExperiment=exp;state.currentTrials=makeTrials(exp);state.trialIndex=0;
  show("task",`MISSION 0${exp} / ACTIVE`);
  $("taskKicker").textContent=exp===1?"MISSION 01 / VISUAL SEARCH":"MISSION 02 / RESPONSE CONFLICT";
  $("taskTitle").textContent=exp===1?"找到拒绝入口":"确认取消订阅";
  $("taskInstruction").textContent=exp===1?"请找到“暂不领取”并点击。":"请根据按钮文字，点击“确认取消订阅”。";
  renderTrial();
}
function renderTrial(){
  const exp=state.currentExperiment,t=state.currentTrials[state.trialIndex],stage=$("taskStage");
  if(!t)return finishExperiment(exp);
  $("trialCounter").textContent=`${String(state.trialIndex+1).padStart(2,"0")} / 40`;
  $("taskProgressBar").style.width=`${(state.trialIndex/40)*100}%`;
  const done=state.experimentData[exp];$("liveAccuracy").textContent=done.length?pct(done.filter(x=>x.first_correct).length/done.length):"—";
  stage.innerHTML="";state.firstClick=null;state.clickLog=[];state.trialGaze=[];state.currentTrialStart=0;state.taskActive=false;
  if(exp===1)renderSearchTrial(stage,t);else renderConflictTrial(stage,t);
  // Brief fixation interval; RT starts only when stimulus becomes active.
  const fixation=document.createElement("div");fixation.className="fixation";fixation.textContent="+";stage.append(fixation);
  setTimeout(()=>{if(!state.taskActive){fixation.remove();state.currentTrialStart=performance.now();state.taskActive=true;}},500);
}
function renderSearchTrial(stage,t){
  const modal=document.createElement("div");modal.className="coupon-modal";
  const distractors=t.distractor_count===4?["会员专享","限时优惠","课程推荐","训练礼包"]:["会员专享","限时优惠","课程推荐","训练礼包","专属权益","今日特价","新手福利","精选课程","限时返现","会员积分","人气榜单","加赠礼包"];
  const buttons=t.distractor_count===4?["立即领取","开心收下"]:["立即领取","开心收下","马上解锁","开启福利"];
  const slots=shuffle([...Array(t.distractor_count+1).keys()]);
  modal.innerHTML=`<div class="coupon-ribbon">LIMITED OFFER</div><h3>恭喜！你获得 100 元专属优惠券</h3><p class="sub">为了感谢你的坚持训练，我们准备了一份专属礼遇。</p><div class="coupon-value"><strong>¥100</strong><span>限时领取 · 今日有效</span></div><div class="coupon-buttons">${buttons.map((b,i)=>`<button class="claim-btn ${i?"alt":""}" data-wrong="${b}">${b}</button>`).join("")}</div><div class="coupon-noise">${distractors.slice(0,Math.ceil(distractors.length/2)).map(x=>`<span>${x}</span>`).join("")}</div><div class="coupon-noise">${distractors.slice(Math.ceil(distractors.length/2)).map(x=>`<span>${x}</span>`).join("")}</div><div class="coupon-footer"><span class="coupon-extra">领取即表示同意活动规则</span><button class="decline-target ${t.salience==="high"?"high":""}" data-correct="true">暂不领取</button></div>`;
  stage.append(modal);
  modal.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>recordClick(btn.dataset.correct==="true",btn.textContent.trim(),btn)));
  // AOIs: coupon target and promotional region.
  modal.dataset.aoi="search";
  modal.querySelector(".coupon-footer").style.position="relative";
  const targetBtn=modal.querySelector(".decline-target");
  targetBtn.style.position="absolute";targetBtn.style.left=`${(t.target_slot+0.5)/6*100}%`;targetBtn.style.transform="translateX(-50%)";
  modal.querySelector(".coupon-extra").style.maxWidth="34%";
}
function renderConflictTrial(stage,t){
  const modal=document.createElement("div");modal.className="cancel-modal";
  const congruent=t.congruency==="congruent";
  const cancelColor=congruent?"red":"green",continueColor=congruent?"green":"red";
  const cancelTip="点击后将终止自动续费；会员权益将在当前周期结束后失效。";
  const continueTip="点击后将保留当前会员订阅，后续将按原计划续费。";
  const cancelSide=t.correct_side;
  const leftIsCancel=cancelSide==="left";
  const leftClass=leftIsCancel?cancelColor:continueColor,rightClass=leftIsCancel?continueColor:cancelColor;
  const leftText=leftIsCancel?"确认取消订阅":"继续使用会员",rightText=leftIsCancel?"继续使用会员":"确认取消订阅";
  const leftCorrect=leftIsCancel,rightCorrect=!leftIsCancel;
  modal.innerHTML=`<div class="retention-banner">✦ 会员专属提醒：现在取消将失去训练计划、课程权益与专属优惠。</div><h3>确定要取消订阅吗？</h3><p>你的免费试用期即将结束。请根据按钮文字完成操作。</p><div class="cancel-buttons"><button class="cancel-choice ${leftClass} ${t.cue==="consequence"?"show-cue":""}" data-correct="${leftCorrect}" data-label="${leftText}">${leftText}<span class="hover-tip">${leftCorrect?cancelTip:continueTip}</span></button><button class="cancel-choice ${rightClass} ${t.cue==="consequence"?"show-cue":""}" data-correct="${rightCorrect}" data-label="${rightText}">${rightText}<span class="hover-tip">${rightCorrect?cancelTip:continueTip}</span></button></div><div class="cancel-foot">你可以随时在账户设置中管理订阅。</div>`;
  stage.append(modal);
  modal.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>recordClick(btn.dataset.correct==="true",btn.dataset.label,btn)));
}
function recordClick(correct,label,el){
  if(!state.taskActive)return;
  const rt=performance.now()-state.currentTrialStart;
  const item={label,correct,rt:Math.round(rt),x:Math.round(el.getBoundingClientRect().left+el.getBoundingClientRect().width/2),y:Math.round(el.getBoundingClientRect().top+el.getBoundingClientRect().height/2)};
  state.clickLog.push(item);if(state.firstClick===null)state.firstClick=item;
  if(correct){
    state.taskActive=false;
    const t=state.currentTrials[state.trialIndex];
    const targetEl=state.currentExperiment===1?document.querySelector(".decline-target[data-correct='true']"):document.querySelector(".cancel-choice[data-correct='true']");
    const otherEls=state.currentExperiment===1?[...document.querySelectorAll(".claim-btn")]:[...document.querySelectorAll(".cancel-choice[data-correct='false']")];
    const gaze=analyseGaze(state.trialGaze,t,targetEl,otherEls);
    const record={...t,participant:state.participant,rt_first_click:state.firstClick.rt,first_click_label:state.firstClick.label,first_correct:state.firstClick.correct,rt_correct:Math.round(rt),final_correct:true,error_clicks:state.clickLog.filter(c=>!c.correct).length,clicks:state.clickLog,gaze_samples:state.trialGaze.length?state.trialGaze:[],gaze_metrics:gaze,eye_status:state.eyeStatus,timestamp:new Date().toISOString()};
    state.experimentData[state.currentExperiment].push(record);
    $("taskFootLeft").textContent=state.clickLog.length>1?"已纠正操作，继续下一试次。":"操作正确，继续下一试次。";
    setTimeout(()=>{state.trialIndex++;renderTrial();},350);
  }else{
    el.classList.add("wrong-flash");setTimeout(()=>el.classList.remove("wrong-flash"),350);
    $("taskFootLeft").textContent="这不是目标操作，请重新选择。";
  }
}
function analyseGaze(samples,t,targetEl,otherEls){
  if(!samples||!samples.length||!state.eyeEnabled)return {available:false,samples:0};
  const valid=samples.filter(s=>s.x>=0&&s.y>=0&&s.x<=window.innerWidth&&s.y<=window.innerHeight);
  const inRect=(s,el)=>{if(!el)return false;const r=el.getBoundingClientRect();return s.x>=r.left&&s.x<=r.right&&s.y>=r.top&&s.y<=r.bottom;};
  const targetSamples=valid.filter(s=>inRect(s,targetEl));
  const otherSamples=valid.filter(s=>otherEls.some(el=>inRect(s,el)));
  const taskSamples=valid.filter(s=>s.x>window.innerWidth*.12&&s.x<window.innerWidth*.88&&s.y>window.innerHeight*.18&&s.y<window.innerHeight*.88);
  const firstTarget=targetSamples.length?Math.min(...targetSamples.map(s=>s.t)):null;
  return {available:true,samples:valid.length,valid_ratio:valid.length/Math.max(1,samples.length),
    target_aoi_sample_ratio:targetSamples.length/Math.max(1,valid.length),
    competing_aoi_sample_ratio:otherSamples.length/Math.max(1,valid.length),
    task_area_ratio:taskSamples.length/Math.max(1,valid.length),
    first_target_gaze_latency_ms:firstTarget,mean_x:mean(valid.map(s=>s.x)),mean_y:mean(valid.map(s=>s.y))};
}
function finishExperiment(exp){
  $("taskProgressBar").style.width="100%";
  if(exp===1){show("transition","MISSION 01 COMPLETE");}
  else{stopEye();renderReport();show("report","FINAL AUDIT REPORT");}
}
$("toExperiment2Btn").addEventListener("click",()=>{show("break","COGNITIVE RESET");let n=20;$("breakText").textContent=`${n} 秒休息（可提前继续）`;state.breakTimer=setInterval(()=>{n--;if(n<=0){clearInterval(state.breakTimer);$("breakText").textContent="准备就绪";}else $("breakText").textContent=`${n} 秒休息（可提前继续）`;},1000);});
$("continueBreakBtn").addEventListener("click",()=>{clearInterval(state.breakTimer);startExperiment(2);});
function conditionSummary(exp,key){
  const rows=state.experimentData[exp];const groups={};
  rows.forEach(r=>{const k=key(r);(groups[k]??=[]).push(r);});
  return Object.entries(groups).map(([condition,a])=>({condition,n:a.length,rt:mean(a.map(x=>x.rt_correct)),firstAcc:mean(a.map(x=>x.first_correct?1:0)),error:mean(a.map(x=>x.error_clicks>0?1:0))}));
}
function renderBars(el,items){
  el.innerHTML="";const max=Math.max(...items.map(x=>x.rt||0),1);
  items.forEach(x=>{const row=document.createElement("div");row.className="bar-row";row.innerHTML=`<span>${x.condition}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.rt/max*100).toFixed(1)}%"></div></div><b class="bar-value">${Number.isFinite(x.rt)?Math.round(x.rt):"—"} ms</b>`;el.append(row);});
}
function renderReport(){
  const a=state.experimentData[1],b=state.experimentData[2];
  const r1=conditionSummary(1,r=>`${r.distractor_count===4?"少":"多"}干扰·${r.salience==="low"?"低":"高"}显著`);
  const r2=conditionSummary(2,r=>`${r.congruency==="congruent"?"相容":"不相容"}·${r.cue==="none"?"无提示":"有提示"}`);
  $("reportParticipant").textContent=`OPERATOR / ${state.participant} · PROJECT ${PROJECT_CODE}`;
  $("r1rt").textContent=ms(mean(a.map(x=>x.rt_correct)));
  $("r1acc").textContent=pct(mean(a.map(x=>x.first_correct?1:0)));
  $("r1err").textContent=pct(mean(a.map(x=>x.error_clicks>0?1:0)));
  renderBars($("chart1"),r1);
  const few=mean(a.filter(x=>x.distractor_count===4).map(x=>x.rt_correct)),many=mean(a.filter(x=>x.distractor_count===12).map(x=>x.rt_correct));
  const low=mean(a.filter(x=>x.salience==="low").map(x=>x.rt_correct)),high=mean(a.filter(x=>x.salience==="high").map(x=>x.rt_correct));
  $("insight1").textContent=`你的数据中，多干扰条件与少干扰条件的 RT 差为 ${ms(many-few)}；高显著性与低显著性条件的 RT 差为 ${ms(high-low)}。这是个人描述性结果，群体效应需要汇总所有参与者数据。`;
  $("r2conflict").textContent=ms(mean(b.filter(x=>x.congruency==="incongruent").map(x=>x.rt_correct))-mean(b.filter(x=>x.congruency==="congruent").map(x=>x.rt_correct)));
  $("r2err").textContent=pct(mean(b.filter(x=>x.cue==="none").map(x=>x.first_correct?0:1)));
  const conflictNo=mean(b.filter(x=>x.congruency==="incongruent"&&x.cue==="none").map(x=>x.rt_correct))-mean(b.filter(x=>x.congruency==="congruent"&&x.cue==="none").map(x=>x.rt_correct));
  const conflictCue=mean(b.filter(x=>x.congruency==="incongruent"&&x.cue==="consequence").map(x=>x.rt_correct))-mean(b.filter(x=>x.congruency==="congruent"&&x.cue==="consequence").map(x=>x.rt_correct));
  $("r2cue").textContent=ms(conflictNo-conflictCue);renderBars($("chart2"),r2);
  $("insight2").textContent=`无提示条件的冲突成本为 ${ms(conflictNo)}；有后果提示条件的冲突成本为 ${ms(conflictCue)}。提示缓解量为 ${ms(conflictNo-conflictCue)}。正值表示提示条件下冲突成本较小。`;
  const all=[...a,...b],gaze=all.map(x=>x.gaze_metrics).filter(x=>x&&x.available);
  const gazeCoverage=gaze.length/Math.max(1,all.length);
  $("gazeQuality").textContent=state.validationPassed?`${Math.round(gazeCoverage*100)}%`:"LOW";
  const g1=a.map(x=>x.gaze_metrics).filter(x=>x&&x.available),g2=b.map(x=>x.gaze_metrics).filter(x=>x&&x.available);
  $("gazeMetrics").innerHTML=`<div class="gaze-line"><span>验证平均误差</span><b>${state.eyeQuality.meanValidationErrorPx??"—"} px</b></div><div class="gaze-line"><span>有效眼动试次覆盖率</span><b>${pct(gazeCoverage)}</b></div><div class="gaze-line"><span>实验一目标 AOI 样本比例</span><b>${g1.length?pct(mean(g1.map(x=>x.target_aoi_sample_ratio))):"—"}</b></div><div class="gaze-line"><span>实验一竞争 AOI 样本比例</span><b>${g1.length?pct(mean(g1.map(x=>x.competing_aoi_sample_ratio))):"—"}</b></div><div class="gaze-line"><span>实验二正确按钮 AOI 样本比例</span><b>${g2.length?pct(mean(g2.map(x=>x.target_aoi_sample_ratio))):"—"}</b></div><div class="gaze-line"><span>实验二竞争按钮 AOI 样本比例</span><b>${g2.length?pct(mean(g2.map(x=>x.competing_aoi_sample_ratio))):"—"}</b></div>`;
  $("gazeNote").textContent=gaze.length?"* 任务区域比例是屏幕区域样本比例的粗略指标，不是注视点固定/注视时长或精确 AOI dwell time。WebGazer 估计精度受设备和环境影响。": "未获得可用眼动样本，或验证未通过。行为数据仍可用于课程分析。";
  $("auditSummary").innerHTML=`<div class="summary-item"><i>↗</i><span>视觉搜索：检查干扰数量和目标显著性对定位速度的影响。</span></div><div class="summary-item"><i>↗</i><span>反应冲突：检查颜色暗示与文字指令不一致时的操作成本。</span></div><div class="summary-item"><i>◎</i><span>眼动质量：${state.validationPassed?"通过预设验证阈值，仍需结合有效样本覆盖率解释。":"未达到验证标准，不能据此推断注视分配机制。"}</span></div><div class="summary-item"><i>✦</i><span>设计建议：提高退出入口可见性，并清楚说明每个按钮的实际后果。</span></div>`;
}
function allRecords(){return [...state.experimentData[1],...state.experimentData[2]];}
function csvEscape(v){const s=typeof v==="object"?JSON.stringify(v):String(v??"");return `"${s.replace(/"/g,'""')}"`;}
function download(name,content,type){const blob=new Blob([content],{type});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);}
$("downloadCsvBtn").addEventListener("click",()=>{
  const rows=allRecords(),keys=["participant","experiment","trial_id","condition","distractor_count","salience","congruency","cue","rt_first_click","rt_correct","first_click_label","first_correct","final_correct","error_clicks","eye_status","gaze_metrics","gaze_samples","timestamp"];
  const csv=[keys.join(","),...rows.map(r=>keys.map(k=>csvEscape(r[k])).join(","))].join("\n");
  download(`DPA_${state.participant}_trials.csv`,"\uFEFF"+csv,"text/csv;charset=utf-8");
});
$("downloadJsonBtn").addEventListener("click",()=>download(`DPA_${state.participant}_data.json`,JSON.stringify({project:PROJECT_CODE,participant:state.participant,eye:{status:state.eyeStatus,quality:state.eyeQuality},experiments:state.experimentData},null,2),"application/json"));
$("uploadBtn").addEventListener("click",uploadData);
async function uploadData(){
  const btn=$("uploadBtn"),status=$("uploadStatus");btn.disabled=true;status.textContent="正在向课程平台提交数据…";
  let failures=[];
  for(const exp of [1,2]){
    const trials=state.experimentData[exp];
    if(!trials.length)continue;
    const conditions=[...new Set(trials.map(t=>t.condition))];
    const payload={project:PROJECT_CODE,experiment:`dark_pattern_auditing_exp${exp}`,participant:state.participant,condition:conditions.join("|"),trials:trials.map(t=>({...t,eye_status:state.eyeStatus,validation:state.eyeQuality}))};
    try{
      const res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const body=await res.text();
      if(!res.ok)throw new Error(`HTTP ${res.status}: ${body.slice(0,180)}`);
      state.uploadResults[exp]={ok:true,status:res.status}; 
    }catch(e){failures.push(`实验 ${exp}：${e.message}`);state.uploadResults[exp]={ok:false,error:e.message};}
  }
  if(failures.length){status.textContent="上传未完全成功："+failures.join("；")+"。请保留本页面并下载 JSON/CSV 备份，稍后重试。";btn.disabled=false;btn.textContent="重试上传 ↻";}
  else{status.textContent="数据提交请求已成功发送。建议仍下载本地备份，以防平台端后续处理异常。";btn.textContent="已提交 ✓";btn.disabled=true;}
}
})();
