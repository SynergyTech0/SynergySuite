/**
 * The chat bubble sites load with
 *   <script defer src="https://livechat.<domain>/widget.js" data-widget="wc_..."></script>
 * It draws inside a shadow root so the site's styles and its own can't clash, sets every text
 * with textContent (nothing a visitor or agent writes is read as HTML), and keeps only the chat's
 * token in localStorage so a reload continues the same chat. It polls while the panel is open.
 */
export const WIDGET = `(function(){
  var s=document.currentScript,key=s&&s.getAttribute('data-widget');if(!key||window.__synergyChat)return;window.__synergyChat=1;
  var base=new URL(s.src,location.href).origin,api=base+'/api/wc/',store='synergy_chat_'+key;
  var tok=null,last=0,open=false,timer=null,cfg={color:'#0f6cbd',greeting:'',name:'Chat',askEmail:true},seen={};
  try{tok=localStorage.getItem(store);}catch(e){}
  function get(p){return fetch(api+p,{credentials:'omit'}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});});}
  function post(p,d){return fetch(api+p,{method:'POST',credentials:'omit',headers:{'content-type':'text/plain'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});});}
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
  var host=el('div');host.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483000';
  var root=host.attachShadow?host.attachShadow({mode:'open'}):host;
  var css=el('style');root.appendChild(css);
  function paint(){css.textContent=':host{all:initial}*{box-sizing:border-box;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
    +'.b{width:56px;height:56px;border-radius:50%;border:0;background:'+cfg.color+';color:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);display:grid;place-items:center;margin-left:auto;position:relative}'
    +'.b svg{width:26px;height:26px}.dot{position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}'
    +'.p{width:340px;max-width:calc(100vw - 40px);height:480px;max-height:calc(100vh - 110px);background:#fff;color:#1f2328;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;margin-bottom:12px}'
    +'.p.o{display:flex}.h{background:'+cfg.color+';color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center}.h span{flex:1}.x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}'
    +'.m{flex:1;overflow-y:auto;padding:12px;background:#f5f6f8}.g{margin:6px 0;padding:8px 12px;border-radius:12px;max-width:82%;white-space:pre-wrap;word-wrap:break-word;width:fit-content}'
    +'.v{background:'+cfg.color+';color:#fff;margin-left:auto;border-bottom-right-radius:3px}.a{background:#fff;border:1px solid #e3e5e9;border-bottom-left-radius:3px}.s{color:#6b7280;font-size:12.5px;text-align:center;margin:8px auto;max-width:90%}'
    +'.who{padding:10px 12px 0;background:#f5f6f8;display:flex;gap:6px}.who input{flex:1;min-width:0;border:1px solid #d8dae5;border-radius:8px;padding:8px;background:#fff}'
    +'.f{display:flex;border-top:1px solid #e3e5e9}.f textarea{flex:1;border:0;padding:12px;resize:none;height:46px;outline:none;background:#fff}.f button{border:0;background:'+cfg.color+';color:#fff;padding:0 16px;cursor:pointer;font-weight:600}'
    +'.e{color:#c4314b;font-size:12.5px;padding:4px 12px;background:#fff}.e:empty{display:none}';}
  paint();
  var panel=el('div','p'),head=el('div','h'),title=el('span',null,'Chat'),close=el('button','x','\\u00d7'),msgs=el('div','m');
  close.setAttribute('aria-label','Close chat');head.appendChild(title);head.appendChild(close);
  var who=el('div','who'),nm=el('input'),em=el('input');nm.placeholder='Your name';em.placeholder='Email (so we can follow up)';em.type='email';who.appendChild(nm);who.appendChild(em);
  var err=el('div','e'),form=el('form','f'),ta=el('textarea'),send=el('button',null,'Send');ta.placeholder='Type a message\\u2026';ta.setAttribute('aria-label','Message');send.type='submit';
  form.appendChild(ta);form.appendChild(send);
  [head,msgs,who,err,form].forEach(function(x){panel.appendChild(x);});
  var btn=el('button','b');btn.setAttribute('aria-label','Chat with us');
  btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var dot=el('span','dot');btn.appendChild(dot);
  root.appendChild(panel);root.appendChild(btn);
  function add(m){if(seen[m.id])return;seen[m.id]=1;var c=m.sender==='visitor'?'g v':m.sender==='agent'?'g a':'s';msgs.appendChild(el('div',c,m.body));msgs.scrollTop=msgs.scrollHeight;}
  function showWho(){who.style.display=!tok&&cfg.askEmail?'flex':'none';}
  function poll(){if(!tok)return Promise.resolve();return get('poll?token='+encodeURIComponent(tok)+'&after='+last).then(function(r){
    (r.messages||[]).forEach(function(m){last=Math.max(last,+m.id);if(!open&&m.sender==='agent')dot.style.display='block';add(m);});
  }).catch(function(e){if(e&&e.error&&/ended/.test(e.error)){tok=null;try{localStorage.removeItem(store);}catch(x){}showWho();}});}
  function schedule(){clearInterval(timer);if(tok)timer=setInterval(poll,open?3000:20000);}
  function begin(){if(tok)return Promise.resolve();return post('start',{k:key,name:nm.value,email:em.value,page:location.href}).then(function(r){tok=r.token;try{localStorage.setItem(store,tok);}catch(e){}showWho();schedule();msgs.textContent='';seen={};return poll();});}
  form.addEventListener('submit',function(e){e.preventDefault();var t=ta.value.trim();if(!t)return;err.textContent='';send.disabled=true;
    begin().then(function(){return post('message',{token:tok,body:t,email:em.value||undefined,name:nm.value||undefined});})
    .then(function(r){ta.value='';add({id:r.id,sender:'visitor',body:t});last=Math.max(last,+r.id);poll();})
    .catch(function(e){err.textContent=(e&&e.error)||'Could not send. Try again.';}).then(function(){send.disabled=false;});});
  ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit?form.requestSubmit():send.click();}});
  function toggle(v){open=v;panel.classList.toggle('o',open);if(open){dot.style.display='none';if(!tok&&cfg.greeting&&!msgs.childNodes.length)msgs.appendChild(el('div','s',cfg.greeting));poll();ta.focus();}schedule();}
  btn.addEventListener('click',function(){toggle(!open);});close.addEventListener('click',function(){toggle(false);});
  get('config?k='+encodeURIComponent(key)).then(function(c){cfg=c;title.textContent=c.name||'Chat';paint();showWho();document.body.appendChild(host);if(tok){poll();schedule();}}).catch(function(){});
})();`;

export function widgetResponse(): Response {
  return new Response(WIDGET, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
