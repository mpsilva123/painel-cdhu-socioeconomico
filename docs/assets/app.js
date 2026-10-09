/* =====================================================================
   CDHU · Painel da Pesquisa Socioeconômica — lógica do painel
   - Lê data/data.json (gerado a cada hora pelo GitHub Actions a partir do Kobo)
   - Agrega no navegador, para que os filtros funcionem sem servidor
   - Gráficos: Chart.js 4 · Mapa: SVG próprio a partir da malha do IBGE
   ===================================================================== */
(() => {
  "use strict";

  const CFG = window.PAINEL_CONFIG || {};
  const MIN_N = Math.max(1, CFG.minFamiliasDetalhe || 1);

  // ---------- Paleta (validada para daltonismo e contraste; ver README) ----------
  const C = {
    red: "#E0220F", blue: "#2B63A0", ochre: "#B87A0A", green: "#14866F",
    ink: "#161616", ink2: "#4a4a4a", ink3: "#7a7a7a", grid: "#efefef", neutral: "#cfcfcf",
  };
  const RAMP = ["#ffe0dc", "#ffb3a8", "#ff7a66", "#f2402a", "#c41a08", "#850f03"]; // sequencial (1 matiz)

  // ---------- Formatação pt-BR ----------
  const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fmtN = (v) => nf0.format(v);
  const fmtPct = (v) => (isFinite(v) ? nf1.format(v) + "%" : "—");
  const fmtBRL = (v) => (v == null || !isFinite(v) ? "—" : brl.format(v));
  const plural = (n, s = "família", p = "famílias") => `${fmtN(n)} ${n === 1 ? s : p}`;
  const pct = (a, b) => (b ? (100 * a) / b : NaN);
  const fmtDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  };
  const normKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);

  // ---------- Estado ----------
  const S = {
    data: null, all: [], geo: null, geoIndex: new Map(),
    f: { mun: "", org: "", posse: "", tipo: "", ini: "", fim: "" },
    charts: {}, vfmt: {}, mapMetric: "fam", sort: { key: "n", dir: -1 },
  };

  // =====================================================================
  // Ícones (traço, estilo dos ícones do manual)
  // =====================================================================
  const IC = {
    form: '<path d="M7 3h10v18H7z"/><path d="M10 8h4M10 12h4M10 16h2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.9.3 5 2.7 5 5.8"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M7 9.5v5M17 9.5v5"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.4-2.5-1.2M12 6.5v1.5M12 16v1.5"/>',
    house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M12 11v4M12 17.5v.01"/>',
    people: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><path d="M3 19c0-2.8 2.2-5 5-5 1.5 0 2.9.7 3.8 1.7M21 19c0-2.8-2.2-5-5-5-1.5 0-2.9.7-3.8 1.7"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M12 8v5M12 16v.01"/>',
  };
  const svgIcon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;

  // =====================================================================
  // Carga de dados
  // =====================================================================
  async function loadData() {
    const btn = $("btn-refresh");
    btn.classList.add("spin");
    try {
      const r = await fetch(`${CFG.dataUrl}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      S.data = await r.json();
      S.all = S.data.registros || [];
      fillFilters();
      render();
    } catch (e) {
      console.error(e);
      $("active-filters").textContent = "Não foi possível carregar os dados agora. Tente atualizar em instantes.";
    } finally {
      btn.classList.remove("spin");
    }
  }

  async function loadGeo() {
    const fixNames = (gj, names) => {
      gj.features.forEach((f) => {
        const p = f.properties || {};
        const cod = String(p.cod || p.codarea || p.id || "");
        f.properties = { cod, nome: p.nome || p.name || names?.get(cod) || cod };
      });
      return gj;
    };
    let gj = null;
    try {
      const r = await fetch(CFG.geoUrl, { cache: "force-cache" });
      if (r.ok) gj = fixNames(await r.json());
    } catch (_) { /* tenta a reserva */ }
    if (!gj) {
      try {
        const [g, n] = await Promise.all([fetch(CFG.geoFallbackUrl).then((r) => r.json()), fetch(CFG.geoNamesUrl).then((r) => r.json())]);
        gj = fixNames(g, new Map(n.map((m) => [String(m.id), m.nome])));
      } catch (e) {
        console.error("Malha municipal indisponível", e);
        $("map-loading").textContent = "Mapa indisponível no momento.";
        return;
      }
    }
    S.geo = gj;
    buildMap();
    if (S.data) { renderTerritory(); if (S.f.mun) mapZoomTo(S.f.mun); }
  }

  // =====================================================================
  // Filtros
  // =====================================================================
  const FILTERS = [
    ["mun", "f-mun", (r) => r.mun, "Todos os municípios"],
    ["org", "f-org", (r) => r.org, "Todos os órgãos"],
    ["posse", "f-posse", (r) => r.posse, "Todas"],
    ["tipo", "f-tipo", (r) => r.tipo, "Todos"],
  ];

  function fillFilters() {
    FILTERS.forEach(([k, id, get, all]) => {
      const sel = $(id);
      const vals = [...new Set(S.all.map(get).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      if (S.f[k] && !vals.includes(S.f[k])) S.f[k] = "";
      sel.innerHTML = `<option value="">${all}</option>` + vals.map((v) => `<option${v === S.f[k] ? " selected" : ""}>${esc(v)}</option>`).join("");
    });
    const dts = S.all.map((r) => r.dt).filter(Boolean).sort();
    if (dts.length) {
      $("f-ini").min = $("f-fim").min = dts[0];
      $("f-ini").max = $("f-fim").max = dts[dts.length - 1];
    }
  }

  function bindFilters() {
    FILTERS.forEach(([k, id]) => $(id).addEventListener("change", (e) => {
      S.f[k] = e.target.value; render();
      if (k === "mun") (S.f.mun ? mapZoomTo(S.f.mun) : mapReset());
    }));
    $("f-ini").addEventListener("change", (e) => { S.f.ini = e.target.value; render(); });
    $("f-fim").addEventListener("change", (e) => { S.f.fim = e.target.value; render(); });
    $("f-limpar").addEventListener("click", () => {
      S.f = { mun: "", org: "", posse: "", tipo: "", ini: "", fim: "" };
      FILTERS.forEach(([, id]) => ($(id).value = ""));
      $("f-ini").value = $("f-fim").value = "";
      render();
      mapReset();
    });
  }

  function setMun(m) {
    S.f.mun = S.f.mun === m ? "" : m;
    $("f-mun").value = S.f.mun;
    render();
    if (S.f.mun) mapZoomTo(S.f.mun); else mapReset();
  }

  /** Aplica os filtros; `except` ignora um filtro (o mapa ignora o de município). */
  function filtered(except) {
    const f = S.f;
    return S.all.filter((r) =>
      (except === "mun" || !f.mun || r.mun === f.mun) &&
      (!f.org || r.org === f.org) && (!f.posse || r.posse === f.posse) && (!f.tipo || r.tipo === f.tipo) &&
      (!f.ini || r.dt >= f.ini) && (!f.fim || r.dt <= f.fim));
  }
  const anyFilter = () => Object.values(S.f).some(Boolean);

  // =====================================================================
  // Agregações
  // =====================================================================
  function countBy(rows, get) {
    const m = new Map();
    rows.forEach((r) => {
      const v = get(r);
      (Array.isArray(v) ? v : [v]).forEach((x) => { if (x != null && x !== "") m.set(x, (m.get(x) || 0) + 1); });
    });
    return m;
  }
  const sortedEntries = (m, order) =>
    order ? order.filter((k) => m.has(k)).map((k) => [k, m.get(k)]) : [...m.entries()].sort((a, b) => b[1] - a[1]);
  const mean = (arr) => { const v = arr.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  const members = (rows) => rows.flatMap((r) => r.m || []);

  function munStats(rows) {
    const m = new Map();
    rows.forEach((r) => {
      const s = m.get(r.mun) || { mun: r.mun, n: 0, p: 0, renda: [], vuln: 0, prec: 0, risco: 0 };
      s.n++; s.p += r.mor || 0; s.renda.push(r.renda);
      if (r.vuln.length) s.vuln++; if (r.prec.length) s.prec++; if (r.risco.length) s.risco++;
      m.set(r.mun, s);
    });
    m.forEach((s) => { s.rendaMed = mean(s.renda); s.pv = pct(s.vuln, s.n); s.pp = pct(s.prec, s.n); s.pr = pct(s.risco, s.n); });
    return m;
  }

  // =====================================================================
  // Render geral
  // =====================================================================
  function render() {
    if (!S.data) return;
    const rows = filtered();
    const locked = anyFilter() && rows.length > 0 && rows.length < MIN_N;

    // cabeçalho
    const parts = [];
    if (S.f.mun) parts.push(S.f.mun);
    if (S.f.org) parts.push(`Órgão: ${S.f.org}`);
    if (S.f.posse) parts.push(`Posse: ${S.f.posse}`);
    if (S.f.tipo) parts.push(`Moradia: ${S.f.tipo}`);
    if (S.f.ini || S.f.fim) parts.push(`Período: ${S.f.ini ? S.f.ini.split("-").reverse().join("/") : "início"} a ${S.f.fim ? S.f.fim.split("-").reverse().join("/") : "hoje"}`);
    $("active-filters").textContent = (parts.length ? parts.join(" · ") : "Todas as famílias pesquisadas") + ` — ${fmtN(rows.length)} ${rows.length === 1 ? "família" : "famílias"}`;
    $("upd-time").textContent = fmtDate(S.data.gerado_em);
    $("footer-text").textContent = `${CFG.rodape || "Gerado em"} ${fmtDate(S.data.gerado_em)} · ${S.data.fonte || "KoboToolbox"}`;

    // aviso de privacidade / vazio
    const note = $("privacy-note");
    if (!rows.length) { note.hidden = false; note.textContent = "Nenhuma família encontrada com esses filtros."; }
    else if (locked) { note.hidden = false; note.textContent = `Esta seleção tem menos de ${MIN_N} famílias. Para proteger a privacidade, os detalhes ficam ocultos; amplie os filtros para vê-los.`; }
    else note.hidden = true;
    document.querySelectorAll(".section.detail").forEach((s) => s.classList.toggle("locked", locked || !rows.length));

    renderKPIs(rows, locked);
    renderTerritory();
    if (!locked && rows.length) {
      renderProfile(rows);
      renderHousing(rows);
      renderIndicators(rows);
    }
  }

  // ---------- KPIs ----------
  function renderKPIs(rows, locked) {
    const n = rows.length;
    const pessoas = rows.reduce((a, r) => a + (r.mor || 0), 0);
    const muns = new Set(rows.map((r) => r.mun)).size;
    const renda = mean(rows.map((r) => r.renda));
    const rpc = mean(rows.map((r) => r.rpc));
    const sm = S.data.salario_minimo || 1621;
    const nv = rows.filter((r) => r.vuln.length).length, np = rows.filter((r) => r.prec.length).length, nr = rows.filter((r) => r.risco.length).length;
    const hide = (v) => (locked || !n ? "—" : v);
    const K = [
      ["form", "Famílias pesquisadas", fmtN(n), `${fmtN(S.all.length)} no total`],
      ["users", "Pessoas cadastradas", fmtN(pessoas), "moradores nas famílias"],
      ["pin", "Municípios atendidos", fmtN(muns), "com ao menos uma pesquisa"],
      ["home", "Moradores por família", hide(nf1.format(pessoas / n || 0)), "média"],
      ["money", "Renda familiar média", hide(fmtBRL(renda)), hide(`${nf2.format(renda / sm)} salários mínimos`)],
      ["coin", "Renda per capita média", hide(fmtBRL(rpc)), hide(`${nf2.format(rpc / sm)} SM por pessoa`)],
      ["house", "Famílias em precariedade", hide(fmtPct(pct(np, n))), hide(plural(np)), true],
      ["people", "Famílias em vulnerabilidade", hide(fmtPct(pct(nv, n))), hide(plural(nv)), true],
      ["shield", "Famílias em risco social", hide(fmtPct(pct(nr, n))), hide(plural(nr)), true],
    ];
    $("kpis").innerHTML = K.map(([ic, l, v, s, acc]) => `
      <div class="kpi reveal${acc ? " accent" : ""}">
        <div class="kpi-top"><div class="kpi-ic">${svgIcon(ic)}</div><div class="kpi-label">${l}</div></div>
        <div class="kpi-value">${v}</div><div class="kpi-sub">${s}</div>
      </div>`).join("");
    observeReveal($("kpis"));
  }

  // ---------- Território ----------
  function renderTerritory() {
    const rows = filtered("mun");
    const stats = [...munStats(rows).values()];
    const priv = (s, v) => (s.n >= MIN_N ? v : "—");

    // ranking
    const top = stats.slice().sort((a, b) => b.n - a.n || a.mun.localeCompare(b.mun)).slice(0, 15);
    barChart("c-mun", top.map((s) => s.mun), top.map((s) => s.n), {
      horizontal: true, total: rows.length, highlight: S.f.mun,
      onClick: (label) => setMun(label),
    });
    const t = top[0];
    $("ins-mun").innerHTML = t
      ? `<b>${esc(t.mun)}</b> concentra ${fmtPct(pct(t.n, rows.length))} das pesquisas (${fmtN(t.n)} de ${fmtN(rows.length)}).${stats.length > 15 ? ` Exibindo os 15 maiores de ${stats.length}.` : ""}`
      : "";

    // linha do tempo (mensal)
    const byMonth = countBy(filtered(), (r) => (r.dt || "").slice(0, 7));
    const months = monthRange([...byMonth.keys()].sort());
    const labels = months.map((m) => { const [y, mo] = m.split("-"); return new Date(+y, +mo - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", ""); });
    barChart("c-tempo", labels, months.map((m) => byMonth.get(m) || 0), { horizontal: false, noPct: true, unit: "pesquisas" });
    const best = months.reduce((a, m) => ((byMonth.get(m) || 0) > (byMonth.get(a) || 0) ? m : a), months[0]);
    $("ins-tempo").innerHTML = months.length
      ? `Mês com mais pesquisas: <b>${labels[months.indexOf(best)]}</b> (${fmtN(byMonth.get(best) || 0)}). Total acumulado no período: <b>${fmtN(filtered().length)}</b>.`
      : "";

    // tabela
    const k = S.sort.key, d = S.sort.dir;
    const val = (s) => ({ mun: s.mun, n: s.n, p: s.p, renda: s.n >= MIN_N ? s.rendaMed : -1, pv: s.n >= MIN_N ? s.pv : -1, pp: s.n >= MIN_N ? s.pp : -1, pr: s.n >= MIN_N ? s.pr : -1 }[k]);
    stats.sort((a, b) => (typeof val(a) === "string" ? val(a).localeCompare(val(b), "pt-BR") : val(a) - val(b)) * d);
    const maxN = Math.max(1, ...stats.map((s) => s.n));
    const cols = [["mun", "Município"], ["n", "Famílias", 1], ["p", "Pessoas", 1], ["renda", "Renda familiar média", 1], ["pv", "% Vulnerabilidade", 1], ["pp", "% Precariedade", 1], ["pr", "% Risco social", 1]];
    $("tbl-mun").innerHTML =
      `<thead><tr>${cols.map(([key, l, num]) => `<th data-k="${key}" class="${num ? "num" : ""}">${l}${S.sort.key === key ? (d < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr></thead><tbody>` +
      stats.map((s) => `<tr data-mun="${esc(s.mun)}" class="${s.mun === S.f.mun ? "sel" : ""}">
        <td>${esc(s.mun)}${S.geo && !S.geoIndex.has(normKey(s.mun)) ? ' <span class="muted" title="Nome não localizado na malha do IBGE">*</span>' : ""}</td>
        <td class="num"><span class="bar" style="width:${(60 * s.n) / maxN}px"></span>${fmtN(s.n)}</td>
        <td class="num">${fmtN(s.p)}</td>
        <td class="num">${priv(s, fmtBRL(s.rendaMed))}</td>
        <td class="num">${priv(s, fmtPct(s.pv))}</td>
        <td class="num">${priv(s, fmtPct(s.pp))}</td>
        <td class="num">${priv(s, fmtPct(s.pr))}</td></tr>`).join("") + "</tbody>";
    $("tbl-mun").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => setMun(tr.dataset.mun)));
    $("tbl-mun").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      S.sort = { key: th.dataset.k, dir: S.sort.key === th.dataset.k ? -S.sort.dir : th.dataset.k === "mun" ? 1 : -1 };
      renderTerritory();
    }));

    renderMap();
  }

  function monthRange(ms) {
    if (!ms.length) return [];
    const out = []; let [y, m] = ms[0].split("-").map(Number); const [ly, lm] = ms[ms.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }

  // ---------- Perfil ----------
  const FAIXAS = ["18–29", "30–39", "40–49", "50–59", "60+"];
  const ESC = ["Sem instrução", "Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Sem informação"];

  function renderProfile(rows) {
    const n = rows.length, mem = members(rows);

    const sx = countBy(rows, (r) => (r.resp.sx === "F" ? "Feminino" : "Masculino"));
    donut("c-sexo", ["Feminino", "Masculino"], [sx.get("Feminino") || 0, sx.get("Masculino") || 0], [C.red, C.blue]);
    $("ins-sexo").innerHTML = `<b>${fmtPct(pct(sx.get("Feminino") || 0, n))}</b> das famílias têm uma mulher como responsável.`;

    simpleBar("c-idade", rows, (r) => r.resp.fx, n, { order: FAIXAS, horizontal: false }, "ins-idade",
      (k, v) => `Faixa mais frequente: <b>${k}</b> anos (${fmtPct(pct(v, n))}). Idade média: <b>${nf0.format(mean(rows.map((r) => r.resp.id)))}</b> anos.`);
    simpleBar("c-ec", rows, (r) => r.resp.ec, n, {}, "ins-ec", (k, v) => `<b>${esc(k)}</b> é o estado civil mais comum (${fmtPct(pct(v, n))}).`);
    simpleBar("c-esc", rows, (r) => r.resp.esc, n, { order: ESC }, "ins-esc", () => {
      const ate = rows.filter((r) => ["Sem instrução", "Fundamental incompleto"].includes(r.resp.esc)).length;
      return `<b>${fmtPct(pct(ate, n))}</b> dos responsáveis não concluíram o ensino fundamental.`;
    });

    const morLab = (k) => (k >= 5 ? "5 ou mais" : `${k} ${k === 1 ? "pessoa" : "pessoas"}`);
    simpleBar("c-mor", rows, (r) => morLab(r.mor), n, { order: ["1 pessoa", "2 pessoas", "3 pessoas", "4 pessoas", "5 ou mais"], horizontal: false }, "ins-mor",
      (k, v) => `Composição mais comum: <b>${k}</b> (${fmtPct(pct(v, n))}); média de <b>${nf1.format(mean(rows.map((r) => r.mor)))}</b> moradores.`);

    // composição
    const cri = mem.filter((m) => m.id != null && m.id < 18).length, ido = mem.filter((m) => m.id >= 60).length, pcd = mem.filter((m) => m.pcd).length;
    const famCri = rows.filter((r) => r.m.some((m) => m.id != null && m.id < 18)).length;
    $("mk-comp").innerHTML = [
      [fmtN(cri), `crianças e adolescentes (${fmtPct(pct(cri, mem.length))})`],
      [fmtN(ido), `pessoas idosas 60+ (${fmtPct(pct(ido, mem.length))})`],
      [fmtN(pcd), `pessoas com deficiência (${fmtPct(pct(pcd, mem.length))})`],
      [fmtPct(pct(famCri, n)), "das famílias têm crianças/adolescentes"],
    ].map(([b, s]) => `<div class="mini"><b>${b}</b><span>${s}</span></div>`).join("");
    const defs = sortedEntries(countBy(mem.filter((m) => m.pcd), (m) => m.def));
    $("ins-comp").innerHTML = defs.length ? `Deficiência mais citada: <b>${esc(defs[0][0])}</b> (${fmtN(defs[0][1])} ${defs[0][1] === 1 ? "pessoa" : "pessoas"}).` : "Nenhuma pessoa com deficiência declarada.";

    // renda em SM
    const sm = S.data.salario_minimo || 1621;
    const FX = ["Sem renda", "Até ½ SM", "½ a 1 SM", "1 a 2 SM", "2 a 3 SM", "Mais de 3 SM"];
    const fx = (v) => (!v ? FX[0] : v <= sm / 2 ? FX[1] : v <= sm ? FX[2] : v <= 2 * sm ? FX[3] : v <= 3 * sm ? FX[4] : FX[5]);
    simpleBar("c-renda", rows, (r) => fx(r.renda), n, { order: FX, horizontal: false }, "ins-renda", () => {
      const ate1 = rows.filter((r) => (r.renda || 0) <= sm).length;
      return `<b>${fmtPct(pct(ate1, n))}</b> das famílias vivem com até 1 salário mínimo (${fmtBRL(sm)}).`;
    });

    const comRenda = mem.filter((m) => m.fonte);
    simpleBar("c-fonte", comRenda, (m) => m.fonte, comRenda.length, { unit: "pessoas" }, "ins-fonte",
      (k, v) => `<b>${esc(k)}</b> é a principal fonte entre os ${fmtN(comRenda.length)} moradores com renda (${fmtPct(pct(v, comRenda.length))}).`);
    const adultos = mem.filter((m) => m.id == null || m.id >= 14);
    simpleBar("c-trab", adultos, (m) => m.trab, adultos.length, { unit: "pessoas" }, "ins-trab", () => {
      const nt = adultos.filter((m) => /^não/i.test(m.trab || "")).length;
      return `<b>${fmtPct(pct(nt, adultos.length))}</b> dos moradores com 14 anos ou mais não trabalham.`;
    });
  }

  // ---------- Moradia ----------
  function renderHousing(rows) {
    const n = rows.length;
    simpleBar("c-posse", rows, (r) => r.posse, n, {}, "ins-posse", (k, v) => `<b>${esc(k)}</b> é a situação mais frequente (${fmtPct(pct(v, n))} das famílias).`);
    simpleBar("c-tipo", rows, (r) => r.tipo, n, {}, "ins-tipo", (k, v) => `<b>${esc(k)}</b> lidera (${fmtPct(pct(v, n))}).`);
    simpleBar("c-parede", rows, (r) => r.parede, n, {}, "ins-parede", () => {
      const prec = rows.filter((r) => r.parede && !/tijolo/i.test(r.parede)).length;
      return `<b>${fmtPct(pct(prec, n))}</b> das moradias não têm paredes só de tijolo ou pré-fabricado.`;
    });
    simpleBar("c-esgoto", rows, (r) => r.esgoto, n, {}, "ins-esgoto", () => {
      const rede = rows.filter((r) => /rede pública/i.test(r.esgoto || "")).length;
      return `<b>${fmtPct(pct(rede, n))}</b> estão ligadas à rede pública de esgoto.`;
    });

    // instalações e entorno: % de famílias com "sim"
    const share = (key) => {
      const keys = Object.keys(rows[0]?.[key] || {});
      return keys.map((k) => [k, rows.filter((r) => r[key]?.[k]).length]).sort((a, b) => b[1] - a[1]);
    };
    const inst = share("inst");
    barChart("c-inst", inst.map((e) => e[0]), inst.map((e) => e[1]), { horizontal: true, total: n });
    const faltam = inst.slice().sort((a, b) => a[1] - b[1])[0];
    $("ins-inst").innerHTML = faltam ? `Item mais ausente: <b>${esc(faltam[0])}</b> — falta em ${fmtPct(pct(n - faltam[1], n))} das moradias.` : "";
    const ent = share("entorno");
    barChart("c-entorno", ent.map((e) => e[0]), ent.map((e) => e[1]), { horizontal: true, total: n });
    $("ins-entorno").innerHTML = ent.length ? `Situação mais relatada: <b>${esc(ent[0][0].toLowerCase())}</b> (${fmtPct(pct(ent[0][1], n))} das famílias).` : "";

    // água e energia: barras 100% empilhadas
    const cats = ["Sim, individual", "Sim, coletivo", "Não possui"];
    const colors = [C.blue, C.ochre, C.red];
    const ca = countBy(rows, (r) => r.agua), ce = countBy(rows, (r) => r.energia);
    stacked100("c-infra", ["Água (cavalete)", "Energia (poste)"], cats.map((c, i) => ({ label: c, data: [ca.get(c) || 0, ce.get(c) || 0], backgroundColor: colors[i] })), n);
    $("ins-infra").innerHTML = `Ligação individual: água em <b>${fmtPct(pct(ca.get(cats[0]) || 0, n))}</b> e energia em <b>${fmtPct(pct(ce.get(cats[0]) || 0, n))}</b> das moradias.`;

    const ac = sortedEntries(countBy(rows, (r) => r.acesso));
    donut("c-acesso", ac.map((e) => e[0]), ac.map((e) => e[1]), ac.map((e) => (/^rua$/i.test(e[0]) ? C.blue : C.red)));
    const viela = ac.filter((e) => !/^rua$/i.test(e[0])).reduce((a, e) => a + e[1], 0);
    $("ins-acesso").innerHTML = `<b>${fmtPct(pct(viela, n))}</b> das moradias têm acesso por viela, beco, escadaria ou pinguela.`;

    const alug = rows.filter((r) => r.alug);
    $("mk-mor").innerHTML = [
      [nf1.format(mean(rows.map((r) => r.com))), "cômodos por moradia (média)"],
      [nf1.format(mean(rows.map((r) => r.mor / Math.max(1, r.dorm)))), "pessoas por dormitório (média)"],
      [fmtPct(pct(rows.filter((r) => r.compart).length, n)), "compartilham cozinha ou banheiro"],
      [alug.length ? fmtBRL(mean(alug.map((r) => r.alug))) : "—", "aluguel médio (quem paga)"],
      [fmtPct(pct(rows.filter((r) => r.auxMor).length, n)), "recebem auxílio-moradia"],
      [fmtPct(pct(rows.filter((r) => r.trabMor).length, n)), "trabalham na própria moradia"],
    ].map(([b, s]) => `<div class="mini"><b>${b}</b><span>${s}</span></div>`).join("");
    const mais3 = rows.filter((r) => r.dorm && r.mor / r.dorm > 3).length;
    $("ins-mkmor").innerHTML = `<b>${fmtPct(pct(mais3, n))}</b> das moradias têm mais de 3 pessoas por dormitório (adensamento excessivo).`;
  }

  // ---------- Precariedade, vulnerabilidade e risco ----------
  function renderIndicators(rows) {
    const n = rows.length, crit = S.data.criterios;
    const block = (key, canvas, ins, hero, heroLabel, icon, heroShort) => {
      const labels = crit[key];
      const cnt = countBy(rows, (r) => r[key]);
      const ent = Object.keys(labels).map((k) => [labels[k], cnt.get(+k) || 0]).sort((a, b) => b[1] - a[1]);
      barChart(canvas, ent.map((e) => e[0]), ent.map((e) => e[1]), { horizontal: true, total: n, wrap: 34 });
      const comInd = rows.filter((r) => r[key].length);
      const fam = comInd.length;
      const media = mean(comInd.map((r) => r[key].length));
      $(ins).innerHTML = ent[0] && ent[0][1] ? `Indicador mais frequente: <b>${esc(ent[0][0])}</b> (${fmtPct(pct(ent[0][1], n))} das famílias).` : "Nenhuma família com estes indicadores.";
      $(hero).innerHTML = `<div class="hero-ic">${svgIcon(icon)}</div><div class="hero-label">${heroLabel}</div>
        <div class="hero-value">${fmtPct(pct(fam, n))}</div><div class="hero-sub">${fmtN(fam)} de ${plural(n)}</div>
        ${fam ? `<div class="hero-extra"><div><b>${nf1.format(media)}</b><span>indicadores em média por família ${heroShort}</span></div><div><b>${fmtN(Math.max(...comInd.map((r) => r[key].length)))}</b><span>indicadores no caso mais grave</span></div></div>` : ""}`;
    };
    block("prec", "c-prec", "ins-prec", "hero-prec", "Famílias em precariedade habitacional", "house", "em precariedade");
    block("vuln", "c-vuln", "ins-vuln", "hero-vuln", "Famílias em vulnerabilidade social", "people", "vulnerável");
    block("risco", "c-risco", "ins-risco", "hero-risco", "Famílias em situação de risco social", "shield", "em risco");

    const Q = ["Nenhum", "1", "2", "3", "4 ou mais"];
    simpleBar("c-vulnqtd", rows, (r) => Q[Math.min(4, r.vuln.length)], n, { order: Q, horizontal: false }, "ins-vulnqtd", () => {
      const dois = rows.filter((r) => r.vuln.length >= 2).length;
      return `<b>${fmtPct(pct(dois, n))}</b> das famílias acumulam 2 ou mais indicadores.`;
    });
  }

  // =====================================================================
  // Gráficos (Chart.js)
  // =====================================================================
  function setupChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = '"Source Sans 3", system-ui, sans-serif';
    Chart.defaults.font.size = 12.5;
    Chart.defaults.color = C.ink2;
    Chart.defaults.animation.duration = 800;
    Chart.defaults.animation.easing = "easeOutQuart";
    Chart.defaults.plugins.legend.display = false;
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: "rgba(10,10,10,.94)", padding: 10, cornerRadius: 10, boxPadding: 4,
      titleFont: { family: "Poppins", weight: "600", size: 13 }, bodyFont: { size: 13 },
    });
    // Plugin: rótulo de valor na ponta das barras (rótulo seletivo, cor de texto)
    Chart.register({
      id: "valueLabels",
      afterDatasetsDraw(chart) {
        const o = chart.options.plugins.valueLabels;
        if (!o || !o.enabled) return;
        const { ctx } = chart;
        ctx.save();
        ctx.font = '600 12px "Source Sans 3", sans-serif';
        ctx.fillStyle = C.ink;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          const v = chart.data.datasets[0].data[i];
          if (v == null) return;
          const txt = (S.vfmt[chart.canvas.id] || fmtN)(v);
          if (o.horizontal) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(txt, bar.x + 6, bar.y); }
          else { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(txt, bar.x, bar.y - 4); }
        });
        ctx.restore();
      },
    });
  }

  const wrapLabel = (s, w) => {
    if (!w || s.length <= w) return s;
    const words = s.split(" "), lines = [""];
    words.forEach((wd) => { if ((lines[lines.length - 1] + " " + wd).trim().length > w) lines.push(wd); else lines[lines.length - 1] = (lines[lines.length - 1] + " " + wd).trim(); });
    return lines;
  };

  function upsert(id, config) {
    if (!window.Chart) return;
    const old = S.charts[id];
    if (old && old.config.type === config.type) {
      old.data.labels = config.data.labels;
      old.data.datasets.forEach((ds, i) => Object.assign(ds, config.data.datasets[i] || {}));
      if (config.data.datasets.length !== old.data.datasets.length) old.data.datasets = config.data.datasets;
      old.options = config.options;
      old.update();
      return;
    }
    if (old) old.destroy();
    S.charts[id] = new Chart($(id), config);
  }

  /** Barras simples (uma série). opts: horizontal, total (para %), noPct, highlight, onClick, wrap, unit */
  function barChart(id, labels, values, opts = {}) {
    const hz = opts.horizontal !== false;
    const total = opts.total;
    const unit = opts.unit || (total != null ? "famílias" : "");
    const fmtV = (v) => (opts.noPct || !total ? fmtN(v) : `${fmtN(v)} · ${fmtPct(pct(v, total))}`);
    const colors = labels.map((l) => (opts.highlight && l !== opts.highlight ? "#f3b2aa" : C.red));
    const shown = labels.map((l) => wrapLabel(String(l), opts.wrap || (hz ? 22 : 11)));
    const vmax = Math.max(1, ...values);
    // altura proporcional ao nº de barras (horizontais), para os rótulos respirarem
    if (hz && !opts.fixedHeight) {
      const lines = shown.reduce((a, l) => a + (Array.isArray(l) ? l.length : 1), 0);
      $(id).parentElement.style.height = Math.max(200, Math.max(labels.length * 30, lines * 16) + 50) + "px";
    }
    S.vfmt[id] = fmtV; // formatador fora das opções (Chart.js trata funções nas opções como "scriptable")
    upsert(id, {
      type: "bar",
      data: { labels: shown, datasets: [{ data: values, backgroundColor: colors, hoverBackgroundColor: "#a81405", borderRadius: 4, borderSkipped: "start", maxBarThickness: hz ? 18 : 34, categoryPercentage: 0.78, barPercentage: 0.9 }] },
      options: {
        indexAxis: hz ? "y" : "x", maintainAspectRatio: false, responsive: true,
        layout: { padding: hz ? { right: 8 } : { top: 18 } },
        scales: {
          [hz ? "x" : "y"]: { beginAtZero: true, suggestedMax: hz ? vmax * (opts.noPct || !total ? 1.18 : 1.42) : vmax * 1.15, grid: { color: C.grid, drawTicks: false }, border: { display: false }, ticks: { precision: 0, padding: 6, color: C.ink3 } },
          [hz ? "y" : "x"]: { grid: { display: false }, border: { color: "#ddd" }, ticks: { color: C.ink2, autoSkip: false, maxRotation: 0, font: { size: 12 } } },
        },
        plugins: {
          valueLabels: { enabled: true, horizontal: hz },
          tooltip: { callbacks: {
            title: (it) => labels[it[0].dataIndex],
            label: (it) => ` ${fmtN(it.raw)} ${unit}${total && !opts.noPct ? ` (${fmtPct(pct(it.raw, total))})` : ""}`,
          } },
        },
        onClick: opts.onClick ? (_, els) => { if (els[0]) opts.onClick(labels[els[0].index]); } : undefined,
        onHover: opts.onClick ? (e, els) => { e.native.target.style.cursor = els[0] ? "pointer" : "default"; } : undefined,
      },
    });
  }

  /** Atalho: conta categorias e escreve o insight a partir da maior. */
  function simpleBar(id, rows, get, total, opts, insId, insFn) {
    const ent = sortedEntries(countBy(rows, get), opts.order);
    barChart(id, ent.map((e) => e[0]), ent.map((e) => e[1]), { total, ...opts });
    const top = ent.slice().sort((a, b) => b[1] - a[1])[0];
    $(insId).innerHTML = top ? insFn(top[0], top[1]) : "Sem respostas para esta pergunta.";
  }

  function donut(id, labels, values, colors) {
    const total = values.reduce((a, b) => a + b, 0);
    upsert(id, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#fff", borderWidth: 2, hoverOffset: 6 }] },
      options: {
        maintainAspectRatio: false, cutout: "66%",
        plugins: {
          legend: { display: true, position: "right", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14, color: C.ink,
            generateLabels: (ch) => ch.data.labels.map((l, i) => ({ text: `${l}  ${fmtPct(pct(ch.data.datasets[0].data[i], total))}`, fillStyle: colors[i], strokeStyle: colors[i], pointStyle: "circle", index: i, hidden: false })) } },
          tooltip: { callbacks: { label: (it) => ` ${it.label}: ${fmtN(it.raw)} (${fmtPct(pct(it.raw, total))})` } },
        },
      },
    });
  }

  function stacked100(id, labels, datasets, total) {
    datasets.forEach((d) => Object.assign(d, { borderColor: "#fff", borderWidth: { right: 2 }, borderSkipped: false, maxBarThickness: 30 }));
    upsert(id, {
      type: "bar",
      data: { labels, datasets: datasets.map((d) => ({ ...d, raw: d.data, data: d.data.map((v) => pct(v, total) || 0) })) },
      options: {
        indexAxis: "y", maintainAspectRatio: false,
        scales: {
          x: { stacked: true, max: 100, grid: { color: C.grid }, border: { display: false }, ticks: { callback: (v) => v + "%", color: C.ink3 } },
          y: { stacked: true, grid: { display: false }, ticks: { color: C.ink2 } },
        },
        plugins: {
          legend: { display: true, position: "bottom", labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10, color: C.ink, padding: 14 } },
          tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${fmtN(it.dataset.raw[it.dataIndex])} (${fmtPct(it.raw)})` } },
        },
      },
    });
  }

  // =====================================================================
  // Mapa (SVG) — choropleth + bolhas proporcionais
  // =====================================================================
  const M = { vb: null, full: null, features: [], lat0: 0 };

  function buildMap() {
    const svg = $("map");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const lats = [];
    S.geo.features.forEach((f) => eachCoord(f.geometry, ([, y]) => lats.push(y)));
    M.lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const k = Math.cos((M.lat0 * Math.PI) / 180);
    const P = ([x, y]) => [x * k * 100, -y * 100]; // projeção equiretangular ajustada à latitude
    M.features = S.geo.features.map((f) => {
      const rings = polys(f.geometry).map((poly) => poly.map((ring) => ring.map(P)));
      let d = "";
      rings.forEach((poly) => poly.forEach((ring) => {
        ring.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
        d += "M" + ring.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L") + "Z";
      }));
      const outer = rings.map((p) => p[0]).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
      const bb = rings.flat(2).reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
      const feat = { nome: f.properties.nome, key: normKey(f.properties.nome), d, c: centroid(outer), bb };
      S.geoIndex.set(feat.key, feat);
      return feat;
    });
    const pad = 4;
    M.full = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
    M.vb = { ...M.full };
    svg.innerHTML = `<g id="m-shapes">${M.features.map((f, i) => `<path class="mun" data-i="${i}" d="${f.d}"/>`).join("")}</g><g id="m-bubbles"></g>`;
    applyVB();
    $("map-loading").hidden = true;
    bindMapEvents();
  }

  function eachCoord(g, fn) { polys(g).forEach((p) => p.forEach((r) => r.forEach(fn))); }
  function polys(g) { return g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; }
  function area(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; }
  function centroid(r) {
    let x = 0, y = 0; const a = area(r);
    if (!a) return r[0];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f; }
    return [x / (6 * a), y / (6 * a)];
  }

  function renderMap() {
    if (!S.geo || !S.data) return;
    const rows = filtered("mun");
    const stats = munStats(rows);
    const metric = S.mapMetric;
    const vals = new Map();
    const unmatched = [];
    stats.forEach((s) => {
      const f = S.geoIndex.get(normKey(s.mun));
      if (!f) { unmatched.push(s); return; }
      const v = metric === "fam" ? s.n : s.n >= MIN_N ? { vuln: s.pv, prec: s.pp, risco: s.pr }[metric] : null;
      vals.set(f.key, { s, v });
    });
    const max = Math.max(1, ...[...vals.values()].map((o) => o.v || 0));
    const bin = (v) => (metric === "fam" ? Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length - 1e-9)) : Math.min(RAMP.length - 1, Math.floor((v / 100) * RAMP.length - 1e-9)));
    const selKey = normKey(S.f.mun);

    document.querySelectorAll("#m-shapes .mun").forEach((p) => {
      const f = M.features[+p.dataset.i], o = vals.get(f.key);
      p.style.fill = o ? (o.v == null ? "#d9d9d9" : RAMP[Math.max(0, bin(o.v))]) : "#ebebea";
      p.classList.toggle("has", !!o);
      p.classList.toggle("sel", f.key === selKey);
    });

    // bolhas: tamanho = nº de famílias (sempre), para ver municípios pequenos
    const maxN = Math.max(1, ...[...vals.values()].map((o) => o.s.n));
    const rMax = M.full.w * 0.028;
    $("m-bubbles").innerHTML = [...vals.entries()].sort((a, b) => b[1].s.n - a[1].s.n).map(([key, o]) => {
      const f = S.geoIndex.get(key);
      const r = Math.max(rMax * 0.28, rMax * Math.sqrt(o.s.n / maxN));
      return `<circle class="bubble${key === selKey ? " sel" : ""}" data-key="${key}" cx="${f.c[0].toFixed(2)}" cy="${f.c[1].toFixed(2)}" r="${(r * M.vb.w / M.full.w).toFixed(2)}" data-r="${r}"/>`;
    }).join("");

    // legenda
    const legT = { fam: "Famílias pesquisadas", vuln: "% em vulnerabilidade", prec: "% em precariedade", risco: "% em risco social" }[metric];
    const lo = metric === "fam" ? "1" : "0%", hi = metric === "fam" ? fmtN(max) : "100%";
    $("map-legend").innerHTML = `<b>${legT}</b><div class="ramp">${RAMP.map((c) => `<i style="background:${c}"></i>`).join("")}</div><div class="ends"><span>${lo}</span><span>${hi}</span></div>
      <div style="margin-top:6px;display:flex;align-items:center;gap:6px;color:${C.ink2}"><svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="${C.red}" fill-opacity=".82" stroke="#fff" stroke-width="1.5"/></svg> tamanho = nº de famílias</div>
      ${metric !== "fam" && MIN_N > 1 ? `<div style="margin-top:4px;display:flex;align-items:center;gap:6px;color:${C.ink3}"><i style="width:14px;height:10px;background:#d9d9d9;border-radius:2px;display:inline-block"></i> menos de ${MIN_N} famílias</div>` : ""}`;

    const matched = vals.size;
    $("ins-map").innerHTML = `<b>${fmtN(matched)}</b> ${matched === 1 ? "município" : "municípios"} no mapa, com ${fmtN([...vals.values()].reduce((a, o) => a + o.s.n, 0))} famílias.` +
      (unmatched.length ? ` Não localizados na malha do IBGE (verificar grafia no Kobo): ${unmatched.map((s) => `<b>${esc(s.mun)}</b> (${s.n})`).join(", ")}.` : "") +
      " Clique num município para filtrar o painel.";
    M.vals = vals;
  }

  // ---- interação do mapa ----
  function applyVB() {
    const { x, y, w, h } = M.vb;
    $("map").setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    const s = M.vb.w / M.full.w;
    document.querySelectorAll("#m-bubbles .bubble").forEach((c) => c.setAttribute("r", (+c.dataset.r * s).toFixed(2)));
  }
  function animateVB(to, ms = 550) {
    const from = { ...M.vb }, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      M.vb = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e };
      applyVB();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function mapReset() { if (M.full) animateVB(M.full); }
  function mapZoomTo(mun) {
    const f = S.geoIndex.get(normKey(mun));
    if (!f || !M.full) return;
    const minW = M.full.w * 0.16;
    const [x0, y0, x1, y1] = f.bb;
    let w = Math.max(minW, (x1 - x0) * 3), h = (w * M.full.h) / M.full.w;
    animateVB({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
  }
  function zoomBy(factor, cx, cy) {
    const v = M.vb, nw = Math.min(M.full.w * 1.2, Math.max(M.full.w * 0.03, v.w * factor)), nh = (nw * v.h) / v.w;
    cx = cx ?? v.x + v.w / 2; cy = cy ?? v.y + v.h / 2;
    M.vb = { x: cx - ((cx - v.x) * nw) / v.w, y: cy - ((cy - v.y) * nh) / v.h, w: nw, h: nh };
    applyVB();
  }

  function bindMapEvents() {
    const svg = $("map"), tip = $("map-tip");
    const toSvg = (e) => { const r = svg.getBoundingClientRect(); const s = Math.max(M.vb.w / r.width, M.vb.h / r.height); const ox = (r.width * s - M.vb.w) / 2, oy = (r.height * s - M.vb.h) / 2; return [M.vb.x - ox + (e.clientX - r.left) * s, M.vb.y - oy + (e.clientY - r.top) * s]; };

    svg.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = toSvg(e); zoomBy(e.deltaY > 0 ? 1.18 : 1 / 1.18, x, y); }, { passive: false });
    let drag = null, moved = false;
    svg.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, vb: { ...M.vb } }; moved = false; });
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect(), s = Math.max(M.vb.w / r.width, M.vb.h / r.height);
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; svg.classList.add("dragging"); }
      M.vb = { ...drag.vb, x: drag.vb.x - dx * s, y: drag.vb.y - dy * s }; applyVB();
    });
    window.addEventListener("pointerup", () => { drag = null; svg.classList.remove("dragging"); });

    const target = (e) => {
      const el = e.target;
      if (el.classList.contains("bubble")) return S.geoIndex.get(el.dataset.key);
      if (el.classList.contains("mun")) return M.features[+el.dataset.i];
      return null;
    };
    svg.addEventListener("mousemove", (e) => {
      const f = target(e);
      if (!f || drag) { tip.hidden = true; return; }
      const o = M.vals?.get(f.key);
      const priv = (v) => (o && o.s.n >= MIN_N ? fmtPct(v) : "—");
      tip.innerHTML = `<b>${esc(f.nome)}</b>` + (o
        ? `<div class="row"><span>Famílias</span><span>${fmtN(o.s.n)}</span></div><div class="row"><span>Pessoas</span><span>${fmtN(o.s.p)}</span></div>
           <div class="row"><span>Vulnerabilidade</span><span>${priv(o.s.pv)}</span></div><div class="row"><span>Precariedade</span><span>${priv(o.s.pp)}</span></div>
           <div class="row"><span>Risco social</span><span>${priv(o.s.pr)}</span></div>`
        : `<div class="row"><span>Sem pesquisas</span><span></span></div>`);
      tip.hidden = false;
      const x = Math.min(window.innerWidth - tip.offsetWidth - 10, e.clientX + 14), y = Math.min(window.innerHeight - tip.offsetHeight - 10, e.clientY + 14);
      tip.style.left = x + "px"; tip.style.top = y + "px";
    });
    svg.addEventListener("mouseleave", () => (tip.hidden = true));
    svg.addEventListener("click", (e) => {
      if (moved) return;
      const f = target(e), o = f && M.vals?.get(f.key);
      if (o) setMun(o.s.mun);
    });
    $("map-zoom-in").addEventListener("click", () => zoomBy(1 / 1.4));
    $("map-zoom-out").addEventListener("click", () => zoomBy(1.4));
    $("map-reset").addEventListener("click", mapReset);
    $("map-metric").addEventListener("change", (e) => { S.mapMetric = e.target.value; renderMap(); });
  }

  // =====================================================================
  // Navegação, animações e inicialização
  // =====================================================================
  let revealObs;
  function observeReveal(root = document) {
    if (!revealObs) revealObs = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealObs.unobserve(e.target); } }), { threshold: 0.08 });
    root.querySelectorAll(".reveal:not(.in)").forEach((el) => revealObs.observe(el));
  }

  function bindNav() {
    const links = [...document.querySelectorAll(".nav a")];
    const obs = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
    }), { rootMargin: "-40% 0px -55% 0px" });
    document.querySelectorAll(".section").forEach((s) => obs.observe(s));
    links.forEach((a) => a.addEventListener("click", () => $("sidebar").classList.remove("open")));
    $("menu-btn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  }

  function init() {
    document.querySelectorAll(".card, .rule-note").forEach((el) => el.classList.add("reveal"));
    observeReveal();
    setupChartDefaults();
    bindFilters();
    bindNav();
    $("btn-refresh").addEventListener("click", loadData);
    loadData().then(loadGeo);
    if (CFG.autoRefreshMin) setInterval(loadData, CFG.autoRefreshMin * 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
