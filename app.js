
"use strict";

/* =====================================
   DARK PATTERN AUDITING BUREAU
   Behavioral experiment + WebGazer
===================================== */

const PROJECT_CODE = "ZS3Z7F";
const API_URL = "https://attention-lab-production.up.railway.app/api/hw2/submit";
const EXPERIMENTS = {
  1: { name: "visual_search", total: 40 },
  2: { name: "ui_stroop", total: 40 }
};

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rand = (min, max) => Math.random() * (max - min) + min;
const shuffle = array => {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const state = {
  participant: "",
  consent: false,
  gazeConsent: false,
  eyeEnabled: false,
  eyeQuality: "not_enabled",
  eyeError: null,
  calibrationSamples: 0,
  validation: [],
  gazeSamples: [],
  currentExperiment: 1,
  trials: [],
  trialIndex: 0,
  trialData: [],
  expResults: {},
  currentTrial: null,
  trialStart: 0,
  trialActive: false,
  fixationTimer: null,
  feedbackTimer: null,
  gazeInterval: null,
  uploadQueue: {},
  uploaded: {},
  lastUploadPayload: null,
  mouseEvents: []
};

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function status(id, message, ok = false) {
  const el = $(id);
  el.textContent = message;
  el.style.color = ok ? "#6ce0ad" : "#ffad70";
}

function shuffleTrials(trials) {
  return shuffle(trials);
}

/* =====================================
   HOME AND CONSENT
===================================== */

$("enterBtn").addEventListener("click", () => showScreen("consentScreen"));
$("backHomeBtn").addEventListener("click", () => showScreen("homeScreen"));

$("continueConsentBtn").addEventListener("click", () => {
  const participant = $("participantId").value.trim();
  if (!participant) return toast("请先填写被试编号。");
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(participant)) {
    return toast("编号请使用 2–32 位字母、数字、下划线或短横线。");
  }
  if (!$("consentCheck").checked) return toast("请先确认知情同意。");

  state.participant = participant;
  state.consent = true;
  state.gazeConsent = $("gazeConsentCheck").checked;

  if (state.gazeConsent) {
    showScreen("eyeIntroScreen");
    checkEyeEnvironment();
  } else {
    state.eyeQuality = "not_enabled";
    showScreen("briefingScreen");
  }
});

$("skipEyeBtn").addEventListener("click", () => {
  state.eyeEnabled = false;
  state.eyeQuality = "skipped";
  showScreen("briefingScreen");
});

$("backEyeBtn").addEventListener("click", () => {
  showScreen(state.gazeConsent ? "eyeIntroScreen" : "consentScreen");
});

/* =====================================
   WEBGAZER INITIALIZATION
===================================== */

function checkEyeEnvironment() {
  status("secureContextStatus", window.isSecureContext ? "可用" : "需要 HTTPS", window.isSecureContext);
  status("cameraApiStatus", navigator.mediaDevices?.getUserMedia ? "可用" : "不可用", !!navigator.mediaDevices?.getUserMedia);
  status("webgazerStatus", typeof window.webgazer !== "undefined" ? "已加载" : "未加载", typeof window.webgazer !== "undefined");
  status("cameraPermissionStatus", "尚未授权", false);

  const issues = [];
  if (!window.isSecureContext) issues.push("摄像头通常需要 HTTPS 或 localhost。");
  if (!navigator.mediaDevices?.getUserMedia) issues.push("当前浏览器不支持摄像头接口。");
  if (typeof window.webgazer === "undefined") issues.push("WebGazer 脚本加载失败。");

  $("eyeSetupMessage").textContent = issues.length ? issues.join(" ") : "设备环境初步满足要求。点击按钮后浏览器将请求摄像头权限。";
  $("startEyeBtn").disabled = issues.length > 0;
}

async function waitForWebGazerVideo(timeout = 15000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const video = document.getElementById("webgazerVideoFeed");
    if (video && video.srcObject && video.readyState >= 2 && video.videoWidth > 0) {
      return video;
    }
    await sleep(250);
  }
  throw new Error("未检测到可用的视频流。请检查摄像头权限，并刷新页面重试。");
}

