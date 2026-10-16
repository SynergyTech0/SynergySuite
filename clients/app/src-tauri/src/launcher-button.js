// Injected into suite pages on phones and tablets: a button back to the Synergy launcher.
(() => {
  const LAUNCHER = "__LAUNCHER__";
  if (window.top !== window || location.href.startsWith(LAUNCHER)) return;
  const add = () => {
    if (!document.body || document.getElementById("synergy-all-apps")) return;
    const button = document.createElement("button");
    button.id = "synergy-all-apps";
    button.type = "button";
    button.title = "All apps";
    button.setAttribute("aria-label", "All apps");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
      '<path d="M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z"/></svg>';
    button.style.cssText =
      "position:fixed;z-index:2147483647;left:calc(12px + env(safe-area-inset-left));" +
      "bottom:calc(12px + env(safe-area-inset-bottom));width:40px;height:40px;padding:0;" +
      "border:0;border-radius:50%;display:grid;place-items:center;color:#fff;" +
      "background:rgba(1,27,62,.78);box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer";
    button.addEventListener("click", () => location.assign(LAUNCHER));
    document.body.appendChild(button);
  };
  // Apps that re-render the whole body during hydration can drop the button; put it back.
  document.addEventListener("DOMContentLoaded", add);
  window.addEventListener("load", add);
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: false });
  add();
})();
