/* ViriatoTempo — widget de resultados para pegar en cualquier web (WordPress: bloque "HTML personalizado").
 *
 *   <div class="viriatotempo-widget" data-event="42"></div>
 *   <script src="https://viriatotempo.onrender.com/widget.js" async></script>
 *
 * Opcionales en el <div>: data-color="e8590c" (color principal), data-race="<id recorrido>",
 * data-tab="participantes", data-live="0" (sin refresco automático).
 * Crea un iframe que se ajusta solo a la altura del contenido.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var ORIGIN = script ? new URL(script.src).origin : 'https://viriatotempo.onrender.com';

  function mount(el) {
    if (el.getAttribute('data-vt-mounted')) return;
    var ev = (el.getAttribute('data-event') || '').replace(/\D/g, '');
    if (!ev) { el.textContent = 'ViriatoTempo: falta data-event'; return; }
    el.setAttribute('data-vt-mounted', '1');
    var qs = [];
    ['color', 'race', 'tab', 'live'].forEach(function (k) {
      var v = el.getAttribute('data-' + k);
      if (v) qs.push(k + '=' + encodeURIComponent(v));
    });
    var f = document.createElement('iframe');
    f.src = ORIGIN + '/widget/' + ev + (qs.length ? '?' + qs.join('&') : '');
    f.title = 'Resultados ViriatoTempo';
    f.loading = 'lazy';
    f.setAttribute('scrolling', 'no');
    f.style.cssText = 'width:100%;border:0;display:block;min-height:420px;height:600px;overflow:hidden';
    el.appendChild(f);

    window.addEventListener('message', function (e) {
      if (e.origin !== ORIGIN || e.source !== f.contentWindow) return;
      var d = e.data || {};
      if (d.type === 'vt-widget-height' && d.height > 0) f.style.height = Math.ceil(d.height) + 'px';
    });
  }

  function init() {
    var els = document.querySelectorAll('.viriatotempo-widget, #viriatotempo-widget');
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
