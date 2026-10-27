(function () {
  "use strict";
  var H = "24h", data = null, map = null, layer = null, markers = {}, limit = 60;
  var $ = function (id) { return document.getElementById(id); };
  var BANDS = { unlikely: "Unlikely", possible: "Possible", likely: "Likely" };
  var css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };

  function fmtPct(p) {
    if (p === null || p === undefined) return "–";
    if (p < 0.01) return "<1%";
    return Math.round(p * 100) + "%";
  }
  function fmtTime(s) {
    if (!s) return "–";
    var d = new Date(String(s).replace(" ", "T"));
    if (isNaN(d)) return s;
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  }
  function hoursBetween(a, b) {
    var x = new Date(String(a).replace(" ", "T")), y = new Date(String(b).replace(" ", "T"));
    return (y - x) / 3.6e6;
  }
  function siteName(o) {
    var bad = !o.site || /^(permit applied for|yws unknown sites default)$/i.test(o.site);
    var s = bad ? o.outfall_id : o.site.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .replace(/\b(Cso|Stw|Wwtw|Sps|Wpc|Sso|Yws)\b/g, function (m) { return m.toUpperCase(); });
    return s;
  }
  function title(s) {
    if (!s || /^(permit applied for|yws unknown sites default)$/i.test(s)) return "–";
    return s.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function stateLabel(o) {
    return { discharging: "Discharging now", not_discharging: "Not discharging", monitor_offline: "Monitor offline" }[o.state] || "State unknown";
  }
  function noProbReason(o) {
    return { discharging: "Discharging now", recently_discharged: "Discharged in the last 12 hours", monitor_offline: "Monitor offline",
      no_rain_data: "Rainfall data unavailable" }[o.prediction_status] || "Not available";
  }
  function color(o) {
    if (o.state === "discharging") return css("--discharging");
    if (o.state === "monitor_offline") return css("--offline");
    var b = o.band && o.band[H];
    return b ? css("--" + b) : css("--offline");
  }

  function renderAsOf() {
    var a = data.data_as_of || {};
    var rows = [["Forecast for", fmtTime(data.issue_time)], ["Weather model run", fmtTime(a.ifs_run)],
      ["Spill feed checked", fmtTime(a.spill_poll)], ["Page data generated", fmtTime(data.generated_at)]];
    var dl = $("asof"); dl.textContent = "";
    rows.forEach(function (r) {
      var dt = document.createElement("dt"); dt.textContent = r[0];
      var dd = document.createElement("dd"); dd.textContent = r[1];
      dl.append(dt, dd);
    });
    var st = $("stale");
    var old = hoursBetween(data.generated_at, new Date().toISOString()) > 3;
    if (data.stale_reason || old) {
      st.hidden = false;
      st.textContent = data.stale_reason ? "These forecasts are out of date: the latest update could not be completed. "
        + "Showing the most recent forecasts that passed all checks." : "This page has not been updated for over three hours.";
    } else st.hidden = true;
  }

  function filtered() {
    var q = $("q").value.trim().toLowerCase(), t = $("type").value, only = $("onlyrisk").checked;
    return data.outfalls.filter(function (o) {
      if (t && o.asset_type !== t) return false;
      if (only && !(o.band && (o.band[H] === "possible" || o.band[H] === "likely"))) return false;
      if (q) {
        var hay = (o.outfall_id + " " + (o.site || "") + " " + (o.receiving_water || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      var pa = a.probability[H], pb = b.probability[H];
      var ka = a.state === "discharging" ? 2 : (pa === null ? -1 : pa), kb = b.state === "discharging" ? 2 : (pb === null ? -1 : pb);
      return kb - ka || a.outfall_id.localeCompare(b.outfall_id);
    });
  }

  function renderCounts(list) {
    var c = { likely: 0, possible: 0, unlikely: 0, discharging: 0, offline: 0 };
    data.outfalls.forEach(function (o) {
      if (o.state === "discharging") c.discharging++;
      else if (o.state === "monitor_offline") c.offline++;
      else if (o.band && o.band[H]) c[o.band[H]]++;
    });
    var items = [["likely", c.likely, "Likely to start discharging"], ["possible", c.possible, "Possible"],
      ["unlikely", c.unlikely, "Unlikely"], ["discharging", c.discharging, "Discharging now"], ["offline", c.offline, "Monitor offline"]];
    var box = $("counts"); box.textContent = "";
    items.forEach(function (it) {
      var d = document.createElement("div"); d.className = "count";
      var b = document.createElement("b"); b.textContent = it[1].toLocaleString("en-GB");
      var s = document.createElement("span"); var sw = document.createElement("i"); sw.className = "sw";
      sw.style.background = css("--" + it[0]); s.append(sw, document.createTextNode(it[2] + (it[0] === "discharging" || it[0] === "offline" ? "" : ", next " + H.replace("h", " hours"))));
      d.append(b, s); box.append(d);
    });
  }

  function bar(o, h) {
    var p = o.probability[h], d = document.createElement("span"); d.className = "bar";
    var i = document.createElement("i");
    i.style.setProperty("--w", p === null ? "0%" : Math.max(2, Math.min(100, p * 100)) + "%");
    i.style.setProperty("--c", o.band && o.band[h] ? css("--" + o.band[h]) : css("--offline"));
    d.append(document.createTextNode(h.replace("h", " h") + " " + fmtPct(p)), i);
    return d;
  }

  function renderList() {
    var list = filtered(), ol = $("list"); ol.textContent = "";
    list.slice(0, limit).forEach(function (o) {
      var li = document.createElement("li"); li.className = "row"; li.tabIndex = 0;
      var left = document.createElement("div");
      var n = document.createElement("div"); n.className = "name"; n.textContent = siteName(o);
      var s = document.createElement("div"); s.className = "sub";
      s.textContent = o.outfall_id + " · " + title(o.receiving_water) + " · " + o.asset_type;
      left.append(n, s);
      var right = document.createElement("div"); right.className = "p";
      var p = o.probability[H];
      if (o.state === "discharging") { var sp = document.createElement("span"); sp.className = "pill state discharging"; sp.textContent = "discharging"; right.append(sp); }
      else if (p === null) { var sx = document.createElement("span"); sx.className = "pill state"; sx.textContent = noProbReason(o).toLowerCase(); right.append(sx); }
      else right.textContent = fmtPct(p);
      var bars = document.createElement("div"); bars.className = "bars";
      ["6h", "12h", "24h"].forEach(function (h) { bars.append(bar(o, h)); });
      li.append(left, right, bars);
      li.addEventListener("click", function () { showDetail(o, true); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") showDetail(o, true); });
      ol.append(li);
    });
    $("shown").textContent = "Showing " + Math.min(limit, list.length).toLocaleString("en-GB") + " of " + list.length.toLocaleString("en-GB") + " overflows";
    $("more").hidden = list.length <= limit;
    renderCounts(list);
    renderMap(list);
  }

  function renderMap(list) {
    if (!window.L) return;
    if (!map) {
      map = L.map("map", { scrollWheelZoom: false, preferCanvas: true }).setView([53.85, -1.25], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 16,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers(); markers = {};
    var ids = {}; list.forEach(function (o) { ids[o.outfall_id] = true; });
    data.outfalls.slice().sort(function (a, b) { return (a.probability[H] || 0) - (b.probability[H] || 0); }).forEach(function (o) {
      if (!ids[o.outfall_id]) return;
      var p = o.probability[H] || 0;
      var m = L.circleMarker([o.lat, o.lon], { radius: 3 + Math.sqrt(p) * 12, weight: 1, color: color(o), fillColor: color(o), fillOpacity: .75 });
      m.bindTooltip(siteName(o) + " · " + (o.state === "discharging" ? "discharging now" : (o.probability[H] === null ? noProbReason(o) : fmtPct(o.probability[H]) + " in " + H)));
      m.on("click", function () { showDetail(o, false); });
      m.addTo(layer); markers[o.outfall_id] = m;
    });
  }

  function card(h, big, text) {
    var d = document.createElement("div"); d.className = "dcard";
    var t = document.createElement("h4"); t.textContent = h; d.append(t);
    if (big !== null) { var b = document.createElement("div"); b.className = "big"; b.textContent = big; d.append(b); }
    (Array.isArray(text) ? text : [text]).forEach(function (x) { if (x) { var p = document.createElement("p"); p.textContent = x; d.append(p); } });
    return d;
  }

  function showDetail(o, pan) {
    var box = $("detail"); box.textContent = ""; box.hidden = false;
    var hd = document.createElement("header");
    var tt = document.createElement("div");
    var h3 = document.createElement("h3"); h3.textContent = siteName(o);
    var sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = o.outfall_id + " · discharges to " + title(o.receiving_water) + " · " + o.asset_type;
    tt.append(h3, sub);
    var x = document.createElement("button"); x.className = "close"; x.type = "button"; x.textContent = "Close";
    x.addEventListener("click", function () { box.hidden = true; });
    hd.append(tt, x); box.append(hd);
    var g = document.createElement("div"); g.className = "dgrid";
    ["6h", "12h", "24h"].forEach(function (h) {
      var p = o.probability[h];
      g.append(card("Chance a discharge starts, next " + h.replace("h", " hours"), p === null ? "–" : fmtPct(p),
        p === null ? noProbReason(o) : (BANDS[o.band[h]] || "")));
    });
    var ld = o.last_discharge;
    g.append(card("Current state", stateLabel(o), o.state_since ? "Since " + fmtTime(o.state_since) : null));
    g.append(card("Last discharge", ld ? fmtTime(ld.start) : "None on record",
      ld ? (ld.ongoing ? "Still discharging" : "Ended " + fmtTime(ld.end) + " (" + Math.max(0, hoursBetween(ld.start, ld.end)).toFixed(1) + " h)") : null));
    var dw = o.dry_weather || {};
    var lc = dw.last_confirmed;
    g.append(card("Dry-weather check", lc ? fmtTime(lc.start) : "None confirmed",
      [lc ? "Most recent discharge that began with no rain in 48 h by model and gauges (" + lc.duration_h.toFixed(1) + " h" + (lc.isolated ? ", isolated" : "") + ")." : null,
        dw.confirmed_12m + " confirmed in the last 12 months (" + dw.confirmed_12m_isolated + " isolated). An anomaly worth investigating, not an accusation."]));
    var tr = o.track_record_24h;
    g.append(card("Track record, last 90 days (24 h)", tr ? tr.onsets_warned_90d + " of " + tr.onsets_90d : "Building",
      tr ? ["Discharges that started with a prior alert; " + tr.alerts_without_onset_90d + " alerts with no discharge. Labels: " + tr.labels + "."]
        : "Forecasts are checked against what happened once each window has closed."));
    box.append(g);
    var fl = document.createElement("div"); fl.className = "flags";
    var f = o.flags || {};
    if (f.monitoring_gaps) fl.append(flag("Monitoring gaps in the latest annual return: treat with caution"));
    if (f.limited_history) fl.append(flag("Limited discharge history"));
    if (f.history_incomplete) fl.append(flag("Discharge history incomplete for recent weeks"));
    if (f.stale) fl.append(flag("Forecast out of date"));
    if (fl.childElementCount) box.append(fl);
    if (pan && map && markers[o.outfall_id]) map.setView([o.lat, o.lon], Math.max(map.getZoom(), 11));
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function flag(t) { var s = document.createElement("span"); s.className = "flag"; s.textContent = t; return s; }

  // Caveats and attribution are static HTML (they render without latest.json); only the
  // live status lines come from the data: calibration status and model version.
  function renderFoot() {
    var s = $("foot-status"); s.textContent = "";
    if (data.calibration_status !== "verified") {
      var p = document.createElement("p"); p.className = "prov";
      p.textContent = "Calibration provisional until live verification.";
      s.append(p);
    }
    $("foot-model").textContent = data.model_version ? "Model " + data.model_version + "." : "";
  }

  function init(d) {
    // a readable file with no forecasts in it must say so, not render an empty list
    if (!d || !Array.isArray(d.outfalls) || !d.outfalls.length) {
      var st = $("stale"); st.hidden = false;
      st.textContent = "No forecasts are available at the moment: the latest data file contains no overflows. Please try again shortly.";
      return;
    }
    data = d;
    var types = {}; d.outfalls.forEach(function (o) { types[o.asset_type] = true; });
    var sel = $("type");
    Object.keys(types).sort().forEach(function (t) { var op = document.createElement("option"); op.value = t; op.textContent = t; sel.append(op); });
    renderAsOf(); renderFoot(); renderList();
  }

  document.querySelectorAll(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      H = b.dataset.h;
      document.querySelectorAll(".seg button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      limit = 60; renderList();
    });
  });
  ["q", "type", "onlyrisk"].forEach(function (id) { $(id).addEventListener("input", function () { limit = 60; renderList(); }); });
  $("more").addEventListener("click", function () { limit += 120; renderList(); });

  fetch("latest.json", { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(init).catch(function () {
    var st = $("stale"); st.hidden = false; st.textContent = "The forecast data could not be loaded. Please try again shortly.";
  });
})();
