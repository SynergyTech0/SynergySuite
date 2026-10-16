// Synergy Meet — lobby, device preview, meeting room.
import { mountShell, api, el, icon, snackbar, dialog, initials } from '/shared/shell.js';

const S = { stream: null, mic: true, cam: true, code: null, participants: [] };

document.getElementById('shell').appendChild(mountShell({ app: 'meet', search: false }));

function lobby() {
  const video = el('video', { autoplay: true, muted: true, playsinline: true });
  const ph = el('div', { class: 'ph' }, 'Camera is off');
  const preview = el('div', { class: 'preview' }, ph,
    el('div', { class: 'ctrls' },
      el('button', { class: 'rbtn', id: 'pMic', onclick: toggleMic }, icon('mic')),
      el('button', { class: 'rbtn', id: 'pCam', onclick: toggleCam }, icon('videocam'))));

  const joinCode = el('input', { class: 'field', placeholder: 'Enter a code or link', style: 'width:240px;height:44px' });

  const main = el('div', { class: 'lobby' },
    el('div', { class: 'copy' },
      el('h1', {}, 'Video calls and meetings for everyone'),
      el('p', {}, 'Connect, collaborate and celebrate from anywhere with Synergy Meet.'),
      el('div', { class: 'row gap12' },
        el('button', {
          class: 'btn btn-filled', style: 'height:44px',
          onclick: async () => {
            const m = await api.post('/meet/start', { title: 'Instant meeting' });
            enterRoom(m.code);
          },
        }, icon('videocam', 's18'), 'New meeting'),
        joinCode,
        el('button', {
          class: 'btn btn-text', style: 'height:44px',
          onclick: () => joinCode.value.trim() ? enterRoom(joinCode.value.trim()) : snackbar('Enter a meeting code'),
        }, 'Join')),
      el('div', { class: 'divider', style: 'margin:28px 0' }),
      el('p', { style: 'font-size:13px;margin:0' },
        'Your camera and microphone stay on this device until you join. Nothing is recorded.')),
    preview);

  document.getElementById('main').replaceChildren(main);

  // Ask for devices; fall back gracefully when denied or unavailable.
  navigator.mediaDevices?.getUserMedia({ video: true, audio: true })
    .then(stream => {
      S.stream = stream;
      video.srcObject = stream;
      preview.replaceChildren(video, preview.querySelector('.ctrls'));
    })
    .catch(() => { ph.textContent = 'No camera available — you can still join'; });
}

function toggleMic() {
  S.mic = !S.mic;
  S.stream?.getAudioTracks().forEach(t => t.enabled = S.mic);
  for (const id of ['pMic', 'rMic']) {
    const b = document.getElementById(id);
    if (b) { b.classList.toggle('off', !S.mic); b.replaceChildren(icon(S.mic ? 'mic' : 'mic_off')); }
  }
}
function toggleCam() {
  S.cam = !S.cam;
  S.stream?.getVideoTracks().forEach(t => t.enabled = S.cam);
  for (const id of ['pCam', 'rCam']) {
    const b = document.getElementById(id);
    if (b) { b.classList.toggle('off', !S.cam); b.replaceChildren(icon(S.cam ? 'videocam' : 'videocam_off')); }
  }
  renderTiles();
}

// ------------------------------------------------------------------ room
async function enterRoom(code) {
  S.code = code;
  S.participants = [
    { name: 'Shane Ansel', me: true },
    { name: 'Dana Reyes' },
    { name: 'Miguel Ortiz' },
  ];
  document.getElementById('room').classList.add('on');
  document.getElementById('roomInfo').textContent = code;
  renderTiles();
  if (!S.stream) {
    try { S.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); renderTiles(); }
    catch { /* joining without devices is normal */ }
  }
}

function renderTiles() {
  const tiles = document.getElementById('tiles');
  const n = S.participants.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  tiles.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;
  tiles.replaceChildren(...S.participants.map(p => {
    const t = el('div', { class: 'tile' });
    if (p.me && S.stream && S.cam) {
      const v = el('video', { autoplay: true, muted: true, playsinline: true });
      v.srcObject = S.stream;
      t.append(v);
    } else {
      t.append(el('div', { class: 'big' }, initials(p.name)));
    }
    t.append(el('span', { class: 'nm' }, p.name + (p.me ? ' (You)' : '')));
    return t;
  }));
}

document.getElementById('rMic').addEventListener('click', toggleMic);
document.getElementById('rCam').addEventListener('click', toggleCam);
document.getElementById('rShare').addEventListener('click', async () => {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
    S.stream = s; S.cam = true; renderTiles();
    snackbar('You are presenting to everyone');
  } catch { snackbar('Screen sharing was cancelled'); }
});
document.getElementById('rEnd').addEventListener('click', () => {
  document.getElementById('room').classList.remove('on');
  S.stream?.getTracks().forEach(t => t.stop());
  S.stream = null;
  lobby();
  snackbar('You left the meeting');
});
document.getElementById('rPeople').addEventListener('click', () =>
  dialog(`People (${S.participants.length})`, el('div', {},
    ...S.participants.map(p => el('div', { class: 'row gap12', style: 'padding:8px 0' },
      el('div', { class: 'avatar' }, initials(p.name)),
      el('span', { class: 'spacer' }, p.name + (p.me ? ' (You)' : '')),
      icon('mic')))), [{ label: 'Close', primary: true }]));
document.getElementById('rChat').addEventListener('click', () => location.href = '/chat/');

const code = new URLSearchParams(location.search).get('code');
lobby();
if (code) enterRoom(code);