async function startEyeTracking() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前页面不是安全上下文，无法启用摄像头。请使用 HTTPS 页面。");
  }
  if (typeof window.webgazer === "undefined") throw new Error("WebGazer 脚本尚未加载。");

  // 先显式获取授权，确认权限有效，再停止预授权流。
  const permissionStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false
  });
  permissionStream.getTracks().forEach(track => track.stop());

  const wg = window.webgazer;
  wg.setGazeListener((data, elapsedTime) => {
    if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    state.gazeSamples.push({
      x: data.x,
      y: data.y,
      t: performance.now(),
      elapsedTime: Number(elapsedTime) || null
    });
    if (state.gazeSamples.length > 12000) state.gazeSamples.shift();
  });

  if (typeof wg.showVideo === "function") wg.showVideo(true);
  if (typeof wg.showFaceOverlay === "function") wg.showFaceOverlay(false);
  if (typeof wg.showFaceFeedbackBox === "function") wg.showFaceFeedbackBox(false);

  await wg.begin();
  await waitForWebGazerVideo();

  state.eyeEnabled = true;
  state.eyeQuality = "calibrating";
  status("cameraPermissionStatus", "已授权", true);
}

$("startEyeBtn").addEventListener("click", async () => {
  $("startEyeBtn").disabled = true;
  $("eyeSetupMessage").textContent = "正在请求摄像头权限并启动视线估计……";
  try {
    await startEyeTracking();
    showScreen("calibrationScreen");
    startCalibration();
  } catch (err) {
    state.eyeEnabled = false;
    state.eyeError = err.message;
    $("eyeSetupMessage").textContent = "眼动启动失败：" + err.message;
    toast("眼动启动失败，可以跳过眼动继续实验。");
    $("startEyeBtn").disabled = false;
  }
});

/* =====================================
   CALIBRATION: 9 POINTS × 5 CLICKS
===================================== */

const CALIBRATION_POINTS = [
  [0.08, 0.08], [0.50, 0.08], [0.92, 0.08],
  [0.08, 0.50], [0.50, 0.50], [0.92, 0.50],
  [0.08, 0.92], [0.50, 0.92], [0.92, 0.92]
];

let calibrationIndex = 0;
let calibrationClickCount = 0;
let calibrationClickHandler = null;

function setPointPosition(element, point) {
  element.style.left = (point[0] * 100) + "%";
  element.style.top = (point[1] * 100) + "%";
}

function startCalibration() {
  calibrationIndex = 0;
  calibrationClickCount = 0;
  const button = $("calibrationPoint");

  if (calibrationClickHandler) {
    button.removeEventListener("click", calibrationClickHandler);
  }

  calibrationClickHandler = () => {
    if (!state.eyeEnabled) return;
    calibrationClickCount++;
    state.calibrationSamples++;
    $("calibrationProgress").textContent =
      `${calibrationIndex * 5 + calibrationClickCount} / 45`;

    if (calibrationClickCount >= 5) {
      calibrationIndex++;
      calibrationClickCount = 0;
      if (calibrationIndex >= CALIBRATION_POINTS.length) {
        button.hidden = true;
        $("calibrationHint").textContent = "校准完成，准备进行独立验证。";
        state.eyeQuality = "validation_pending";
        setTimeout(() => {
          showScreen("validationScreen");
          startValidation();
        }, 800);
        return;
      }
      showCalibrationPoint();
    } else {
      $("calibrationHint").textContent =
        `当前位置：第 ${calibrationClickCount} / 5 次点击。请持续注视圆点。`;
    }
  };

  button.addEventListener("click", calibrationClickHandler);
  button.hidden = false;
  showCalibrationPoint();
}

function showCalibrationPoint() {
  const point = CALIBRATION_POINTS[calibrationIndex];
  setPointPosition($("calibrationPoint"), point);
  $("calibrationHint").textContent =
    `校准点 ${calibrationIndex + 1} / 9：请先注视，再点击 5 次。`;
}

$("restartCalibrationBtn").addEventListener("click", () => {
  startCalibration();
  toast("已重新开始校准。");
});

/* =====================================
   VALIDATION: 5 INDEPENDENT POINTS
===================================== */

const VALIDATION_POINTS = [
  [0.22, 0.20], [0.78, 0.20], [0.50, 0.50],
  [0.22, 0.80], [0.78, 0.80]
];

let validationIndex = 0;
let validationTimer = null;
let validationSamples = [];
let validationReady = false;
let validationHandler = null;

