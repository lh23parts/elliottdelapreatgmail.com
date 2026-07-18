(function () {
  var INK = '#2f2f2f';
  var TRAIL_MS = 2200;      // how long the leading mark lingers
  var PATH_MS = 3500;       // gesture memory for circle detection
  var CLOSE_DIST = 46;      // px gap that still counts as a closed loop
  var MIN_LOOP = 200;       // min drawn length before a loop can close
  var TIP = { x: 4, y: 87 };
  var BOAT_KEY = 'elliott-boat';

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
    if (!window.innerWidth || !window.innerHeight) { setTimeout(fit, 50); return; }
    dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  var trail = [];        // {x,y,t,brk} fading lead mark; brk = new stroke
  var marks = [];        // permanent polylines: arrays of {x,y}
  var path = [];         // recent gesture for loop detection
  var lastClient = null;
  var frozen = false;
  var pendingBreak = false;
  var lastTouchT = -1e9;

  // boat drawing mode (pages with <body data-draw="boat">)
  var drawMode = false;
  var drawing = null;    // stroke in progress: array of {x,y}
  var boatStrokes = [];  // everything inked in draw mode
  var doneLink = null;

  function now() { return performance.now(); }

  function mount() {
    document.body.appendChild(pencil);
    document.body.appendChild(canvas);
    // the page is a drawing surface: fingers draw, they don't pan or zoom
    document.documentElement.style.touchAction = 'none';
    document.body.style.touchAction = 'none';
    drawMode = document.body.getAttribute('data-draw') === 'boat';
    if (drawMode) {
      makeDoneLink();
      loadBoat();
    }
  }
  if (document.body) { mount(); }
  else { document.addEventListener('DOMContentLoaded', mount); }

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
    pathPush(px, py, t);
  }

  function pathPush(px, py, t) {
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
    if (drawMode) {
      boatStrokes.push(pts);
      boatChanged();
    }
  }

  // ---- boat inking ----
  function onDoneLink(target) {
    return doneLink && (target === doneLink || doneLink.contains(target));
  }

  function startStroke(px, py) {
    drawing = [{ x: px, y: py }];
    marks.push(drawing);           // renders live as it grows
  }

  function extendStroke(px, py) {
    var last = drawing[drawing.length - 1];
    if (Math.abs(last.x - px) < 2 && Math.abs(last.y - py) < 2) return;
    drawing.push({ x: px, y: py });
    pathPush(px, py, now());   // a drawn circle can lasso the button too
  }

  function endStroke() {
    if (!drawing) return;
    if (frozen) {              // the lasso fired mid-stroke; select() keeps its own copy
      marks.splice(marks.indexOf(drawing), 1);
      drawing = null;
      return;
    }
    var len = 0;
    for (var i = 1; i < drawing.length; i++) {
      len += Math.hypot(drawing[i].x - drawing[i - 1].x, drawing[i].y - drawing[i - 1].y);
    }
    if (len < 5) {                 // a press without a drag is just a pencil dot
      var p = drawing[0];
      marks.splice(marks.indexOf(drawing), 1);
      knotAt(p.x, p.y);
    } else {
      boatStrokes.push(drawing);
      boatChanged();
    }
    drawing = null;
    pendingBreak = true;
  }

  var doneImg;   // created in makeDoneLink (which runs before this line executes)

  function boatChanged() {
    if (!doneLink) return;
    showReady();
  }

  function showReady() {          // the hand-drawn "ok my boat is done" — circle it to launch
    doneLink.textContent = '';
    doneLink.appendChild(doneImg);
    doneLink.style.display = 'block';
  }

  function makeDoneLink() {
    doneLink = document.createElement('button');
    doneLink.type = 'button';
    doneLink.setAttribute('aria-label', 'ok my boat is done — circle it to launch the boat');
    doneLink.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:10001;' +
      'background:none;border:none;padding:8px 14px;cursor:none;display:none;';
    doneImg = document.createElement('img');
    doneImg.src = 'done-btn.png';
    doneImg.alt = 'ok my boat is done';
    doneImg.draggable = false;
    doneImg.style.cssText =
      'width:210px;max-width:none;height:auto;display:block;pointer-events:none;';
    document.body.appendChild(doneLink);
  }

  function saveBoat() {
    try {
      localStorage.setItem(BOAT_KEY, JSON.stringify({
        w: window.innerWidth, h: window.innerHeight, strokes: boatStrokes
      }));
    } catch (e) { /* private mode etc. — the boat sails this session only */ }
  }

  function loadBoat() {
    // viewport can be 0 for a beat in embedded panes — wait for real dimensions
    if (!window.innerWidth || !window.innerHeight) { setTimeout(loadBoat, 50); return; }
    var d;
    try { d = JSON.parse(localStorage.getItem(BOAT_KEY)); } catch (e) { return; }
    if (!d || !d.strokes || !d.strokes.length) return;
    var s = Math.min(window.innerWidth / d.w, window.innerHeight / d.h);
    var ox = (window.innerWidth - d.w * s) / 2;
    var oy = (window.innerHeight - d.h * s) / 2;
    for (var i = 0; i < d.strokes.length; i++) {
      var pts = d.strokes[i].map(function (p) {
        return { x: p.x * s + ox, y: p.y * s + oy };
      });
      marks.push(pts);
      boatStrokes.push(pts);
    }
    showReady();
  }

  // ---- mouse ----
  document.addEventListener('mousemove', function (e) {
    if (now() - lastTouchT < 700) return;   // ignore touch-synthesized mouse events
    lastClient = { x: e.clientX, y: e.clientY };
    movePencil(e.clientX, e.clientY);
    if (frozen) return;
    if (drawing) { extendStroke(e.pageX, e.pageY); return; }
    addPoint(e.pageX, e.pageY, pendingBreak);
    pendingBreak = false;
  });
  document.addEventListener('mousedown', function (e) {
    if (frozen || now() - lastTouchT < 700 || onDoneLink(e.target)) return;
    if (drawMode) { startStroke(e.pageX, e.pageY); }
    else { knotAt(e.pageX, e.pageY); }
  });
  document.addEventListener('mouseup', function () {
    if (drawMode) endStroke();
  });
  document.addEventListener('mouseleave', function () {
    pencil.style.display = 'none';
    pendingBreak = true;
    if (drawMode) endStroke();
  });
  window.addEventListener('scroll', function () {
    if (lastClient && !frozen && !drawing) {
      addPoint(lastClient.x + window.scrollX, lastClient.y + window.scrollY);
    }
  });

  // ---- touch: the finger is the pencil ----
  var touchStart = null;
  document.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    lastTouchT = now();
    if (onDoneLink(e.target)) return;
    touchStart = { x: t.clientX, y: t.clientY, t: now() };
    path = [];                               // each stroke is its own gesture
    movePencil(t.clientX, t.clientY);
    if (frozen) return;
    if (drawMode) { startStroke(t.clientX + window.scrollX, t.clientY + window.scrollY); }
    else { addPoint(t.clientX + window.scrollX, t.clientY + window.scrollY, true); }
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    lastTouchT = now();
    if (onDoneLink(e.target)) return;
    if (e.cancelable) e.preventDefault();    // draw instead of scroll
    movePencil(t.clientX, t.clientY);
    if (frozen) return;
    if (drawing) { extendStroke(t.clientX + window.scrollX, t.clientY + window.scrollY); }
    else { addPoint(t.clientX + window.scrollX, t.clientY + window.scrollY); }
  }, { passive: false });
  document.addEventListener('touchend', function (e) {
    var t = e.changedTouches[0];
    lastTouchT = now();
    if (onDoneLink(e.target)) { touchStart = null; return; }
    if (drawMode) {
      endStroke();                           // a tap becomes a dot via endStroke
    } else if (touchStart && !frozen &&
        now() - touchStart.t < 300 &&
        Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y) < 10) {
      knotAt(t.clientX + window.scrollX, t.clientY + window.scrollY);
    }
    touchStart = null;
  });

  // ---- circle-to-select detection ----
  function hotspots() {
    var sx = window.scrollX, sy = window.scrollY;
    if (drawMode) {              // circling the done button launches the boat
      if (!doneLink || doneLink.style.display === 'none') return [];
      var b = doneLink.getBoundingClientRect();
      if (!b.width) return [];
      return [{ sail: true, cx: sx + b.left + b.width / 2, cy: sy + b.top + b.height / 2 }];
    }
    var img = document.getElementById('note');
    if (!img) return [];
    var r = img.getBoundingClientRect();
    if (!r.width || !r.height) return [];   // not laid out yet — targets would collapse
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
            select(poly, spots[s]);
            return;
          }
        }
      }
    }
  }

  function select(poly, spot) {
    frozen = true;
    poly = poly.slice();
    poly.push(poly[0]);
    marks.push(poly);        // the circle stays on the page, bold
    path = [];
    if (spot.sail) { sailAway(poly); return; }
    setTimeout(function () { window.location.href = spot.href; }, 420);
  }

  // ---- the boat floats away on a wave ----
  function sailAway(circlePoly) {
    saveBoat();              // the boat is kept before it sails

    // lift the drawn boat off the page canvas onto its own sprite
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    boatStrokes.forEach(function (s) { s.forEach(function (p) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }); });
    var pad = 8, bx = minX - pad, by = minY - pad;
    var bw = (maxX - minX) + pad * 2, bh = (maxY - minY) + pad * 2;
    var sc = document.createElement('canvas');
    sc.width = Math.max(bw * dpr, 1);
    sc.height = Math.max(bh * dpr, 1);
    sc.style.cssText = 'position:fixed;left:' + bx + 'px;top:' + by + 'px;' +
      'width:' + bw + 'px;height:' + bh + 'px;z-index:9998;pointer-events:none;';
    var sg = sc.getContext('2d');
    sg.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
    sg.strokeStyle = INK;
    sg.lineCap = 'round';
    sg.lineJoin = 'round';
    sg.globalAlpha = 0.9;
    sg.lineWidth = 3;
    boatStrokes.forEach(function (pts) {
      if (pts.length < 2) return;
      sg.beginPath();
      sg.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) sg.lineTo(pts[i].x, pts[i].y);
      sg.stroke();
    });
    document.body.appendChild(sc);
    marks = marks.filter(function (m) { return boatStrokes.indexOf(m) === -1; });

    // the wave — an actual ocean, rising from the bottom of the page
    var waveH = Math.round(window.innerHeight * 0.34);
    var wave = document.createElement('div');
    wave.setAttribute('aria-hidden', 'true');
    wave.style.cssText = 'position:fixed;left:-2%;width:104%;bottom:0;height:' + waveH + 'px;' +
      'background:url(wave.jpg) center 32%/cover no-repeat;z-index:9997;pointer-events:none;' +
      '-webkit-mask-image:linear-gradient(to bottom,transparent,#000 30%);' +
      'mask-image:linear-gradient(to bottom,transparent,#000 30%);' +
      'transform:translateY(108%);';
    document.body.appendChild(wave);

    var crestX = window.innerWidth * 0.16;
    var crestY = window.innerHeight - waveH * 0.85 - bh;
    var sailDist = window.innerWidth - crestX + bw * 1.6;
    var t0 = now();
    function ease(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }
    setInterval(function () {
      var t = now() - t0;
      if (doneLink) doneLink.style.opacity = String(Math.max(1 - t / 600, 0));
      if (t > 600 && circlePoly) {           // circle and button bow out
        marks.splice(marks.indexOf(circlePoly), 1);
        circlePoly = null;
        doneLink.style.display = 'none';
      }
      var rise = ease((t - 300) / 1200);
      var bob = Math.sin(t / 480) * 4 * rise;
      wave.style.transform =
        'translateY(' + ((1 - rise) * 108) + '%) translateY(' + bob + 'px)';
      if (!sc.isConnected) return;
      var u = ease((t - 900) / 1400);        // drift over to the crest
      var x = bx + (crestX - bx) * u;
      var y = by + (crestY - by) * u;
      var rock = 0, scale = 1;
      if (t > 2300) {                        // and away
        var v = Math.min((t - 2300) / 7200, 1);
        x = crestX + sailDist * (0.3 * v * v + 0.7 * v);
        y = crestY + Math.sin(t / 480) * 5;
        rock = Math.sin(t / 420) * 3.5;
        scale = 1 - v * 0.25;
        if (v >= 1) { sc.remove(); return; } // gone; the ocean stays
      }
      sc.style.transform = 'translate(' + (x - bx) + 'px,' + (y - by) + 'px) ' +
        'rotate(' + rock + 'deg) scale(' + scale + ')';
    }, 33);
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
