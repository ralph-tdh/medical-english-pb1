'use strict';
/* ============================================================
   Medical English — PocketBook engine (shell)
   Renders any lesson defined in window.LESSON.
   Behaviour & markup are a faithful port of PB1 v6.
   ============================================================ */

if (typeof window.LESSON === 'undefined') {
  document.getElementById('app').innerHTML =
    '<div style="max-width:460px;margin:40px auto;padding:24px;font-family:sans-serif;color:#A82040">'
    + '<b>No lesson loaded.</b><br>window.LESSON is undefined. '
    + 'Load a lesson file before engine.js.</div>';
  throw new Error('LESSON not defined');
}

/* ── DATA (from lesson file) ──────────────────────────────── */
var L     = window.LESSON;
var SITS  = L.situations;
var QZS   = L.quiz;
var META  = L.meta;
var CFG   = L.config || {};
var WEL   = L.welcome || {};
var DONE  = L.done || {};

/* ── CONSTANTS ────────────────────────────────────────────── */
var TH = [
  {c:'#E84D6A',bg:'#FEF0F4',sh:'#B8304A'},
  {c:'#1CB897',bg:'#E4FAF4',sh:'#0D8A6D'},
  {c:'#7B5EA7',bg:'#F0EAFF',sh:'#5C4080'},
  {c:'#D48A00',bg:'#FFF7DC',sh:'#A86400'}
];
var ALPHA = ['A','B','C','D'];
var ANN_COLS = ['#E84D6A','#1CB897','#7B5EA7','#D48A00','#4A8FE8'];

/* themeFor — supports lessons with >4 situations by cycling */
function themeFor(i) { return TH[i % TH.length]; }

/* ── AUDIO ENGINE ─────────────────────────────────────────── */
var _audioRate = 0.85;
var _ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function speak(text) {
  if (!_ttsSupported) return;
  window.speechSynthesis.cancel();
  setTimeout(function() {
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = _audioRate;
    window.speechSynthesis.speak(u);
  }, 50);
}

function toggleSpeed() {
  _audioRate = _audioRate > 0.75 ? 0.65 : 0.85;
  var btn = document.getElementById('speed-toggle');
  if (!btn) return;
  var isSlow = _audioRate < 0.75;
  btn.innerHTML = isSlow ? '🐢 Slow' : '🔊 Normal';
  btn.style.background  = isSlow ? '#E4FAF4' : '#f0f0f0';
  btn.style.borderColor = isSlow ? '#1CB897' : '#CCC';
  btn.style.color       = isSlow ? '#0A7A60' : '#777';
  btn.style.boxShadow   = isSlow ? '2px 2px 0 #0D8A6D' : '2px 2px 0 #CCC';
}

/* ── STATE ────────────────────────────────────────────────── */
var S = {
  screen: 'welcome',
  si: 0, phase: 'learn', pqSel: null, sOpts: null,
  qi: 0, allOpts: [], qSel: null, qDone: false, qScore: 0
};