function startValidation() {
  clearTimeout(validationTimer);
  validationIndex = 0;
  state.validation = [];
  $("continueAfterValidationBtn").disabled = true;
  $("validationError").textContent = "";
  showValidationPoint();
}

function showValidationPoint() {
  if (validationIndex >= VALIDATION_POINTS.length) {
    finishValidation();
    return;
  }

  validationReady = false;
  validationSamples = [];
  const point = VALIDATION_POINTS[validationIndex];
  setPointPosition($("validationTarget"), point);
  $("validationTarget").style.pointerEvents = "none";
  $("validationProgress").textContent = `${validationIndex} / 5`;
  $("validationHint").textContent = "请注视目标点，系统正在收集预测数据……";

  const start = performance.now();
  const collect = () => {
    if (!state.eyeEnabled) return;
    const recent = state.gazeSamples.filter(s => s.t >= start);
    validationSamples = recent;
    if (performance.now() - start >= 1300) {
      validationReady = true;
      $("validationTarget").style.pointerEvents = "auto";
      $("validationHint").textContent = "采样完成。现在可以点击目标点确认。";
    } else {
      validationTimer = setTimeout(collect, 100);
    }
  };
  collect();

  if (validationHandler) {
    $("validationTarget").removeEventListener("click", validationHandler);
  }

  validationHandler = () => {
    if (!validationReady) return toast("请先完成注视采样，再点击确认。");

    const valid = validationSamples.filter(s =>
      Number.isFinite(s.x) && Number.isFinite(s.y)
    );
    let error = null;

    if (valid.length >= 4) {
      const mx = valid.reduce((a, b) => a + b.x, 0) / valid.length;
      const my = valid.reduce((a, b) => a + b.y, 0) / valid.length;
      const area = $("validationArea").getBoundingClientRect();
      const tx = area.left + point[0] * area.width;
      const ty = area.top + point[1] * area.height;
      error = Math.hypot(mx - tx, my - ty);
    }

    state.validation.push({
      point: validationIndex + 1,
      samples: valid.length,
      error_px: error
    });

    validationIndex++;
    $("validationProgress").textContent = `${validationIndex} / 5`;
    showValidationPoint();
  };

  $("validationTarget").addEventListener("click", validationHandler);
}

function finishValidation() {
  const valid = state.validation.filter(v => v.error_px !== null);
  const meanError = valid.length
    ? valid.reduce((sum, v) => sum + v.error_px, 0) / valid.length
    : null;

  state.eyeQuality =
    valid.length >= 4 && meanError !== null && meanError <= 180
      ? "acceptable"
      : "low_quality";

  $("validationHint").textContent = "独立验证完成。";
  $("validationError").textContent = meanError === null
    ? "有效预测不足，未能计算误差。"
    : `平均估计误差：${meanError.toFixed(1)} px（${valid.length}/5 个有效点）`;

  $("continueAfterValidationBtn").disabled = false;
}

$("retryValidationBtn").addEventListener("click", startValidation);
$("continueAfterValidationBtn").addEventListener("click", () => {
  showScreen("briefingScreen");
});

/* =====================================
   EXPERIMENT TRIAL GENERATION
===================================== */

function makeVisualSearchTrials() {
  const trials = [];
  const positions = Array.from({ length: 40 }, (_, i) => i % 10);
  const shuffledPositions = shuffle(positions);

  let positionIndex = 0;
  for (const distractors of [8, 20]) {
    for (const salience of ["low", "high"]) {
      for (let i = 0; i < 10; i++) {
        trials.push({
          experiment: 1,
          condition: `${distractors === 8 ? "few" : "many"}_${salience}`,
          distractor_count: distractors,
          salience,
          target_slot: shuffledPositions[positionIndex++],
          trial_number: trials.length + 1
        });
      }
    }
  }
  return shuffleTrials(trials);
}

function makeConflictTrials() {
  const trials = [];
  for (const congruency of ["congruent", "incongruent"]) {
    for (const cue of ["none", "consequence"]) {
      for (let i = 0; i < 10; i++) {
        trials.push({
          experiment: 2,
          condition: `${congruency}_${cue}`,
          congruency,
          cue,
          trial_number: trials.length + 1
        });
      }
    }
  }
  return shuffleTrials(trials);
}

/* =====================================
   BRIEFING AND TASK START
===================================== */

