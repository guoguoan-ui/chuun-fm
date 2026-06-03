/* CHUUN FM */
(function(){'use strict';
const $=id=>document.getElementById(id);
let ap=new Audio(),tp=new Audio(),q=[],qi=0,isP=false,lrcLines=[],vOn=localStorage.getItem('chuun-voice')!=='off';

// ─── Clock ───
function clock(){
  const n=new Date();
  $('clockTime').textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
  const d=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  $('clockDate').textContent=d[n.getDay()]+' '+n.getFullYear()+'.'+(n.getMonth()+1)+'.'+n.getDate();
}
clock();setInterval(clock,1000);

// ─── Screen Wake Lock（保持屏幕常亮，做屏保） ───
let wakeLock=null;
async function requestWakeLock(){
  try{if('wakeLock'in navigator){wakeLock=await navigator.wakeLock.request('screen');}}catch(e){}
}
requestWakeLock();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!wakeLock)requestWakeLock()});

// 双击时钟切换屏保模式（隐藏控件，只留大时钟）
$('clockTime').addEventListener('dblclick',()=>{
  document.body.classList.toggle('screensaver');
  if(document.body.classList.contains('screensaver'))requestWakeLock();
});

// ─── Theme ───
const themes=['ocean','pink','earth'];
let curTheme=localStorage.getItem('chuun-theme')||'ocean';
document.body.dataset.theme=curTheme;
document.querySelectorAll('.theme-dot').forEach(d=>d.classList.toggle('active',d.dataset.theme===curTheme));
document.querySelectorAll('.theme-dot').forEach(d=>{
  d.addEventListener('click',()=>{
    curTheme=d.dataset.theme;document.body.dataset.theme=curTheme;
    localStorage.setItem('chuun-theme',curTheme);
    document.querySelectorAll('.theme-dot').forEach(x=>x.classList.toggle('active',x.dataset.theme===curTheme));
  });
});

// ─── Quote ───
const quotes=[
  "Music is the shorthand of emotion.", "Where words fail, music speaks.",
  "Life is better with a soundtrack.", "Feel the music, forget the noise.",
  "Let the rhythm move your soul.", "Every song has a story.",
  "Music = memories + magic.", "Close your eyes and listen.",
  "Good music, good mood.", "Let the melody carry you away.",
  "Sound is the architecture of feeling.", "Your day needs a playlist.",
  "Music washes away the dust of life.", "Find your sound.",
  "One good song can change your day."
];
let qiIdx=Math.floor(Math.random()*quotes.length);
setInterval(()=>{qiIdx=(qiIdx+1)%quotes.length;$('quoteLine').textContent='"'+quotes[qiIdx]+'"'},9000);

async function api(u,o){try{const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o});return await r.json()}catch(e){return null}}

// ─── Player ───
function play(s){
  if(!s||!s.url)return;
  ap.src=s.url;ap.volume=0.7;
  ap.play().then(()=>{$('npTitle').textContent=s.name||'';$('npArtist').textContent=(s.artists||[]).join(', ')||'';isP=true;$('icoPlay').style.display='none';$('icoPause').style.display='block'}).catch(()=>{});
  if(s.id||s.url)getLRC(s.id||s.url);
}
function getLRC(id){
  const lid=id&&!isNaN(id)?id:(id||'').match(/id=(\d+)/)?.[1]||'';
  if(!lid)return;
  api('/api/lyrics?id='+lid).then(d=>{
    const sc=$('lyricsScroll'),bx=$('lyricsBox');
    if(!sc||!bx)return;
    if(d&&d.lrc){lrcLines=parseLRC(d.lrc);if(lrcLines.length){sc.innerHTML='';lrcLines.forEach((ln,i)=>{const div=document.createElement('div');div.className='lrc-line';div.dataset.idx=i;div.textContent=ln.text;sc.appendChild(div)});bx.style.display='block';return}}
    bx.style.display='none';
  });
}
function parseLRC(t){if(!t)return[];const r=[];t.split('\n').forEach(l=>{const m=l.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);if(m){const t=parseInt(m[1])*60+parseInt(m[2])+parseInt((m[3]+'000').slice(0,3))/1000,text=m[4].trim();if(text)r.push({time:t,text})}});return r.sort((a,b)=>a.time-b.time)}

ap.addEventListener('timeupdate',()=>{
  if(ap.duration)$('progressFill').style.width=(ap.currentTime/ap.duration*100)+'%';
  if(!lrcLines.length)return;
  const ct=ap.currentTime;let idx=-1;
  for(let i=lrcLines.length-1;i>=0;i--){if(ct>=lrcLines[i].time-0.05){idx=i;break}}
  const ls=$('lyricsScroll')?.querySelectorAll('.lrc-line');
  if(!ls)return;
  ls.forEach((el,i)=>{el.classList.toggle('active',i===idx);el.classList.toggle('done',i<idx)});
  if(idx>=0&&ls[idx])ls[idx].scrollIntoView({behavior:'smooth',block:'center'});
});
ap.addEventListener('ended',()=>{if(qi<q.length-1){qi++;play(q[qi])}});
ap.addEventListener('play',()=>{isP=true;$('icoPlay').style.display='none';$('icoPause').style.display='block'});
ap.addEventListener('pause',()=>{isP=false;$('icoPlay').style.display='block';$('icoPause').style.display='none'});

