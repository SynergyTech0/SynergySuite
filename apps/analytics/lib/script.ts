/**
 * The tracking script sites load with
 *   <script defer src="https://analytics.<domain>/script.js" data-site="sy_..."></script>
 * It sets no cookies and stores nothing in the browser. It sends a page view on load and on
 * single-page navigation, and `window.synergy("signup")` sends a custom event. Nothing is sent
 * from localhost or when the browser asks not to be tracked.
 */
export const SCRIPT = `(function(){
  var s=document.currentScript,key=s&&s.getAttribute('data-site');if(!key)return;
  var ep=new URL(s.src,location.href).origin+'/api/collect';
  var off=/^(localhost|127\\.|\\[::1\\])/.test(location.hostname)||navigator.doNotTrack==='1'||window.doNotTrack==='1';
  function send(kind,name){if(off)return;try{
    var b=JSON.stringify({k:key,kind:kind,name:name||'pageview',u:location.href,r:document.referrer,w:screen.width});
    if(navigator.sendBeacon&&navigator.sendBeacon(ep,b))return;
    fetch(ep,{method:'POST',body:b,keepalive:true,mode:'no-cors',credentials:'omit'});
  }catch(e){}}
  var last=location.pathname;
  function nav(){if(location.pathname!==last){last=location.pathname;send('pageview');}}
  var push=history.pushState;history.pushState=function(){var r=push.apply(this,arguments);nav();return r;};
  window.addEventListener('popstate',nav);
  window.synergy=function(name){send('event',String(name||'event'));};
  send('pageview');
})();`;

export function scriptResponse(): Response {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}

/** The snippet to paste into a site's pages. */
export function snippet(siteKey: string, domain = process.env.SUITE_DOMAIN): string {
  const base = domain ? `https://analytics.${domain}` : "http://localhost:3890";
  return `<script defer src="${base}/script.js" data-site="${siteKey}"></script>`;
}