$("beginExperimentBtn").addEventListener("click", () => {
  state.currentExperiment = 1;
  startExperiment(1);
});

function startExperiment(experiment) {
  state.currentExperiment = experiment;
  state.trialIndex = 0;
  state.trialData = [];
  state.trials = experiment === 1
    ? makeVisualSearchTrials()
    : makeConflictTrials();

  showScreen("taskScreen");
  $("taskSubtitle").textContent = experiment === 1
    ? "MISSION 01 / VISUAL SEARCH"
    : "MISSION 02 / UI STROOP";

  $("taskInstructionTitle").textContent = experiment === 1
    ? "寻找隐藏选项"
    : "根据文字含义选择";

  $("taskInstructionText").textContent = experiment === 1
    ? "请尽快找到并点击“暂不领取”。"
    : "请根据文字内容判断操作含义，不要只看按钮颜色。";

  nextTrial();
}

function updateProgress() {
  const total = state.trials.length;
  const current = state.trialIndex;
  const percent = Math.round(current / total * 100);
  $("trialCounter").textContent = `TRIAL ${Math.min(current + 1, total)} / ${total}`;
  $("taskPercent").textContent = `${percent}%`;
  $("taskProgressBar").style.width = `${percent}%`;
}

async function nextTrial() {
  state.trialActive = false;
  $("trialFeedback").hidden = true;
  $("visualSearchStage").hidden = true;
  $("conflictStage").hidden = true;
  $("fixationStage").hidden = false;
  updateProgress();

  if (state.trialIndex >= state.trials.length) {
    finishExperiment();
    return;
  }

  // 空白屏注视点阶段，与正式刺激分开。
  await sleep(rand(1100, 1500));
  $("fixationStage").hidden = true;

  const trial = state.trials[state.trialIndex];
  state.currentTrial = trial;

  if (state.currentExperiment === 1) {
    renderSearchTrial(trial);
    $("visualSearchStage").hidden = false;
  } else {
    renderConflictTrial(trial);
    $("conflictStage").hidden = false;
  }

  state.trialStart = performance.now();
  state.trialActive = true;
  state.mouseEvents = [];

  if (state.gazeInterval) clearInterval(state.gazeInterval);
  state.gazeInterval = setInterval(() => {
    const last = state.gazeSamples[state.gazeSamples.length - 1];
    if (last && state.trialActive) {
      state.currentTrial.lastGaze = {
        x: last.x,
        y: last.y,
        t: last.t
      };
    }
  }, 100);
}

/* =====================================
   EXPERIMENT 1: VISUAL SEARCH
===================================== */

const TILE_LABELS = [
  "会员成长值", "训练营报名", "课程兑换", "账户安全",
  "专属优惠", "运动装备", "饮食记录", "邀请好友",
  "训练计划", "积分商城", "活动规则", "健康报告",
  "智能课程", "专属客服", "运动挑战", "权益说明",
  "签到奖励", "课程收藏", "数据分析", "会员升级",
  "优惠说明", "服务协议", "隐私政策", "推荐活动"
];

function renderSearchTrial(trial) {
  const grid = $("searchContentGrid");
  grid.innerHTML = "";

  const count = trial.distractor_count;
  const labels = shuffle(TILE_LABELS).slice(0, count);
  const targetIndex = Math.min(trial.target_slot, count);
  const items = labels.map((label, i) => ({
    label,
    target: false,
    originalIndex: i
  }));

  items.splice(targetIndex, 0, {
    label: "会员权益详情",
    target: true,
    originalIndex: -1
  });

  items.forEach((item, index) => {
    const tile = document.createElement("div");
    tile.className = "search-tile";
    const title = document.createElement("small");
    title.textContent = item.target ? "会员服务选项" : `SERVICE / ${String(index + 1).padStart(2, "0")}`;
    const label = document.createElement("b");
    label.textContent = item.label;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.target ? "暂不领取" : shuffle(["查看详情", "了解更多", "立即查看", "进入页面"])[0];

    if (item.target) {
      tile.classList.add(trial.salience === "high" ? "target-high" : "target-low");
      button.dataset.target = "true";
      button.addEventListener("click", () => recordSearchResponse(true, index, button));
    } else {
      button.addEventListener("click", () => recordSearchResponse(false, index, button));
    }

    tile.append(title, label, button);
    grid.appendChild(tile);
  });

  // 为布局添加随机顺序，避免目标总在固定垂直位置。
  trial.renderedTargetIndex = targetIndex;
  trial.targetPosition = targetIndex;
}