/* ── HELPERS ──────────────────────────────────────────────── */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function shuffle(arr) {
  var a = arr.map(function(o){ return Object.assign({},o); });
  for (var i = a.length-1; i > 0; i--) {
    var j = Math.floor(Math.random()*(i+1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function annHTML(text, gl) {
  var keys = Object.keys(gl || {});
  if (!keys.length) return esc(text);
  var escaped = keys.map(function(k){ return k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); });
  var pat = new RegExp('('+escaped.join('|')+')','gi');
  var parts = text.split(pat);
  return parts.map(function(p) {
    var key = null;
    for (var k=0; k<keys.length; k++) {
      if (keys[k].toLowerCase() === p.toLowerCase()) { key = keys[k]; break; }
    }
    if (!key) return esc(p);
    var col = ANN_COLS[keys.indexOf(key) % ANN_COLS.length];
    return '<span style="display:inline-block;position:relative;vertical-align:baseline;margin:0 2px;padding-top:12px">'
      +'<span style="position:absolute;top:0;left:50%;transform:translateX(-50%);font-size:9px;color:'+col+';font-weight:900;white-space:nowrap;line-height:1;font-style:italic">'+esc(gl[key])+'</span>'
      +'<mark style="background:'+col+'22;color:'+col+';font-weight:800;border-radius:5px;padding:2px 5px;border:1.5px solid '+col+'55;line-height:1.4">'+esc(p)+'</mark>'
      +'</span>';
  }).join('');
}

function progBar(pct) {
  var border = pct > 2 ? 'border-right:3px solid #2A2A2A' : '';
  return '<div style="height:8px;background:#EEE;position:sticky;top:0;z-index:20;border-bottom:2px solid #2A2A2A">'
    +'<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#E84D6A,#D48A00,#1CB897,#7B5EA7);transition:width .6s cubic-bezier(.34,1.56,.64,1);'+border+'"></div>'
    +'</div>';
}

function calcPct() {
  if (S.screen === 'welcome') return 0;
  if (S.screen === 'sit') {
    var phaseOff = S.phase === 'practice' ? 1 : 0;
    return Math.round((S.si*2 + phaseOff) / (SITS.length*2) * 65);
  }
  if (S.screen === 'quiz') {
    return 65 + Math.round((S.qi + (S.qDone ? 1 : 0)) / QZS.length * 35);
  }
  return 100;
}

function badge(letter, state) {
  var bgs = {u:'#2A2A2A',ok:'#1CB897',no:'#E84D6A',dim:'#EEE'};
  var fgs = {u:'#fff',ok:'#fff',no:'#fff',dim:'#CCC'};
  var lbl = state==='ok' ? '✓' : state==='no' ? '✗' : letter;
  var extra = state==='u' ? 'border:2px solid #2A2A2A;' : '';
  return '<span style="width:27px;height:27px;border-radius:50%;background:'+bgs[state]+';color:'+fgs[state]+';display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex-shrink:0;'+extra+'">'+lbl+'</span>';
}

/* ── NAVIGATION ───────────────────────────────────────────── */
function goTo(screen) { S.screen = screen; renderApp(); window.scrollTo(0,0); }

function renderApp() {
  var app = document.getElementById('app');
  if (!app) return;
  var html;
  if      (S.screen === 'welcome')   html = renderWelcome();
  else if (S.screen === 'sit')       html = renderSit();
  else if (S.screen === 'quiz')      html = renderQuiz();
  else if (S.screen === 'flashcard') html = renderFlashcard();
  else if (S.screen === 'revquiz')   html = renderRevQuiz();
  else if (S.screen === 'rqdone')    html = renderRqDone();
  else                               html = renderDone();
  app.innerHTML = html;
}

/* ── WELCOME ──────────────────────────────────────────────── */
function renderWelcome() {
  var sitRows = SITS.map(function(s,i) {
    var th = themeFor(i);
    return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;'+(i<SITS.length-1?'border-bottom:1.5px dashed #EEE':'')+'">'
      +'<div style="width:42px;height:42px;border-radius:12px;border:2.5px solid '+th.c+';background:'+th.bg+';display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;box-shadow:3px 3px 0 '+th.sh+'">'+s.emoji+'</div>'
      +'<div>'
        +'<div style="font-weight:800;font-size:14px;color:#2A2A2A">'+esc(s.en)+'</div>'
        +'<div style="font-size:11px;color:#AAA;font-style:italic">'+esc(s.vi)+'</div>'
      +'</div>'
    +'</div>';
  }).join('');

  var badges = (WEL.badges || []).map(function(x){
    return '<span style="padding:5px 12px;border-radius:20px;border:2px solid #2A2A2A;font-size:12px;font-weight:800;background:#fff;box-shadow:2px 2px 0 #2A2A2A">'+x.icon+' '+esc(x.label)+'</span>';
  }).join('');

  var canDoRows = (WEL.can_do || []).map(function(item){
    return '<div style="display:flex;align-items:flex-start;gap:9px;padding:5px 0">'
      +'<span style="color:#1CB897;font-weight:900;font-size:15px;flex-shrink:0;line-height:1.4">✓</span>'
      +'<div>'
        +'<div style="font-size:13px;font-weight:700;color:#1A1A1A;line-height:1.45">'+esc(item.en)+'</div>'
        +'<div style="font-size:11px;color:#AAA;font-style:italic;line-height:1.4">'+esc(item.vi)+'</div>'
      +'</div>'
    +'</div>';
  }).join('');
  var canDoBlock = '<div style="background:#E4FAF4;border-radius:14px;padding:13px 15px;border:2.5px solid #1CB897;box-shadow:3px 3px 0 #0D8A6D;margin-bottom:14px">'
    +'<div style="font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#0D8A6D;margin-bottom:9px">After this lesson, you\'ll be able to — Sau bài này bạn có thể:</div>'
    +canDoRows
  +'</div>';

  var scenarioRows = (WEL.scenario || []).map(function(line, i, arr){
    var wrapOpen = i < arr.length-1 ? '<div style="margin-bottom:8px">' : '<div>';
    var enStyle = line.bold
      ? 'font-size:13px;font-weight:900;color:#2A2A2A;line-height:1.6'
      : 'font-size:13px;color:#2A2A2A;line-height:1.6';
    return wrapOpen+'<div style="'+enStyle+'">'+esc(line.en)+'</div>'
      +'<div style="font-size:12px;color:#AAA;font-style:italic;line-height:1.5">'+esc(line.vi)+'</div></div>';
  }).join('');

  return '<div>'
    +'<div style="height:10px;background:linear-gradient(90deg,#E84D6A,#D48A00,#1CB897,#7B5EA7);border-bottom:2.5px solid #2A2A2A"></div>'
    +'<div style="max-width:460px;margin:0 auto;padding:24px 16px" class="su">'
      +'<div style="text-align:center;margin-bottom:24px">'
        +'<div class="wobble" style="width:80px;height:80px;border-radius:50%;border:3px solid #2A2A2A;background:#fff;box-shadow:5px 5px 0 #2A2A2A;display:flex;align-items:center;justify-content:center;font-size:38px;margin:0 auto 16px">'+(META.hero_emoji||'🏥')+'</div>'
        +'<h1 class="hf" style="font-size:22px;font-weight:800;line-height:1.35;color:#2A2A2A;margin:0 0 4px">'+esc(META.title_en)+'</h1>'
        +'<div style="font-size:13px;color:#AAA;font-style:italic;margin-bottom:16px">'+esc(META.title_vi)+'</div>'
        +'<div style="background:#fff;border-radius:16px;padding:14px 16px;border:2.5px solid #DDD;box-shadow:4px 4px 0 #CCC;text-align:left;margin-bottom:20px">'
          +scenarioRows
        +'</div>'
      +'</div>'
      +'<div style="background:#fff;border-radius:16px;padding:14px 16px;border:2.5px solid #2A2A2A;box-shadow:4px 4px 0 #2A2A2A;margin-bottom:14px">'
        +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#2A2A2A;font-weight:800;margin-bottom:10px">In this lesson — Nội dung bài học</div>'
        +sitRows
      +'</div>'
      +canDoBlock
      +'<div style="display:flex;gap:8px;margin-bottom:20px;justify-content:center;flex-wrap:wrap">'+badges+'</div>'
      +'<button class="mbtn" style="background:#FFD166;color:#2A2A2A" onclick="startLesson()">🚀 Let\'s go! — Bắt đầu học ngay</button>'
    +'</div>'
  +'</div>';
}

function startLesson() {
  S.si = 0; S.phase = 'learn'; S.pqSel = null;
  S.sOpts = shuffle(SITS[0].opts);
  goTo('sit');
}

/* ── SITUATION ────────────────────────────────────────────── */
function renderSit() {
  var s = SITS[S.si];
  var th = themeFor(S.si);
  var pct = calcPct();
  var opts = S.sOpts;
  var sel = S.pqSel;
  var answered = sel !== null;
  var isProxy = s.pt.charAt(0) === '(';

  var bubble = '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:6px">'
    +'<div style="width:38px;height:38px;border-radius:50%;background:#EEE;border:2.5px solid #2A2A2A;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;margin-top:2px">👤</div>'
    +'<div style="flex:1">'
      +'<div style="background:'+th.bg+';border:2.5px solid '+th.c+';border-radius:4px 16px 16px 16px;padding:11px 14px;box-shadow:3px 3px 0 '+th.sh+'">'
        +(isProxy
          ? '<div style="font-size:13px;color:#AAA;font-style:italic">'+esc(s.pt)+'</div>'
          : '<div style="font-size:14px;font-weight:800;color:#2A2A2A;line-height:1.45;margin-bottom:5px">&ldquo;'+esc(s.pt)+'&rdquo;</div>'
            +'<div style="height:1px;background:'+th.c+'30;margin-bottom:5px"></div>'
            +'<div style="font-size:12px;font-weight:600;color:'+th.sh+';line-height:1.45;font-style:italic">'+esc(s.pt_vi)+'</div>')
      +'</div>'
    +'</div>'
  +'</div>';

  var header = '<div class="su" style="margin-bottom:14px">'
    +'<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">'
      +'<span style="padding:3px 10px;border-radius:20px;border:2px solid '+th.c+';background:'+th.bg+';color:'+th.c+';font-size:11px;font-weight:800">'+esc(s.tag)+'</span>'
      +'<span style="padding:3px 10px;border-radius:20px;border:2px solid #2A2A2A;background:#fff;color:#2A2A2A;font-size:11px;font-weight:800">'+esc(s.en_tag)+'</span>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:10px">'
      +'<div style="width:48px;height:48px;border-radius:13px;border:2.5px solid '+th.c+';background:'+th.bg+';display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;box-shadow:4px 4px 0 '+th.sh+'">'+s.emoji+'</div>'
      +'<div>'
        +'<h2 class="hf" style="font-size:20px;font-weight:800;color:#2A2A2A">'+esc(s.en)+'</h2>'
        +'<div style="font-size:12px;color:#AAA;font-style:italic">'+esc(s.vi)+'</div>'
      +'</div>'
    +'</div>'
  +'</div>';

  var content = '';

  if (S.phase === 'learn') {
    var phrases = s.phrases.map(function(p,i){
      var border = i < s.phrases.length-1 ? 'margin-bottom:14px;padding-bottom:14px;border-bottom:1.5px dashed #EEE' : '';
      return '<div style="'+border+';display:flex;align-items:flex-start;gap:9px">'
        +'<button onclick="speak(this.dataset.w)" data-w="'+esc(p.en)+'" '
          +'style="flex-shrink:0;margin-top:5px;padding:4px 8px;border-radius:8px;border:1.5px solid '+th.c+'55;background:'+th.c+'12;color:'+th.c+';font-size:12px;font-weight:800;cursor:pointer;-webkit-appearance:none;appearance:none;line-height:1;box-shadow:2px 2px 0 '+th.c+'30;transition:transform .1s,box-shadow .1s" '
          +'onmousedown="this.style.transform=\'translate(1px,1px)\';this.style.boxShadow=\'none\'" '
          +'onmouseup="this.style.transform=\'\';this.style.boxShadow=\'2px 2px 0 '+th.c+'30\'" '
          +'ontouchstart="this.style.transform=\'translate(1px,1px)\';this.style.boxShadow=\'none\'" '
          +'ontouchend="this.style.transform=\'\';this.style.boxShadow=\'2px 2px 0 '+th.c+'30\'">🔊</button>'
        +'<div style="flex:1">'
          +'<div style="font-size:14px;font-weight:700;color:'+th.c+';line-height:2.1;margin-bottom:2px">'+annHTML(p.en,p.gl)+'</div>'
          +'<div style="font-size:12px;color:#888;font-style:italic">'+esc(p.vi)+'</div>'
        +'</div>'
      +'</div>';
    }).join('');

    var chips = s.vocab.map(function(v){
      return '<button onclick="speak(this.dataset.w)" data-w="'+esc(v.en)+'" '
        +'style="display:inline-flex;flex-direction:column;align-items:center;padding:7px 12px;border-radius:14px;border:2px solid '+th.c+'70;background:'+th.c+'14;gap:1px;cursor:pointer;-webkit-appearance:none;appearance:none;box-shadow:2px 2px 0 '+th.c+'35;transition:transform .1s,box-shadow .1s;text-align:center" '
        +'onmousedown="this.style.transform=\'translate(1px,1px)\';this.style.boxShadow=\'none\'" '
        +'onmouseup="this.style.transform=\'\';this.style.boxShadow=\'2px 2px 0 '+th.c+'35\'" '
        +'ontouchstart="this.style.transform=\'translate(1px,1px)\';this.style.boxShadow=\'none\'" '
        +'ontouchend="this.style.transform=\'\';this.style.boxShadow=\'2px 2px 0 '+th.c+'35\'">'
        +'<span style="font-size:8.5px;color:#AAA;font-family:monospace;line-height:1.2">/'+esc(v.ipa)+'/</span>'
        +'<span style="font-size:12px;font-weight:800;color:'+th.c+';line-height:1.3">'+esc(v.en)+'</span>'
        +'<span style="font-size:10px;color:'+th.c+'CC;font-weight:600;line-height:1.2;font-style:italic">'+esc(v.vi)+'</span>'
        +'<span style="font-size:9px;margin-top:3px;line-height:1;color:'+th.c+'99">🔊</span>'
      +'</button>';
    }).join('');

    content = '<div class="su">'
      +'<div style="background:#fff;border-radius:16px;padding:14px 16px;border:2.5px solid '+th.c+';box-shadow:4px 4px 0 '+th.sh+';margin-bottom:10px">'
        +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:'+th.c+';font-weight:800;margin-bottom:7px">Scene — Bối cảnh</div>'
        +'<div style="font-size:13px;color:#333;line-height:1.75;margin-bottom:4px">'+esc(s.ctx_en)+'</div>'
        +'<div style="font-size:12px;color:#888;font-style:italic;line-height:1.7">'+esc(s.ctx_vi)+'</div>'
      +'</div>'
      +'<div style="margin-bottom:10px">'
        +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#888;font-weight:800;margin-bottom:7px">Patient says — Bệnh nhân nói</div>'
        +bubble
      +'</div>'
      +'<div style="background:#fff;border-radius:16px;padding:14px 16px;border:2.5px solid #2A2A2A;box-shadow:4px 4px 0 #555;margin-bottom:10px">'
        +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#AAA;font-weight:800;margin-bottom:10px">Key phrases — Các câu then chốt</div>'
        +phrases
      +'</div>'
      +'<div style="background:'+th.bg+';border-radius:16px;padding:14px 16px;border:2.5px solid '+th.sh+';box-shadow:4px 4px 0 '+th.sh+';margin-bottom:16px">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
          +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:'+th.c+';font-weight:800">Additional vocab — Từ vựng bổ sung</div>'
          +'<button id="speed-toggle" onclick="toggleSpeed()" style="font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;border:1.5px solid #CCC;background:#f0f0f0;color:#777;cursor:pointer;-webkit-appearance:none;appearance:none;box-shadow:2px 2px 0 #CCC;transition:all .15s;white-space:nowrap">🔊 Normal</button>'
        +'</div>'
        +'<div style="display:flex;flex-wrap:wrap;gap:7px">'+chips+'</div>'
      +'</div>'
      +'<button class="mbtn" style="background:'+th.c+';color:#fff" onclick="goToPractice()">Practice — Thực hành →</button>'
    +'</div>';

  } else {
    var optButtons = opts.map(function(op,i){
      var isMe = sel === i;
      var isOk = op.ok;
      var cls = 'opt' + (answered ? ' locked' : '') + (answered&&isOk ? ' ok' : answered&&isMe ? ' no' : '') + (answered&&!isOk&&!isMe ? ' dim' : '');
      var bState = !answered ? 'u' : isOk ? 'ok' : isMe ? 'no' : 'dim';
      var onclick = answered ? '' : 'onclick="pqPick('+i+')"';
      var textContent = answered && isOk ? annHTML(op.t, op.gl||{}) : esc(op.t);
      return '<button class="'+cls+'" '+onclick+'>'
        +badge(ALPHA[i], bState)
        +'<span style="line-height:'+(answered&&isOk?'2.1':'1.5')+'">'+textContent+'</span>'
      +'</button>';
    }).join('');

    var tipBox = answered
      ? '<div class="pop" style="background:#FFF7DC;border:2.5px solid #FFD166;border-radius:13px;padding:11px 14px;margin-top:8px;box-shadow:3px 3px 0 #D48A00">'
          +'<div style="font-size:13px;color:#7A5000;font-weight:700;line-height:1.7;margin-bottom:3px">💡 '+esc(s.tip_en)+'</div>'
          +'<div style="font-size:12px;color:#A07020;font-style:italic;line-height:1.6">'+esc(s.tip_vi)+'</div>'
        +'</div>'
      : '';

    var nextLabel = S.si < SITS.length-1
      ? 'Next situation — Tình huống tiếp theo →'
      : 'Start Quiz — Làm bài kiểm tra →';

    var nextBtn = answered
      ? '<div class="pop"><button class="mbtn" style="background:'+th.c+';color:#fff" onclick="nextSit()">'+nextLabel+'</button></div>'
      : '';

    content = '<div class="su">'
      +'<div style="background:#fff;border-radius:16px;padding:14px 16px;border:2.5px solid '+th.c+';box-shadow:4px 4px 0 '+th.sh+';margin-bottom:12px">'
        +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:'+th.c+';font-weight:800;margin-bottom:8px">Practice — Thực hành</div>'
        +'<div style="margin-bottom:14px">'
          +'<div style="font-size:14px;font-weight:700;color:#2A2A2A;line-height:1.6;margin-bottom:3px">'+esc(s.pq_en)+'</div>'
          +'<div style="font-size:12px;color:#AAA;font-style:italic;line-height:1.55">'+esc(s.pq_vi)+'</div>'
        +'</div>'
        +optButtons
        +tipBox
      +'</div>'
      +nextBtn
      +'<button class="obtn" onclick="backToLearn()">← Review phrases — Xem lại các câu</button>'
    +'</div>';
  }

  return progBar(pct)
    +'<div style="max-width:460px;margin:0 auto;padding:16px 16px 28px">'
      +header
      +content
    +'</div>';
}

function goToPractice() { S.phase='practice'; renderApp(); window.scrollTo(0,0); }
function backToLearn()  { S.phase='learn'; S.pqSel=null; renderApp(); window.scrollTo(0,0); }
function pqPick(i)      { if (S.pqSel!==null) return; S.pqSel=i; renderApp(); }

function nextSit() {
  if (S.si < SITS.length-1) {
    S.si++; S.phase='learn'; S.pqSel=null;
    S.sOpts = shuffle(SITS[S.si].opts);
    goTo('sit');
  } else {
    initQuiz();
  }
}

/* ── QUIZ ─────────────────────────────────────────────────── */
function initQuiz() {
  S.allOpts = QZS.map(function(q){ return shuffle(q.opts); });
  S.qi=0; S.qSel=null; S.qDone=false; S.qScore=0;
  goTo('quiz');
}

function renderQuiz() {
  var q = QZS[S.qi];
  var opts = S.allOpts[S.qi];
  var total = QZS.length;
  var answered = S.qDone;
  var sel = S.qSel;
  var okIdx = opts.findIndex(function(o){ return o.ok; });
  var pct = calcPct();

  var optButtons = opts.map(function(op,i){
    var isMe = sel === i;
    var isOk = op.ok;
    var cls = 'opt' + (answered ? ' locked' : '') + (answered&&isOk ? ' ok' : answered&&isMe ? ' no' : '') + (answered&&!isOk&&!isMe ? ' dim' : '');
    var bState = !answered ? 'u' : isOk ? 'ok' : isMe ? 'no' : 'dim';
    var onclick = answered ? '' : 'onclick="qPick('+i+')"';
    var textContent = answered && isOk ? annHTML(op.t, op.gl||{}) : esc(op.t);
    return '<button class="'+cls+'" '+onclick+'>'
      +badge(ALPHA[i], bState)
      +'<span style="line-height:'+(answered&&isOk?'2.1':'1.5')+'">'+textContent+'</span>'
    +'</button>';
  }).join('');

  var feedbackColor = opts[sel] && opts[sel].ok ? '#1CB897' : '#E84D6A';
  var feedbackBg    = opts[sel] && opts[sel].ok ? '#E4FAF4' : '#FEF0F4';
  var feedbackSh    = opts[sel] && opts[sel].ok ? '#0D8A6D' : '#B8304A';
  var feedbackLabel = opts[sel] && opts[sel].ok
    ? '✓ Correct! — Chính xác!'
    : '✗ Correct answer — Đáp án đúng: '+ALPHA[okIdx];
  var feedbackTxt = opts[sel] && opts[sel].ok ? '#0A7A60' : '#A82040';

  var feedback = answered
    ? '<div class="pop" style="background:'+feedbackBg+';border:2.5px solid '+feedbackColor+';border-radius:13px;padding:11px 14px;margin-top:8px;box-shadow:3px 3px 0 '+feedbackSh+'">'
        +'<div style="font-size:12px;font-weight:900;color:'+feedbackTxt+';margin-bottom:4px">'+feedbackLabel+'</div>'
        +'<div style="font-size:13px;color:#333;line-height:1.65;margin-bottom:3px">'+esc(q.exp_en)+'</div>'
        +'<div style="font-size:12px;color:#888;font-style:italic;line-height:1.6">'+esc(q.exp_vi)+'</div>'
      +'</div>'
    : '';

  var nextLabel = S.qi < total-1
    ? 'Next question — Câu hỏi tiếp theo →'
    : 'See results — Xem kết quả →';

  var nextBtn = answered
    ? '<div class="pop"><button class="mbtn" style="background:#7B5EA7;color:#fff;margin-top:12px" onclick="nextQ()">'+nextLabel+'</button></div>'
    : '';

  return progBar(pct)
    +'<div class="su" style="max-width:460px;margin:0 auto;padding:16px 16px 28px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
        +'<span style="padding:3px 12px;border-radius:20px;border:2px solid #7B5EA7;background:#F0EAFF;color:#7B5EA7;font-size:11px;font-weight:800">Quiz · '+(S.qi+1)+' / '+total+'</span>'
        +'<span style="padding:3px 12px;border-radius:20px;border:2px solid #1CB897;background:#E4FAF4;color:#1CB897;font-size:12px;font-weight:900">⭐ '+S.qScore+'</span>'
      +'</div>'
      +'<div style="background:#F0EAFF;border-radius:16px;padding:14px 16px;border:2.5px solid #7B5EA7;box-shadow:4px 4px 0 #5C4080;margin-bottom:12px">'
        +'<div style="margin-bottom:14px">'
          +'<div style="font-size:14px;font-weight:700;color:#2A2A2A;line-height:1.6;margin-bottom:3px">'+esc(q.en)+'</div>'
          +'<div style="font-size:12px;color:#AAA;font-style:italic;line-height:1.55">'+esc(q.vi)+'</div>'
        +'</div>'
        +optButtons
        +feedback
      +'</div>'
      +nextBtn
    +'</div>';
}

function qPick(i) {
  if (S.qDone) return;
  S.qSel=i; S.qDone=true;
  if (S.allOpts[S.qi][i].ok) S.qScore++;
  renderApp();
}

function nextQ() {
  if (S.qi < QZS.length-1) {
    S.qi++; S.qSel=null; S.qDone=false;
    renderApp(); window.scrollTo(0,0);
  } else {
    goTo('done');
  }
}

/* ── DONE ─────────────────────────────────────────────────── */
function renderDone() {
  var total = QZS.length;
  var pct = Math.round(S.qScore/total*100);
  var g;
  if (pct>=80) g={ic:'🏆',en:'Excellent!',vi:'Xuất sắc!',bg:'#E4FAF4',bd:'#1CB897',sh:'#0D8A6D',co:'#0A7A60'};
  else if (pct>=60) g={ic:'👍',en:'Good job!',vi:'Tốt lắm!',bg:'#FFF7DC',bd:'#FFD166',sh:'#D48A00',co:'#8A6200'};
  else g={ic:'📚',en:'Keep going!',vi:'Ôn thêm nhé!',bg:'#FEF0F4',bd:'#E84D6A',sh:'#B8304A',co:'#A82040'};

  var achievementRecap = (DONE.achievements || []).map(function(r){
    return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed #D5F5EE">'
      +'<span style="font-size:20px;flex-shrink:0">'+r.emoji+'</span>'
      +'<div>'
        +'<div style="font-size:13px;font-weight:700;color:#0A7A60;line-height:1.4">✓ '+esc(r.en)+'</div>'
        +'<div style="font-size:11px;color:#AAA;font-style:italic;line-height:1.35">'+esc(r.vi)+'</div>'
      +'</div>'
    +'</div>';
  }).join('');

  var vocabCount = buildAllVocab().length;
  var revCount = revisionQuizCount();

  var nextBtn = '';
  if (CFG.next && CFG.next.url) {
    nextBtn = '<button onclick="window.location.href=window.LESSON.config.next.url" class="mbtn" style="background:#2A2A2A;color:#FFD166;border-color:#2A2A2A;box-shadow:5px 5px 0 #1CB897;margin-bottom:10px;text-align:left;padding:13px 16px">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">'
        +'<div>'
          +'<div style="font-size:15px;font-weight:900;margin-bottom:2px">'+esc(CFG.next.label)+'</div>'
          +'<div style="font-size:10px;color:#888;font-style:italic;margin-top:1px">'+esc(CFG.next.label_vi)+(CFG.next.free ? ' · 🆓 Free' : '')+'</div>'
        +'</div>'
        +'<span style="font-size:22px;flex-shrink:0;color:#FFD166">→</span>'
      +'</div>'
    +'</button>';
  }

  return '<div style="max-width:460px;margin:0 auto;padding:28px 16px" class="pop">'
    +'<div style="text-align:center;margin-bottom:20px">'
      +'<div style="font-size:64px;margin-bottom:12px">'+g.ic+'</div>'
      +'<h2 class="hf" style="font-size:22px;font-weight:800;margin-bottom:4px;color:#2A2A2A">'+esc(META.complete_en||'Lesson complete!')+'</h2>'
      +'<div style="font-size:13px;color:#AAA;font-style:italic;margin-bottom:14px">'+esc(META.complete_vi||'Hoàn thành!')+'</div>'
      +'<div style="display:inline-block;padding:14px 32px;background:'+g.bg+';border:3px solid '+g.bd+';border-radius:18px;box-shadow:5px 5px 0 '+g.sh+'">'
        +'<div class="hf" style="font-size:48px;font-weight:800;color:'+g.co+'">'+S.qScore+'/'+total+'</div>'
        +'<div style="font-size:13px;font-weight:800;color:'+g.co+'">'+g.en+'</div>'
        +'<div style="font-size:12px;color:'+g.co+';font-style:italic">'+g.vi+'</div>'
      +'</div>'
    +'</div>'
    +'<div style="background:#fff;border-radius:16px;padding:14px 16px;border:2.5px solid #1CB897;box-shadow:4px 4px 0 #0D8A6D;margin-bottom:10px">'
      +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#0D8A6D;font-weight:800;margin-bottom:10px">You can now — Bạn đã làm được:</div>'
      +achievementRecap
    +'</div>'
    +'<div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#AAA;font-weight:800;margin:16px 0 10px">What\'s next? — Tiếp theo làm gì?</div>'
    +'<button onclick="initFlashcard()" class="mbtn" style="background:#F0EAFF;color:#5C4080;border-color:#7B5EA7;box-shadow:4px 4px 0 #5C4080;margin-bottom:10px;text-align:left;padding:13px 16px">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">'
        +'<div>'
          +'<div style="font-size:15px;font-weight:900;margin-bottom:2px">📚 Review Flashcards</div>'
          +'<div style="font-size:11px;font-weight:700;color:#7B5EA7;opacity:.85">'+vocabCount+' vocab words · Got it / Again</div>'
          +'<div style="font-size:10px;color:#AAA;font-style:italic;margin-top:1px">Ôn từ vựng · '+vocabCount+' từ · Biết / Chưa biết</div>'
        +'</div>'
        +'<span style="font-size:22px;flex-shrink:0">→</span>'
      +'</div>'
    +'</button>'
    +'<button onclick="initRevQuiz()" class="mbtn" style="background:#E4FAF4;color:#0A7A60;border-color:#1CB897;box-shadow:4px 4px 0 #0D8A6D;margin-bottom:10px;text-align:left;padding:13px 16px">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">'
        +'<div>'
          +'<div style="font-size:15px;font-weight:900;margin-bottom:2px">🧩 Quick Revision Quiz</div>'
          +'<div style="font-size:11px;font-weight:700;color:#1CB897;opacity:.9">'+revCount+' questions · Auto-generated from vocab</div>'
          +'<div style="font-size:10px;color:#AAA;font-style:italic;margin-top:1px">Kiểm tra nhanh · '+revCount+' câu · Tự động tạo</div>'
        +'</div>'
        +'<span style="font-size:22px;flex-shrink:0">→</span>'
      +'</div>'
    +'</button>'
    +nextBtn
    +'<button class="obtn" onclick="restartLesson()">← Try again — Học lại</button>'
  +'</div>';
}

function restartLesson() {
  _audioRate = 0.85;
  window.speechSynthesis && window.speechSynthesis.cancel();
  S = {
    screen:'welcome', si:0, phase:'learn', pqSel:null, sOpts:null,
    qi:0, allOpts:[], qSel:null, qDone:false, qScore:0,
    fcDeck:[], fcKnown:0, fcFlipped:false,
    rqItems:[], rqAllOpts:[], rqIdx:0, rqSel:null, rqDone:false, rqScore:0
  };
  goTo('welcome');
}

/* ── FLASHCARD ENGINE ─────────────────────────────────────── */
function buildAllVocab() {
  var all = [];
  SITS.forEach(function(s){ all = all.concat(s.vocab); });
  return all;
}

function initFlashcard() {
  S.fcDeck = shuffle(buildAllVocab());
  S.fcKnown = 0; S.fcFlipped = false;
  goTo('flashcard');
}

function fcFlip()  { S.fcFlipped = true; renderApp(); }

function fcGotIt() {
  S.fcKnown++;
  S.fcDeck.shift();
  S.fcFlipped = false;
  renderApp(); window.scrollTo(0,0);
}

function fcAgain() {
  var c = S.fcDeck.shift();
  S.fcDeck.push(c);
  S.fcFlipped = false;
  renderApp(); window.scrollTo(0,0);
}

function renderFlashcard() {
  var total = buildAllVocab().length;
  var deck  = S.fcDeck || [];

  if (deck.length === 0) {
    return '<div style="max-width:460px;margin:0 auto;padding:28px 16px" class="pop">'
      +'<div style="text-align:center;margin-bottom:22px">'
        +'<div style="font-size:64px;margin-bottom:10px">🎉</div>'
        +'<h2 class="hf" style="font-size:22px;font-weight:800;color:#2A2A2A;margin-bottom:4px">All cards reviewed!</h2>'
        +'<div style="font-size:13px;color:#AAA;font-style:italic;margin-bottom:16px">Ôn tập xong!</div>'
        +'<div style="display:inline-block;padding:14px 32px;background:#F0EAFF;border:2.5px solid #7B5EA7;border-radius:18px;box-shadow:5px 5px 0 #5C4080">'
          +'<div class="hf" style="font-size:48px;font-weight:800;color:#5C4080">'+S.fcKnown+'/'+total+'</div>'
          +'<div style="font-size:12px;font-weight:800;color:#7B5EA7">Got it first pass — Nhớ ngay lần đầu</div>'
        +'</div>'
      +'</div>'
      +'<button onclick="goTo(\'done\')" class="mbtn" style="background:#7B5EA7;color:#fff;margin-bottom:10px">← Back to summary — Về tóm tắt</button>'
      +'<button onclick="initFlashcard()" class="obtn">↺ Restart flashcards — Làm lại</button>'
    +'</div>';
  }

  var v   = deck[0];
  var done = total - deck.length;
  var pct  = Math.round(done / total * 100);

  var cardHtml = S.fcFlipped
    ? '<div class="pop" style="background:#F0EAFF;border-radius:20px;border:2.5px solid #7B5EA7;box-shadow:5px 5px 0 #5C4080;padding:32px 20px;text-align:center;margin-bottom:12px">'
        +'<div style="font-size:13px;font-family:monospace;color:#7B5EA7;font-weight:600;margin-bottom:6px">/'+esc(v.ipa)+'/</div>'
        +'<div class="hf" style="font-size:30px;font-weight:800;color:#2A2A2A;margin-bottom:10px">'+esc(v.en)+'</div>'
        +'<div style="height:1.5px;background:#7B5EA730;margin-bottom:12px"></div>'
        +'<div style="font-size:22px;font-weight:800;color:#534AB7;margin-bottom:14px">'+esc(v.vi)+'</div>'
        +'<button onclick="speak(this.dataset.w)" data-w="'+esc(v.en)+'" style="padding:5px 16px;border-radius:20px;border:1.5px solid #7B5EA7;background:#fff;color:#7B5EA7;font-size:13px;font-weight:800;cursor:pointer;-webkit-appearance:none;appearance:none">🔊 '+esc(v.en)+'</button>'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" class="pop">'
        +'<button onclick="fcAgain()" class="mbtn" style="background:#FEF0F4;color:#A82040;border-color:#E84D6A;box-shadow:4px 4px 0 #B8304A">✗ Again</button>'
        +'<button onclick="fcGotIt()" class="mbtn" style="background:#E4FAF4;color:#0A7A60;border-color:#1CB897;box-shadow:4px 4px 0 #0D8A6D">✓ Got it</button>'
      +'</div>'
    : '<button onclick="fcFlip()" style="width:100%;background:#fff;border-radius:20px;border:2.5px solid #2A2A2A;box-shadow:5px 5px 0 #2A2A2A;padding:52px 20px;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;margin-bottom:12px;-webkit-appearance:none;appearance:none;transition:transform .1s,box-shadow .1s" '
        +'onmousedown="this.style.transform=\'translate(2px,2px)\';this.style.boxShadow=\'2px 2px 0 #2A2A2A\'" '
        +'onmouseup="this.style.transform=\'\';this.style.boxShadow=\'5px 5px 0 #2A2A2A\'" '
        +'ontouchstart="this.style.transform=\'translate(2px,2px)\';this.style.boxShadow=\'2px 2px 0 #2A2A2A\'" '
        +'ontouchend="this.style.transform=\'\';this.style.boxShadow=\'5px 5px 0 #2A2A2A\'">'
        +'<div style="font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#CCC;font-weight:800;margin-bottom:16px">What does this mean? — Nghĩa là gì?</div>'
        +'<div class="hf" style="font-size:34px;font-weight:800;color:#2A2A2A;line-height:1.2">'+esc(v.en)+'</div>'
        +'<div style="font-size:11px;color:#CCC;margin-top:18px">Tap to reveal — Nhấn để xem nghĩa</div>'
      +'</button>';

  return '<div style="height:8px;background:#EEE;position:sticky;top:0;z-index:20;border-bottom:2px solid #2A2A2A">'
      +'<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#7B5EA7,#534AB7);transition:width .4s ease;'+(pct>2?'border-right:3px solid #2A2A2A':'')+';"></div>'
    +'</div>'
    +'<div class="su" style="max-width:460px;margin:0 auto;padding:16px 16px 28px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'
        +'<span style="padding:3px 12px;border-radius:20px;border:2px solid #7B5EA7;background:#F0EAFF;color:#7B5EA7;font-size:11px;font-weight:800">📚 Cards · '+done+' / '+total+'</span>'
        +'<button onclick="goTo(\'done\')" style="font-size:12px;font-weight:700;color:#AAA;background:none;border:none;cursor:pointer;padding:4px 8px;-webkit-appearance:none">✕ Exit</button>'
      +'</div>'
      +cardHtml
    +'</div>';
}

/* ── REVISION QUIZ ENGINE ─────────────────────────────────── */
/* Number of revision questions: min(6, vocab count) so small decks still work */
function revisionQuizCount() {
  return Math.min(6, buildAllVocab().length);
}

function buildRevisionQuiz(n) {
  var all  = buildAllVocab();
  var pool = shuffle(all);
  return pool.slice(0, n).map(function(v) {
    var wrongs = shuffle(all.filter(function(x){ return x.en !== v.en; })).slice(0, 3);
    return {
      q_en: 'What does "' + v.en + '" mean?',
      q_vi: '"' + v.en + '" nghĩa là gì?',
      word: v.en, ipa: v.ipa,
      opts: shuffle([
        {t: v.vi,         ok: true  },
        {t: wrongs[0].vi, ok: false },
        {t: wrongs[1].vi, ok: false },
        {t: wrongs[2].vi, ok: false }
      ]),
      exp_en: '"' + v.en + '" /' + v.ipa + '/ = ' + v.vi,
      exp_vi: 'Phát âm: /' + v.ipa + '/'
    };
  });
}

function initRevQuiz() {
  S.rqItems    = buildRevisionQuiz(revisionQuizCount());
  S.rqAllOpts  = S.rqItems.map(function(q){ return q.opts; });
  S.rqIdx = 0; S.rqSel = null; S.rqDone = false; S.rqScore = 0;
  goTo('revquiz');
}

function rqPick(i) {
  if (S.rqDone) return;
  S.rqSel = i; S.rqDone = true;
  if (S.rqAllOpts[S.rqIdx][i].ok) S.rqScore++;
  renderApp();
}

function nextRq() {
  if (S.rqIdx < S.rqItems.length - 1) {
    S.rqIdx++; S.rqSel = null; S.rqDone = false;
    renderApp(); window.scrollTo(0,0);
  } else {
    goTo('rqdone');
  }
}

function renderRevQuiz() {
  var items = S.rqItems || [];
  var total = items.length;
  if (!total) return '<div></div>';
  var q        = items[S.rqIdx];
  var opts     = S.rqAllOpts[S.rqIdx];
  var answered = S.rqDone;
  var sel      = S.rqSel;
  var okIdx    = opts.findIndex(function(o){ return o.ok; });
  var fOk      = opts[sel] && opts[sel].ok;
  var pct      = Math.round((S.rqIdx + (answered ? 1 : 0)) / total * 100);

  var optBtns = opts.map(function(op, i) {
    var isMe = sel === i, isOk = op.ok;
    var cls  = 'opt' + (answered ? ' locked' : '')
      + (answered && isOk  ? ' ok'  : '')
      + (answered && isMe && !isOk ? ' no'  : '')
      + (answered && !isOk && !isMe ? ' dim' : '');
    var bState = !answered ? 'u' : isOk ? 'ok' : isMe ? 'no' : 'dim';
    return '<button class="'+cls+'" '+(answered?'':'onclick="rqPick('+i+')"')+'>'
      +badge(ALPHA[i], bState)
      +'<span style="line-height:1.5">'+esc(op.t)+'</span>'
    +'</button>';
  }).join('');

  var feedback = answered
    ? '<div class="pop" style="background:'+(fOk?'#E4FAF4':'#FEF0F4')+';border:2.5px solid '+(fOk?'#1CB897':'#E84D6A')+';border-radius:13px;padding:11px 14px;margin-top:8px;box-shadow:3px 3px 0 '+(fOk?'#0D8A6D':'#B8304A')+'">'
        +'<div style="font-size:12px;font-weight:900;color:'+(fOk?'#0A7A60':'#A82040')+';margin-bottom:4px">'+(fOk?'✓ Correct! — Chính xác!':'✗ Correct answer: '+ALPHA[okIdx])+'</div>'
        +'<div style="font-size:13px;color:#333;line-height:1.65;margin-bottom:2px">'+esc(q.exp_en)+'</div>'
        +'<div style="font-size:11px;color:#888;font-style:italic">'+esc(q.exp_vi)+'</div>'
      +'</div>'
    : '';

  return '<div style="height:8px;background:#EEE;position:sticky;top:0;z-index:20;border-bottom:2px solid #2A2A2A">'
      +'<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#7B5EA7,#1CB897);transition:width .5s ease;'+(pct>2?'border-right:3px solid #2A2A2A':'')+';"></div>'
    +'</div>'
    +'<div class="su" style="max-width:460px;margin:0 auto;padding:16px 16px 28px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
        +'<span style="padding:3px 12px;border-radius:20px;border:2px solid #7B5EA7;background:#F0EAFF;color:#7B5EA7;font-size:11px;font-weight:800">🧩 Revision · '+(S.rqIdx+1)+' / '+total+'</span>'
        +'<span style="padding:3px 12px;border-radius:20px;border:2px solid #1CB897;background:#E4FAF4;color:#1CB897;font-size:12px;font-weight:900">⭐ '+S.rqScore+'</span>'
      +'</div>'
      +'<div style="background:#F0EAFF;border-radius:16px;padding:14px 16px;border:2.5px solid #7B5EA7;box-shadow:4px 4px 0 #5C4080;margin-bottom:12px">'
        +'<div style="margin-bottom:14px">'
          +'<div style="font-size:14px;font-weight:700;color:#2A2A2A;line-height:1.6;margin-bottom:3px">'+esc(q.q_en)+'</div>'
          +'<div style="font-size:12px;color:#AAA;font-style:italic">'+esc(q.q_vi)+'</div>'
        +'</div>'
        +optBtns
        +feedback
      +'</div>'
      +(answered
        ? '<div class="pop"><button class="mbtn" style="background:#7B5EA7;color:#fff;margin-top:4px" onclick="nextRq()">'
            +(S.rqIdx<total-1?'Next — Câu tiếp →':'See results — Kết quả →')
          +'</button></div>'
        : '')
    +'</div>';
}

function renderRqDone() {
  var total = (S.rqItems || []).length;
  var pct   = total ? Math.round(S.rqScore / total * 100) : 0;
  var g;
  if (pct >= 84) g={ic:'🏆',en:'Perfect!',    vi:'Hoàn hảo!',    bg:'#E4FAF4',bd:'#1CB897',sh:'#0D8A6D',co:'#0A7A60'};
  else if(pct>=50)g={ic:'👍',en:'Good job!',   vi:'Tốt lắm!',     bg:'#FFF7DC',bd:'#FFD166',sh:'#D48A00',co:'#8A6200'};
  else           g={ic:'📚',en:'Keep going!',  vi:'Ôn thêm nhé!', bg:'#FEF0F4',bd:'#E84D6A',sh:'#B8304A',co:'#A82040'};

  return '<div style="max-width:460px;margin:0 auto;padding:28px 16px" class="pop">'
    +'<div style="text-align:center;margin-bottom:22px">'
      +'<div style="font-size:64px;margin-bottom:10px">'+g.ic+'</div>'
      +'<h2 class="hf" style="font-size:22px;font-weight:800;color:#2A2A2A;margin-bottom:4px">Revision complete!</h2>'
      +'<div style="font-size:13px;color:#AAA;font-style:italic;margin-bottom:16px">Kiểm tra nhanh hoàn thành!</div>'
      +'<div style="display:inline-block;padding:14px 32px;background:'+g.bg+';border:3px solid '+g.bd+';border-radius:18px;box-shadow:5px 5px 0 '+g.sh+'">'
        +'<div class="hf" style="font-size:48px;font-weight:800;color:'+g.co+'">'+S.rqScore+'/'+total+'</div>'
        +'<div style="font-size:13px;font-weight:800;color:'+g.co+'">'+g.en+'</div>'
        +'<div style="font-size:12px;color:'+g.co+';font-style:italic">'+g.vi+'</div>'
      +'</div>'
    +'</div>'
    +'<button onclick="goTo(\'done\')" class="mbtn" style="background:#7B5EA7;color:#fff;margin-bottom:10px">← Back to summary — Về tóm tắt</button>'
    +'<button onclick="initRevQuiz()" class="obtn">↺ Try quiz again — Làm lại</button>'
  +'</div>';
}

/* ── INIT ─────────────────────────────────────────────────── */
renderApp();
