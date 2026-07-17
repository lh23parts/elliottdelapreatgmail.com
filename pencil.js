(function () {
  var INK = '#2f2f2f';
  var TRAIL_MS = 2200;      // how long the leading mark lingers
  var PATH_MS = 3500;       // gesture memory for circle detection
  var CLOSE_DIST = 46;      // px gap that still counts as a closed loop
  var MIN_LOOP = 200;       // min drawn length before a loop can close
  var TIP = { x: 4, y: 87 };

  // ---- pencil cursor ----
  var pencil = document.createElement('img');
  pencil.src = 'pencil.png';
  pencil.alt = '';
  pencil.style.cssText =
    'position:fixed;width:84px;height:88px;pointer-events:none;z-index:10000;display:none;';

  // ---- drawing canvas ----
  var canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;';
  var ctx = canvas.getContext('2d');
  var dpr = 1;
  function fit() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  function mount() {
    document.body.appendChild(pencil);
    document.body.appendChild(canvas);
    // the page is a drawing surface: fingers draw, they don't pan or zoom
    document.documentElement.style.touchAction = 'none';
    document.body.style.touchAction = 'none';
  }
  if (document.body) { mount(); }
  else { document.addEventListener('DOMContentLoaded', mount); }

  var trail = [];   // {x,y,t,brk} in page coords; brk = start of a new stroke
  var marks = [];   // permanent polylines: arrays of {x,y}
  var path = [];    // recent gesture for loop detection
  var lastClient = null;
  var frozen = false;
  var pendingBreak = false;
  var lastTouchT = -1e9;

  function now() { return performance.now(); }

  function movePencil(clientX, clientY) {
    pencil.style.display = 'block';
    pencil.style.left = (clientX - TIP.x) + 'px';
    pencil.style.top = (clientY - TIP.y) + 'px';
  }

  function addPoint(px, py, brk) {
    var t = now();
    var last = trail[trail.length - 1];
    if (last && !brk && Math.abs(last.x - px) < 2 && Math.abs(last.y - py) < 2) return;
    trail.push({ x: px, y: py, t: t, brk: !!brk });
    path.push({ x: px, y: py, t: t });
    while (path.length && t - path[0].t > PATH_MS) path.shift();
    checkLoop();
  }

  // a click (or a quick tap) leaves a little scribbled knot
  function knotAt(px, py) {
    var pts = [];
    for (var i = 0; i < 16; i++) {
      var a = i * 2.1, r = 2.5 + i * 0.55;
      pts.push({ x: px + Math.cos(a) * r, y: py + Math.sin(a) * r * 0.8 });
    }
    marks.push(pts);
  }

  // ---- mouse ----
  document.addEventListener('mousemove', function (e) {
    if (now() - lastTouchT < 700) return;   // ignore touch-synthesized mouse events
    lastClient = { x: e.clientX, y: e.clientY };
    movePencil(e.clientX, e.clientY);
    if (!frozen) {
      addPoint(e.pageX, e.pageY, pendingBreak);
      pendingBreak = false;
    }
  });
  document.addEventListener('mouseleave', function () {
    pencil.style.display = 'none';
    pendingBreak = true;
  });
  document.addEventListener('mousedown', function (e) {
    if (frozen || now() - lastTouchT < 700) return;
    knotAt(e.pageX, e.pageY);
  });
  window.addEventListener('scroll', function () {
    if (lastClient && !frozen) {
      addPoint(lastClient.x + window.scrollX, lastClient.y + window.scrollY);
    }
  });

  // ---- touch: the finger is the pencil ----
  var touchStart = null;
  document.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    lastTouchT = now();
    touchStart = { x: t.clientX, y: t.clientY, t: now() };
    path = [];                               // each stroke is its own gesture
    movePencil(t.clientX, t.clientY);
    if (!frozen) addPoint(t.clientX + window.scrollX, t.clientY + window.scrollY, true);
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    lastTouchT = now();
    if (e.cancelable) e.preventDefault();    // draw instead of scroll
    movePencil(t.clientX, t.clientY);
    if (!frozen) addPoint(t.clientX + window.scrollX, t.clientY + window.scrollY);
  }, { passive: false });
  document.addEventListener('touchend', function (e) {
    var t = e.changedTouches[0];
    lastTouchT = now();
    if (touchStart && !frozen &&
        now() - touchStart.t < 300 &&
        Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y) < 10) {
      knotAt(t.clientX + window.scrollX, t.clientY + window.scrollY);
    }
    touchStart = null;
  });

  // ---- circle-the-answer detection ----
  function hotspots() {
    var img = document.getElementById('note');
    if (!img) return [];
    var r = img.getBoundingClientRect();
    var sx = window.scrollX, sy = window.scrollY;
    function spot(href, l, t, rr, b) {
      return {
        href: href,
        cx: sx + r.left + (l + rr) / 2 * r.width,
        cy: sy + r.top + (t + b) / 2 * r.height
      };
    }
    return [
      spot('yes.html', 0.140, 0.722, 0.367, 0.893),
      spot('no.html', 0.585, 0.757, 0.667, 0.864)
    ];
  }

  function inPolygon(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].y > y) !== (poly[j].y > y) &&
          x < (poly[j].x - poly[i].x) * (y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function checkLoop() {
    if (path.length < 8) return;
    var cur = path[path.length - 1];
    var len = 0;
    for (var i = path.length - 1; i > 0; i--) {
      len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (len < MIN_LOOP) continue;
      if (Math.hypot(path[i - 1].x - cur.x, path[i - 1].y - cur.y) < CLOSE_DIST) {
        var poly = path.slice(i - 1);
        var spots = hotspots();
        for (var s = 0; s < spots.length; s++) {
          if (inPolygon(spots[s].cx, spots[s].cy, poly)) {
            select(poly, spots[s].href);
            return;
          }
        }
      }
    }
  }

  function select(poly, href) {
    frozen = true;
    poly = poly.slice();
    poly.push(poly[0]);
    marks.push(poly);        // the circle stays on the page, bold
    path = [];
    setTimeout(function () { window.location.href = href; }, 420);
  }

  // ---- render loop (interval, not rAF: keeps ticking in embedded panes) ----
  function stroke(pts, alpha, width) {
    if (pts.length < 2) return;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function draw() {
    var t = now();
    while (trail.length && t - trail[0].t > TRAIL_MS) trail.shift();
    ctx.setTransform(dpr, 0, 0, dpr, -window.scrollX * dpr, -window.scrollY * dpr);
    ctx.clearRect(window.scrollX, window.scrollY, canvas.width, canvas.height);
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var m = 0; m < marks.length; m++) stroke(marks[m], 0.9, 3);
    for (var i = 1; i < trail.length; i++) {
      var a = trail[i];
      if (a.brk || t - a.t > TRAIL_MS) continue;
      stroke([trail[i - 1], a], 0.75 * (1 - (t - a.t) / TRAIL_MS), 2.5);
    }
    ctx.globalAlpha = 1;
  }
  setInterval(draw, 33);
})();