function recordSearchResponse(isTarget, slot, element) {
  if (!state.trialActive) return;
  if (isTarget) {
    finishTrial(true, "target_found", slot);
  } else {
    finishTrial(false, "distractor_clicked", slot);
  }
}

/* =====================================
   EXPERIMENT 2: UI STROOP
===================================== */

function renderConflictTrial(trial) {
  const area = $("conflictButtonArea");
  area.innerHTML = "";
  $("consequenceHint").hidden = true;

  const textOptions = [
    { label: "继续保留订阅", action: "keep" },
    { label: "确认取消订阅", action: "cancel" }
  ];

  const shuffled = shuffle(textOptions);
  const match = trial.congruency === "congruent";

  shuffled.forEach(option => {
    const button = document.createElement("button");
    button.className = "conflict-choice";
    button.textContent = option.label;

    // 一致条件：按钮颜色与语义一致。
    // 冲突条件：颜色与语义映射反转。
    const isPositive = option.action === "keep";
    const green = match ? isPositive : !isPositive;
    button.classList.add(green ? "confirm" : "cancel");

    button.addEventListener("mouseenter", () => {
      const t = performance.now() - state.trialStart;
      state.mouseEvents.push({
        type: "hover",
        action: option.action,
        time_ms: t
      });

      if (trial.cue === "consequence") {
        showConsequence(option.action);
      }
    });

    button.addEventListener("click", () => {
      const t = performance.now() - state.trialStart;
      state.mouseEvents.push({
        type: "click",
        action: option.action,
        time_ms: t
      });

      const correct = option.action === "cancel";
      finishTrial(correct, option.action, null);
    });

    area.appendChild(button);
  });
}

function showConsequence(action) {
  const hint = $("consequenceHint");
  hint.hidden = false;
  hint.textContent = action === "cancel"
    ? "操作后果：确认取消后，当前订阅将停止自动续费，后续会员服务可能无法继续使用。"
    : "操作后果：继续保留订阅将维持当前会员服务及自动续费设置。";
}

/* =====================================
   TRIAL RECORDING
===================================== */

function finishTrial(correct, response, slot) {
  if (!state.trialActive) return;
  state.trialActive = false;

  const rt = performance.now() - state.trialStart;
  const trial = state.currentTrial;

  const gazeWindow = state.gazeSamples.filter(s =>
    s.t >= state.trialStart && s.t <= performance.now()
  );

  const record = {
    experiment: state.currentExperiment,
    trial: state.trialIndex + 1,
    condition: trial.condition,
    correct: !!correct,
    response,
    rt_ms: Math.round(rt),
    target_slot: trial.target_slot ?? null,
    response_slot: slot,
    distractor_count: trial.distractor_count ?? null,
    salience: trial.salience ?? null,
    congruency: trial.congruency ?? null,
    cue: trial.cue ?? null,
    mouse_events: state.mouseEvents,
    gaze_sample_count: gazeWindow.length,
    gaze_samples: gazeWindow.slice(0, 100)
  };

  state.trialData.push(record);

  $("feedbackIcon").textContent = correct ? "✓" : "!";
  $("feedbackTitle").textContent = correct ? "选择正确" : "选择错误";
  $("feedbackDetail").textContent =
    `反应时间：${Math.round(rt)} ms`;
  $("trialFeedback").hidden = false;

  $("visualSearchStage").hidden = true;
  $("conflictStage").hidden = true;

  state.trialIndex++;
  updateProgress();

  clearTimeout(state.feedbackTimer);
  state.feedbackTimer = setTimeout(nextTrial, 350);
}

/* =====================================
   EXPERIMENT COMPLETION AND SUMMARY
===================================== */

function summarize(records) {
  const n = records.length;
  const correct = records.filter(r => r.correct).length;
  const rts = records.filter(r => r.correct && Number.isFinite(r.rt_ms)).map(r => r.rt_ms);
  const meanRT = rts.length
    ? rts.reduce((a, b) => a + b, 0) / rts.length
    : null;

  return {
    n,
    accuracy: n ? correct / n : null,
    correct,
    meanRT
  };
}