$('btnPlay').addEventListener('click',()=>{if(isP){ap.pause()}else if(ap.src){ap.play()}else if(q.length)play(q[qi])});
$('btnNext').addEventListener('click',()=>{if(qi<q.length-1){qi++;play(q[qi])}});
$('btnPrev').addEventListener('click',()=>{if(qi>0){qi--;play(q[qi])}});

// ─── Search ───
$('btnSearch').addEventListener('click',async()=>{
  const qs=$('searchInput').value.trim();if(!qs)return;
  $('searchResults').innerHTML='<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:11px">Searching...</div>';$('searchResults').style.display='block';
  const songs=await api('/api/search?q='+encodeURIComponent(qs)+'&limit=30');
  if(!songs||!songs.length){$('searchResults').innerHTML='<div style="padding:10px;text-align:center;color:var(--text-muted);font-size:11px">No results</div>';return}
  const pb=songs.filter(s=>s.url);window._sr=pb;
  if(!pb.length){$('searchResults').innerHTML='<div style="padding:10px;text-align:center;color:var(--text-muted)">No playable songs</div>';return}
  $('searchResults').innerHTML=pb.map((s,i)=>'<div class="sr-item" onclick="window._ps('+i+')"><span class="sr-idx">'+(i+1)+'</span><div class="sr-info"><div class="sr-name">'+s.name+'</div><div class="sr-artist">'+((s.artists||[]).join(', '))+'</div></div><span class="sr-play">Play</span></div>').join('');
});
$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnSearch').click()});
window._ps=function(i){const s=window._sr[i];if(!s)return;q=[s];qi=0;play(s);$('searchResults').style.display='none'};

// ─── Chat ───
function send(){
  const t=$('textInput').value.trim();if(!t)return;$('textInput').value='';
  addMsg('You',t,'you');
  api('/api/chat',{method:'POST',body:JSON.stringify({message:t,mode:'chat'})}).then(r=>{
    if(r&&r.say){addMsg('An Yu',r.say);tts(r.say);if(r.play&&r.play.length>0){const s=r.play[0];if(s.url){q=[s];qi=0;play(s)}}}
  });
}
function addMsg(w,t,c){const d=document.createElement('div');d.className='msg'+(c?' you':'');d.innerHTML='<span class="label">'+w+'</span>'+t;$('chatBox').appendChild(d);$('chatBox').scrollTop=$('chatBox').scrollHeight}
$('btnSend').addEventListener('click',send);
$('textInput').addEventListener('keydown',e=>{if(e.key==='Enter')send()});

// ─── TTS ───
function tts(t){if(!vOn||!t)return;api('/api/tts',{method:'POST',body:JSON.stringify({text:t})}).then(r=>{if(r&&r.url){tp.src=r.url;tp.volume=1;if(ap)ap.volume=0.15;tp.play().catch(()=>{});tp.onended=()=>{if(ap)ap.volume=0.7}}})}

// ─── Notes ───
function loadNotes(){
  const items=JSON.parse(localStorage.getItem('chuun-notes')||'[]');
  const list=$('notesList');
  if(!items.length){list.innerHTML='<div style="color:var(--text-muted);font-size:10px;padding:2px 0">No notes yet</div>';return}
  list.innerHTML=items.map((t,i)=>'<div class="note-item"><span>'+t+'</span><button class="note-del" onclick="window._delNote('+i+')">x</button></div>').join('');
}
window._delNote=function(i){const items=JSON.parse(localStorage.getItem('chuun-notes')||'[]');items.splice(i,1);localStorage.setItem('chuun-notes',JSON.stringify(items));loadNotes()};
$('btnAddNote').addEventListener('click',()=>{
  const t=$('notesInput').value.trim();if(!t)return;$('notesInput').value='';
  const items=JSON.parse(localStorage.getItem('chuun-notes')||'[]');items.push(t);localStorage.setItem('chuun-notes',JSON.stringify(items));loadNotes();
});
$('notesInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnAddNote').click()});
loadNotes();

// ─── Greeting ───
setTimeout(async()=>{
  const w=await api('/api/wake');
  if(w&&w.say){addMsg('An Yu',w.say);tts(w.say);if(w.play&&w.play.length>0){const s=w.play[0];if(s.url){q=[s];qi=0;play(s)}}}
},1000);
console.log('CHUUN FM ready');
})();