function finishExperiment() {
  if (state.gazeInterval) clearInterval(state.gazeInterval);
  const experiment = state.currentExperiment;
  const summary = summarize(state.trialData);

  state.expResults[experiment] = {
    records: state.trialData,
    summary
  };

  $("completionTitle").textContent = `实验 ${experiment} 已完成`;
  $("completionDescription").textContent =
    experiment === 1
      ? "视觉搜索审计任务已完成。请查看本次表现并提交数据。"
      : "交互冲突审计任务已完成。请查看本次表现并提交数据。";

  $("resultTrials").textContent = summary.n;
  $("resultAccuracy").textContent = summary.accuracy === null
    ? "—"
    : `${(summary.accuracy * 100).toFixed(1)}%`;
  $("resultRT").textContent = summary.meanRT === null
    ? "—"
    : `${Math.round(summary.meanRT)} ms`;

  $("continueNextExperimentBtn").hidden = experiment === 2;
  $("finishAllBtn").hidden = experiment !== 2;
  $("retryUploadBtn").hidden = true;
  $("uploadStatusText").textContent = "正在提交匿名实验数据……";

  showScreen("experimentEndScreen");
  uploadExperiment(experiment).catch(err => {
    $("uploadStatusText").textContent = `上传失败：${err.message}。请点击重试。`;
    $("retryUploadBtn").hidden = false;
  });
}

/* =====================================
   DATA UPLOAD
===================================== */

function makeUploadPayload(experiment) {
  const result = state.expResults[experiment];
  return {
    project: PROJECT_CODE,
    experiment: EXPERIMENTS[experiment].name,
    participant: state.participant,
    condition: "within_subject_2x2",
    trials: result.records.map(r => ({
      ...r,
      participant: state.participant,
      eye_quality: state.eyeQuality
    }))
  };
}

async function uploadExperiment(experiment) {
  if (state.uploaded[experiment]) {
    $("uploadStatusText").textContent = "该实验数据已成功提交。";
    return true;
  }

  const payload = makeUploadPayload(experiment);
  state.uploadQueue[experiment] = payload;
  state.lastUploadPayload = payload;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`服务器返回 HTTP ${response.status}`);
  }

  const resultText = await response.text();
  let result = {};
  try {
    result = resultText ? JSON.parse(resultText) : {};
  } catch (_) {
    result = { message: resultText };
  }

  state.uploaded[experiment] = true;
  delete state.uploadQueue[experiment];
  $("uploadStatusText").textContent = "✓ 数据已成功提交。";
  $("retryUploadBtn").hidden = true;
  return result;
}

$("retryUploadBtn").addEventListener("click", async () => {
  $("retryUploadBtn").disabled = true;
  try {
    await uploadExperiment(state.currentExperiment);
    toast("数据上传成功。");
  } catch (err) {
    $("uploadStatusText").textContent = `上传仍然失败：${err.message}`;
    $("retryUploadBtn").hidden = false;
  } finally {
    $("retryUploadBtn").disabled = false;
  }
});

/* =====================================
   EXPERIMENT TRANSITION
===================================== */

$("continueNextExperimentBtn").addEventListener("click", () => {
  if (!state.uploaded[1]) {
    return toast("请先成功提交实验一数据，再继续。");
  }
  startExperiment(2);
});

$("finishAllBtn").addEventListener("click", () => {
  if (!state.uploaded[2]) {
    return toast("请先成功提交实验二数据。");
  }
  showFinalScreen();
});

function showFinalScreen() {
  $("finalParticipantId").textContent = state.participant;
  $("finalExp1Status").textContent = state.uploaded[1] ? "已提交" : "未提交";
  $("finalExp2Status").textContent = state.uploaded[2] ? "已提交" : "未提交";
  $("finalGazeStatus").textContent = state.eyeQuality;
  showScreen("finalScreen");
}

$("returnHomeBtn").addEventListener("click", () => {
  if (state.eyeEnabled && window.webgazer) {
    try { window.webgazer.end(); } catch (_) {}
  }
  location.reload();
});

/* =====================================
   PAGE SAFETY
===================================== */

window.addEventListener("beforeunload", event => {
  if (state.trialActive || Object.keys(state.uploadQueue).length > 0) {
    event.preventDefault();
    event.returnValue = "";
  }
});
