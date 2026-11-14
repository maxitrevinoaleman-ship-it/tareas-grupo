(() => {
  "use strict";

  const EDITOR = !!window.MODO_EDITOR;
  const CFG = Object.assign({ nombreGrupo: "Tareas del grupo", usuario: "", repositorio: "", rama: "main", archivo: "tareas.json" }, window.CONFIG || {});

  // Detecta usuario/repositorio si la página está en https://USUARIO.github.io/REPO/
  if (!CFG.usuario && location.hostname.endsWith(".github.io")) {
    CFG.usuario = location.hostname.split(".")[0];
    const primer = location.pathname.split("/").filter(Boolean)[0];
    CFG.repositorio = primer && !primer.includes(".") ? primer : `${CFG.usuario}.github.io`;
  }
  const CONECTADO = !!(CFG.usuario && CFG.repositorio);
  const API = CONECTADO ? `https://api.github.com/repos/${CFG.usuario}/${CFG.repositorio}/contents/${CFG.archivo}` : "";
  const LS_TOKEN = "tareas-token";
  const LS_LOCAL = "tareas-datos-local";
  const LS_TAB = "tareas-pestana";
  const LS_BLUR = "tareas-blur";
  // Efecto blur activado por defecto; el interruptor lo guarda en este navegador.
  let BLUR_ON = localStorage.getItem(LS_BLUR) !== "0";
  document.documentElement.classList.toggle("no-blur", !BLUR_ON);
  let animarVista = false;   // true solo al cambiar de pestaña/semana/mes
  let blurPop = false;       // true solo en el render que sigue a cambiar el interruptor
  let pillPrev = null;       // posición de la pastilla de pestañas en el render anterior
  let cargadoAlguna = false;

  const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  // Color fijo de cada día (lunes a domingo)
  const DIA_COLORES = ["#4f46e5", "#e11d48", "#0d9488", "#9333ea", "#ea580c", "#0284c7", "#be185d"];

  // Calendario escolar oficial SEP ciclo 2026-2027 (fechas aproximadas; confirmar con la escuela).
  const RECESOS = [
    { start: "2026-12-21", end: "2027-01-06", label: "Vacaciones de invierno" },
    { start: "2027-03-22", end: "2027-04-04", label: "Vacaciones de primavera" }
  ];
  const CTE_DATES = ["2026-09-25", "2026-10-30", "2026-11-27", "2027-01-29", "2027-02-26", "2027-03-26", "2027-05-28", "2027-06-25"];
  const SUSPENSION_DATES = [
    { date: "2026-09-16", label: "Independencia de México" },
    { date: "2026-11-02", label: "Día de Muertos" },
    { date: "2026-11-16", label: "Revolución Mexicana" },
    { date: "2027-02-01", label: "Aniversario de la Constitución" },
    { date: "2027-03-15", label: "Natalicio de Benito Juárez" },
    { date: "2027-05-05", label: "Suspensión de labores" }
  ];
  const EVENTO_INFO = {
    cte: { etiqueta: "CTE", nombre: "Consejo Técnico", color: "#0d9488", aviso: "Día de Consejo Técnico" },
    suspension: { etiqueta: "Sin clases", nombre: "Sin clases", color: "#e11d48", aviso: "Sin clases este día" },
    receso: { etiqueta: "Receso", nombre: "Receso", color: "#64748b", aviso: "Periodo de receso" }
  };
  const ESCOLAR_BASE = [
    ...RECESOS.map(r => ({ fecha: r.start, fin: r.end, type: "receso", label: r.label })),
    ...CTE_DATES.map(f => ({ fecha: f, type: "cte", label: "Consejo Técnico Escolar" })),
    ...SUSPENSION_DATES.map(s => ({ fecha: s.date, type: "suspension", label: s.label }))
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  // Evento oficial de un día (los recesos cubren todo su rango).
  const eventoBase = s => ESCOLAR_BASE.find(e => e.fin ? s >= e.fecha && s <= e.fin : e.fecha === s) || null;
  // Evento de un día: oficial, o una suspensión que el grupo marcó desde el editor.
  const eventoDe = s => eventoBase(s) || ((estado.datos.suspensiones || []).includes(s)
    ? { fecha: s, type: "suspension", label: "Suspensión marcada por el grupo" } : null);
  function proximosEventos(desde, n) {
    const oficiales = ESCOLAR_BASE.filter(e => (e.fin || e.fecha) >= desde);
    const manuales = (estado.datos.suspensiones || [])
      .filter(s => s >= desde && !eventoBase(s))
      .map(s => ({ fecha: s, type: "suspension", label: "Suspensión marcada por el grupo" }));
    return [...oficiales, ...manuales].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, n);
  }
  const COLORES = ["#1d4ed8", "#9a3412", "#b91c1c", "#0e7490", "#6d28d9", "#a16207", "#047857", "#4d7c0f", "#a21caf", "#be123c", "#0f766e", "#4338ca"];
  const iniciales = nombre => {
    const p = nombre.replace(/\b(de|del|la|el|y|en)\b/gi, " ").trim().split(/\s+/).filter(Boolean);
    if (nombre.length <= 4) return nombre.toUpperCase();
    return (p.length > 1 ? p[0][0] + p[1][0] : nombre.slice(0, 2)).toUpperCase();
  };

  const estado = {
    datos: { materias: [], tareas: [] },
    tab: leerLS(LS_TAB) || "semana",
    semana: 0,      // desplazamiento de semanas respecto a la actual
    mes: 0,         // desplazamiento de meses respecto al actual
    materia: null,  // materia abierta en la pestaña Materias
    cargando: true,
    error: ""
  };

  // ---------- utilidades ----------
  function leerLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function escribirLS(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const deIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const hoy = () => iso(new Date());
  const sumarDias = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const lunesDe = d => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return sumarDias(r, -((r.getDay() + 6) % 7)); };
  const diaSemana = d => (d.getDay() + 6) % 7; // 0 = lunes
  const fechaLarga = s => { const d = deIso(s); return `${DIAS[diaSemana(d)]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
  const fechaCorta = s => { const d = deIso(s); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };

  // Una tarea está pendiente hasta el día de entrega; ese día ya se quita.
  const pendiente = t => t.entrega > hoy();
  const colorDe = nombre => (estado.datos.materias.find(m => m.nombre === nombre) || {}).color || "#555f6d";
  const ordenar = arr => arr.slice().sort((a, b) => a.entrega.localeCompare(b.entrega) || a.materia.localeCompare(b.materia));
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function normalizar(d) {
    d = d && typeof d === "object" ? d : {};
    return {
      materias: Array.isArray(d.materias) ? d.materias.filter(m => m && m.nombre) : [],
      tareas: Array.isArray(d.tareas) ? d.tareas.filter(t => t && t.id && t.entrega) : [],
      sorpresa: d.sorpresa && typeof d.sorpresa === "object" ? d.sorpresa : null,
      suspensiones: Array.isArray(d.suspensiones) ? d.suspensiones.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)) : []
    };
  }

  // ---------- datos ----------
  function aBase64(texto) {
    const bytes = new TextEncoder().encode(texto);
    let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }
  function deBase64(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  async function leerRemoto(conToken) {
    const headers = { Accept: "application/vnd.github+json" };
    const token = leerLS(LS_TOKEN);
    if (conToken && token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${API}?ref=${encodeURIComponent(CFG.rama)}&t=${Date.now()}`, { headers, cache: "no-store" });
    if (!r.ok) throw new Error(`GitHub respondió ${r.status}`);
    const j = await r.json();
    return { datos: normalizar(JSON.parse(deBase64(j.content))), sha: j.sha };
  }

  async function cargar() {
    estado.cargando = true; render();
    try {
      if (CONECTADO) {
        try {
          estado.datos = (await leerRemoto(EDITOR)).datos;
        } catch (e) {
          // Si la API falla (p. ej. límite de consultas), usa la copia publicada en la página.
          const r = await fetch(`${CFG.archivo}?t=${Date.now()}`, { cache: "no-store" });
          estado.datos = normalizar(await r.json());
        }
      } else {
        const local = leerLS(LS_LOCAL);
        if (local) estado.datos = normalizar(JSON.parse(local));
        else {
          const r = await fetch(`${CFG.archivo}?t=${Date.now()}`, { cache: "no-store" });
          estado.datos = normalizar(await r.json());
        }
      }
      estado.error = "";
    } catch (e) {
      estado.error = "No se pudieron cargar las tareas. Revisa tu conexión e inténtalo de nuevo.";
    }
    estado.cargando = false;
    animarVista = !cargadoAlguna; cargadoAlguna = true;
    render();
  }

  // Aplica un cambio sobre la versión más reciente y la guarda.
  async function guardar(cambio, mensaje) {
    if (!CONECTADO) {
      const d = normalizar(JSON.parse(JSON.stringify(estado.datos)));
      cambio(d);
      escribirLS(LS_LOCAL, JSON.stringify(d));
      estado.datos = d; render();
      aviso("Guardado (modo de prueba local)");
      return true;
    }
    const token = leerLS(LS_TOKEN);
    if (!token) { abrirConexion("Para publicar necesitas conectar tu llave de GitHub."); return false; }
    aviso("Publicando…", false, 0);
    for (let intento = 0; intento < 3; intento++) {
      try {
        const { datos, sha } = await leerRemoto(true);
        cambio(datos);
        const r = await fetch(API, {
          method: "PUT",
          headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: mensaje, content: aBase64(JSON.stringify(datos, null, 2) + "\n"), sha, branch: CFG.rama })
        });
        if (r.status === 409 || r.status === 422) continue; // alguien más guardó al mismo tiempo: reintenta
        if (r.status === 401 || r.status === 403 || r.status === 404) {
          aviso("Tu llave de GitHub no tiene permiso para publicar. Revísala en «Conexión».", true);
          return false;
        }
        if (!r.ok) throw new Error(String(r.status));
        estado.datos = datos; render();
        aviso("Publicado. Ya lo pueden ver todos.");
        return true;
      } catch (e) {
        if (intento === 2) { aviso("No se pudo publicar. Inténtalo de nuevo.", true); return false; }
      }
    }
    aviso("No se pudo publicar. Inténtalo de nuevo.", true);
    return false;
  }

  // ---------- notificaciones (OneSignal) ----------
  // Quien activa las notificaciones queda registrado en OneSignal. Cuando se
  // publica una tarea nueva, una GitHub Action (.github/workflows/avisos.yml)
  // le pide a OneSignal que mande el aviso a todos.
  const PUSH_ON = !!(CFG.onesignalAppId && CONECTADO);
  const esIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let push = { listo: false, activo: false };

  function estadoPush() {
    if (esIOS && !instalada()) return "ios-instalar";
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return "no-soportado";
    if (Notification.permission === "denied") return "bloqueado";
    if (!push.listo) return "cargando";
    return push.activo ? "activo" : "inactivo";
  }

  function iniciarPush() {
    if (!PUSH_ON || estadoPush() === "ios-instalar" || estadoPush() === "no-soportado") return;
    const base = location.pathname.replace(/[^/]*$/, ""); // p. ej. "/tareas-grupo/"
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async OneSignal => {
      try {
        await OneSignal.init({
          appId: CFG.onesignalAppId,
          serviceWorkerPath: base.slice(1) + "OneSignalSDKWorker.js",
          serviceWorkerParam: { scope: base },
          notifyButton: { enable: false }
        });
        const actualizar = () => {
          push = { listo: true, activo: !!OneSignal.User.PushSubscription.optedIn && Notification.permission === "granted" };
          render();
        };
        OneSignal.User.PushSubscription.addEventListener("change", actualizar);
        OneSignal.Notifications.addEventListener("permissionChange", actualizar);
        actualizar();
      } catch (e) {
        console.warn("OneSignal no se pudo iniciar", e);
      }
    });
    const s = document.createElement("script");
    s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    s.defer = true;
    document.head.appendChild(s);
  }

  function botonPush() {
    if (!PUSH_ON) return "";
    const activo = estadoPush() === "activo";
    return `<button class="btn btn-ghost-light${activo ? " push-on" : ""}" data-accion="push">${activo ? "🔔 Avisos activos" : "🔔 Activar avisos"}</button>`;
  }

  function abrirPush() {
    const st = estadoPush();
    const textos = {
      "ios-instalar": `En iPhone las notificaciones solo funcionan con la app instalada:<ol class="pasos">
          <li>Abre esta página en <strong>Safari</strong>.</li>
          <li>Toca <strong>Compartir</strong> (el cuadrito con la flecha) → <strong>Agregar a inicio</strong>.</li>
          <li>Abre la app desde el ícono nuevo y vuelve a tocar <strong>🔔 Activar avisos</strong>.</li></ol>
          <div class="help">Necesitas iOS 16.4 o más nuevo.</div>`,
      "no-soportado": "Este navegador no permite notificaciones. Prueba con Chrome en Android, o instala la app en iPhone.",
      "bloqueado": "Bloqueaste las notificaciones para esta página. Actívalas en la configuración del navegador (ícono del candado junto a la dirección → Notificaciones → Permitir) y vuelve a intentarlo.",
      "cargando": "Preparando las notificaciones… espera unos segundos y vuelve a intentarlo.",
      "inactivo": "Te llegará una notificación al celular cada vez que se publique una tarea nueva, aunque tengas la app cerrada.",
      "activo": "Las notificaciones están activas en este dispositivo. Te llegará un aviso con cada tarea nueva."
    };
    dialogo(`
      <div class="dlg-head">🔔 Avisos de tareas nuevas</div>
      <div class="dlg-body"><div style="font-size:14px">${textos[st]}</div></div>
      <div class="dlg-foot">
        ${st === "activo" ? '<button class="btn btn-danger" data-apagar>Desactivar</button><span class="spacer"></span>' : ""}
        <button class="btn" data-cerrar>Cerrar</button>
        ${st === "inactivo" ? '<button class="btn btn-primary" data-activar>Activar notificaciones</button>' : ""}
      </div>`, d => {
      const a = d.querySelector("[data-activar]");
      if (a) a.addEventListener("click", async () => {
        const OS = window.OneSignal;
        if (!OS) return;
        try {
          // Se pide el permiso dentro del toque (iPhone lo exige).
          await OS.Notifications.requestPermission();
          if (Notification.permission === "granted") {
            await OS.User.PushSubscription.optIn();
            d.close(); aviso("¡Listo! Te llegarán los avisos de tareas nuevas.");
          } else {
            d.close(); aviso("No se activaron. Tienes que tocar «Permitir».", true, 5000);
          }
        } catch { d.close(); aviso("No se pudieron activar. Inténtalo de nuevo.", true); }
      });
      const o = d.querySelector("[data-apagar]");
      if (o) o.addEventListener("click", async () => {
        try { await window.OneSignal.User.PushSubscription.optOut(); } catch {}
        d.close(); aviso("Avisos desactivados en este dispositivo.");
      });
    });
  }

  // ---------- interfaz ----------
  const app = document.getElementById("app");
  let toastTimer;
  function aviso(texto, error = false, ms = 3200) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = texto; t.classList.toggle("err", error);
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => t.remove(), ms);
  }

  function tarjeta(t, opts = {}) {
    const done = !pendiente(t);
    return `<button class="task${done ? " done" : ""}" style="--c:${esc(colorDe(t.materia))}" data-tarea="${esc(t.id)}">
      ${opts.sinMateria ? "" : `<div class="t-subject">${esc(t.materia)}</div>`}
      <div class="t-title">${esc(t.titulo)}</div>
      ${opts.desc && t.descripcion ? `<div class="t-desc">${esc(t.descripcion)}</div>` : ""}
    </button>`;
  }

  function render() {
    const tabs = [["semana", "Semana"], ["materias", "Materias"], ["calendario", "Calendario"]];
    const h = hoy();
    app.innerHTML = `
      <header class="topbar">
        <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span><span class="ring"></span>
        <div class="topbar-inner">
        <div class="title-row">
          <div>
            <h1 class="titulo-app">${esc(CFG.nombreGrupo)}${EDITOR ? '<span class="badge">Editor</span>' : ""}</h1>
            <div class="subtitle">Hoy es ${fechaLarga(h).toLowerCase()} de ${deIso(h).getFullYear()}</div>
          </div>
          ${EDITOR ? `<div class="actions">
            <button class="btn btn-light" data-accion="nueva">+ Nueva tarea</button>
            <button class="btn btn-ghost-light" data-accion="materias">Materias</button>
            <button class="btn btn-ghost-light" data-accion="sorpresa">Sorpresa</button>
            <button class="btn btn-ghost-light" data-accion="conexion">Conexión</button>
            ${botonPush()}
            ${botonBlur()}
          </div>` : `<div class="actions"><button class="btn btn-ghost-light" data-accion="recargar">Actualizar</button>${botonPush()}${botonBlur()}</div>`}
        </div>
        <nav class="tabs">${tabs.map(([k, n]) => `<button class="tab${estado.tab === k ? " active" : ""}" data-tab="${k}">${n}</button>`).join("")}</nav>
      </div></header>
      <main class="${animarVista ? "swap" : ""}">${avisos()}${estado.cargando ? '<div class="notice">Cargando tareas…</div>' : estado.error ? `<div class="notice warn">${esc(estado.error)}</div>` : vista()}</main>`;
    animarVista = false;

    // Pastilla deslizante bajo la pestaña activa; se desliza desde la pestaña anterior.
    const nav = app.querySelector(".tabs");
    const act = nav && nav.querySelector(".tab.active");
    if (act) {
      const pill = document.createElement("span");
      pill.className = "pill";
      nav.prepend(pill);
      const destino = { x: act.offsetLeft, w: act.offsetWidth };
      const origen = pillPrev && pillPrev.tab !== estado.tab ? pillPrev : destino;
      pill.style.transition = "none";
      pill.style.transform = `translateX(${origen.x}px)`;
      pill.style.width = `${origen.w}px`;
      void pill.offsetWidth; // fuerza un reflow para que la transición arranque desde el origen
      pill.style.transition = "";
      pill.style.transform = `translateX(${destino.x}px)`;
      pill.style.width = `${destino.w}px`;
      pillPrev = { tab: estado.tab, ...destino };
    }
  }

  function botonBlur() {
    return `<button class="btn btn-ghost-light switch${blurPop ? " pop" : ""}" data-accion="blur" aria-pressed="${BLUR_ON}" title="Activa o desactiva el desenfoque">` +
      `<span class="sw" aria-hidden="true"></span>Blur</button>`;
  }

  function avisos() {
    if (!EDITOR) return "";
    if (!CONECTADO) return `<div class="notice warn">Modo de prueba: los cambios solo se guardan en este navegador. Cuando la página esté publicada en GitHub Pages, se publicarán para todos.</div>`;
    if (!leerLS(LS_TOKEN)) return `<div class="notice warn">Aún no conectas tu llave de GitHub. Puedes ver todo, pero para publicar entra a «Conexión».</div>`;
    return "";
  }

  function vista() {
    if (estado.tab === "materias") return vistaMaterias();
    if (estado.tab === "calendario") return vistaCalendario();
    return vistaSemana();
  }

  function vistaSemana() {
    const h = hoy();
    const lunes = sumarDias(lunesDe(new Date()), estado.semana * 7);
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
    const porDia = dias.map(d => ordenar(estado.datos.tareas.filter(t => t.entrega === iso(d) && pendiente(t))));
    // Sábado y domingo solo aparecen si hay algo pendiente esos días.
    const visibles = dias.map((d, i) => i < 5 || porDia[i].length > 0);
    const total = porDia.reduce((n, a) => n + a.length, 0);
    const fin = dias[4];
    const rango = `${lunes.getDate()} ${MESES[lunes.getMonth()].slice(0, 3)} – ${fin.getDate()} ${MESES[fin.getMonth()].slice(0, 3)}`;
    const titulo = estado.semana === 0 ? "Esta semana" : estado.semana === 1 ? "Próxima semana" : estado.semana === -1 ? "Semana pasada" : "Semana";
    const cols = visibles.filter(Boolean).length;

    return `<div class="section-head">
        <div><h2>${titulo}</h2><div class="meta">${rango} · ${total} ${total === 1 ? "tarea pendiente" : "tareas pendientes"}</div></div>
        <div class="nav-group">
          <button class="btn btn-sm" data-semana="-1" aria-label="Semana anterior">‹</button>
          <button class="btn btn-sm" data-semana="0">Hoy</button>
          <button class="btn btn-sm" data-semana="1" aria-label="Semana siguiente">›</button>
        </div>
      </div>
      <div class="panel week" style="--cols:${cols}">
        ${dias.map((d, i) => {
          if (!visibles[i]) return "";
          const s = iso(d);
          const cls = s === h ? " is-today" : s < h ? " is-past" : "";
          return `<div class="week-col${cls}" style="--d:${DIA_COLORES[i]}">
            <div class="week-head"><div class="day">${DIAS[i]}</div><div class="date">${d.getDate()} de ${MESES[d.getMonth()]}</div><div class="num">${d.getDate()}</div></div>
            <div class="week-body">${porDia[i].length ? porDia[i].map(t => tarjeta(t)).join("") : `<div class="empty">${s <= h ? "—" : "Sin tareas"}</div>`}</div>
          </div>`;
        }).join("")}
      </div>`;
  }

  function vistaMaterias() {
    const { materias, tareas } = estado.datos;
    if (estado.materia && materias.some(m => m.nombre === estado.materia)) {
      const m = materias.find(x => x.nombre === estado.materia);
      const suyas = tareas.filter(t => t.materia === m.nombre);
      const pend = ordenar(suyas.filter(pendiente));
      const pasadas = ordenar(suyas.filter(t => !pendiente(t))).reverse();
      const fila = t => `<div class="list-row"><div class="when">${fechaLarga(t.entrega)}</div>${tarjeta(t, { sinMateria: true, desc: true })}</div>`;
      return `<div class="section-head">
          <div class="nav-group"><button class="btn btn-sm" data-volver>‹ Materias</button></div>
        </div>
        <div class="panel subject-detail" style="--c:${esc(m.color)}">
          <div class="subject-hero">
            <div><h2>${esc(m.nombre)}</h2><div class="meta">${pend.length} ${pend.length === 1 ? "tarea pendiente" : "tareas pendientes"}</div></div>
            ${EDITOR ? `<button class="btn btn-sm" data-accion="nueva" data-materia="${esc(m.nombre)}">+ Tarea de ${esc(m.nombre)}</button>` : ""}
          </div>
          <div class="list">${pend.length ? pend.map(fila).join("") : '<div class="empty">No hay tareas pendientes de esta materia.</div>'}</div>
          ${pasadas.length ? `<details><summary class="subhead">Ya entregadas (${pasadas.length})</summary><div class="list">${pasadas.map(fila).join("")}</div></details>` : ""}
        </div>`;
    }
    estado.materia = null;
    return `<div class="section-head"><div><h2>Materias</h2><div class="meta">Elige una materia para ver solo sus tareas</div></div></div>
      ${materias.length ? `<div class="subjects">${materias.map(m => {
        const n = tareas.filter(t => t.materia === m.nombre && pendiente(t)).length;
        return `<button class="subject-card" style="--c:${esc(m.color)}" data-abrir-materia="${esc(m.nombre)}">
          ${n ? `<span class="dot" aria-label="${n} ${n === 1 ? "tarea pendiente" : "tareas pendientes"}">${n}</span>` : ""}
          <div class="ico">${esc(iniciales(m.nombre))}</div>
          <div class="name">${esc(m.nombre)}</div>
          <div class="count">${n ? `${n} ${n === 1 ? "pendiente" : "pendientes"}` : "Sin pendientes"}</div>
        </button>`;
      }).join("")}</div>` : `<div class="notice">Todavía no hay materias.${EDITOR ? " Agrégalas desde el botón «Materias»." : ""}</div>`}`;
  }

  function vistaCalendario() {
    const h = hoy();
    const base = new Date();
    const primero = new Date(base.getFullYear(), base.getMonth() + estado.mes, 1);
    const inicio = lunesDe(primero);
    const ultimo = new Date(primero.getFullYear(), primero.getMonth() + 1, 0);
    const semanas = Math.ceil((diaSemana(primero) + ultimo.getDate()) / 7);
    const celdas = Array.from({ length: semanas * 7 }, (_, i) => sumarDias(inicio, i));
    const delMes = estado.datos.tareas.filter(t => deIso(t.entrega).getMonth() === primero.getMonth() && deIso(t.entrega).getFullYear() === primero.getFullYear());
    const pend = delMes.filter(pendiente).length;

    return `<div class="section-head">
        <div><h2 style="text-transform:capitalize">${MESES[primero.getMonth()]} ${primero.getFullYear()}</h2>
        <div class="meta">${delMes.length} ${delMes.length === 1 ? "entrega" : "entregas"} este mes · ${pend} ${pend === 1 ? "pendiente" : "pendientes"}</div></div>
        <div class="nav-group">
          <button class="btn btn-sm" data-mes="-1" aria-label="Mes anterior">‹</button>
          <button class="btn btn-sm" data-mes="0">Hoy</button>
          <button class="btn btn-sm" data-mes="1" aria-label="Mes siguiente">›</button>
        </div>
      </div>
      <div class="panel cal">
        ${DIAS_CORTOS.map((d, i) => `<div class="cal-dow" style="--d:${DIA_COLORES[i]}">${d}</div>`).join("")}
        ${celdas.map(d => {
          const s = iso(d);
          const lista = ordenar(estado.datos.tareas.filter(t => t.entrega === s));
          const cls = d.getMonth() !== primero.getMonth() ? " other" : s === h ? " today" : "";
          const ev = eventoDe(s);
          const delMesActual = d.getMonth() === primero.getMonth();
          return `<div class="cal-day${cls}${ev && delMesActual ? ` tipo-${ev.type}` : ""}" data-dia="${s}" style="--d:${DIA_COLORES[diaSemana(d)]}">
            <div class="cal-num">${d.getDate()}</div>
            ${ev && delMesActual ? `<span class="cal-evt" style="--e:${EVENTO_INFO[ev.type].color}">${EVENTO_INFO[ev.type].etiqueta}</span>` : ""}
            ${lista.map(t => `<button class="chip${pendiente(t) ? "" : " done"}" style="--c:${esc(colorDe(t.materia))}" data-tarea="${esc(t.id)}" title="${esc(t.materia)}: ${esc(t.titulo)}">${esc(t.titulo)}</button>`).join("")}
          </div>`;
        }).join("")}
      </div>
      <div class="cal-leyenda">${Object.values(EVENTO_INFO).map(v => `<span style="--e:${v.color}"><i></i>${v.nombre}</span>`).join("")}</div>
      <h3 class="subhead">Próximos eventos del calendario escolar</h3>
      <div class="panel evt-lista">
        ${proximosEventos(h, 6).map((e, i) => {
          const f = deIso(e.fecha);
          return `<div class="evt-row" style="--e:${EVENTO_INFO[e.type].color}; --i:${i}">
            <div class="evt-fecha"><span class="evt-dia">${f.getDate()}</span><span class="evt-mes">${MESES[f.getMonth()].slice(0, 3)}</span></div>
            <div class="evt-info">
              <span class="evt-tag">${EVENTO_INFO[e.type].nombre}</span>
              <b class="evt-label">${esc(e.label)}</b>
              <div class="meta">${fechaLarga(e.fecha)}${e.fin ? ` – ${fechaLarga(e.fin)}` : ""}</div>
            </div>
          </div>`;
        }).join("") || '<div class="empty">No hay eventos próximos.</div>'}
      </div>
      <p class="cal-nota">Fechas aproximadas del calendario SEP 2026-2027. Confírmalas con tu escuela.</p>`;
  }

  // ---------- diálogos ----------
  function dialogo(html, alAbrir) {
    const d = document.createElement("dialog");
    d.innerHTML = html;
    document.body.appendChild(d);
    // Se quita del DOM después de la animación de salida (ver CSS de dialog).
    d.addEventListener("close", () => setTimeout(() => d.remove(), 350));
    d.addEventListener("click", e => { if (e.target === d) d.close(); });
    d.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", () => d.close()));
    if (alAbrir) alAbrir(d);
    d.showModal();
    return d;
  }

  function verTarea(id) {
    const t = estado.datos.tareas.find(x => x.id === id);
    if (!t) return;
    const estadoTxt = pendiente(t) ? "Pendiente" : "Ya es día de entrega o pasó";
    dialogo(`
      <div class="dlg-head" style="--c:${esc(colorDe(t.materia))}">${esc(t.titulo)}</div>
      <div class="dlg-body">
        <div class="detail-meta"><strong>${esc(t.materia)}</strong> · Entrega: ${fechaLarga(t.entrega)} · ${estadoTxt}</div>
        ${t.descripcion ? `<div class="detail-desc">${esc(t.descripcion)}</div>` : '<div class="detail-meta">Sin descripción.</div>'}
      </div>
      <div class="dlg-foot">
        ${EDITOR ? `<button class="btn btn-danger" data-borrar>Borrar</button><span class="spacer"></span><button class="btn" data-editar>Editar</button>` : ""}
        <button class="btn btn-primary" data-cerrar>Cerrar</button>
      </div>`, d => {
      const b = d.querySelector("[data-borrar]");
      if (b) b.addEventListener("click", async () => {
        if (!confirm(`¿Borrar la tarea «${t.titulo}»?`)) return;
        d.close();
        await guardar(x => { x.tareas = x.tareas.filter(y => y.id !== t.id); }, `Borrar tarea: ${t.titulo}`);
      });
      const e = d.querySelector("[data-editar]");
      if (e) e.addEventListener("click", () => { d.close(); formTarea(t); });
    });
  }

  function verDia(s) {
    const lista = ordenar(estado.datos.tareas.filter(t => t.entrega === s));
    const ev = eventoDe(s);
    const manual = (estado.datos.suspensiones || []).includes(s);
    dialogo(`
      <div class="dlg-head" style="--c:${DIA_COLORES[diaSemana(deIso(s))]}">${fechaLarga(s)}</div>
      <div class="dlg-body">
        ${ev ? `<div class="evt-banner" style="--e:${EVENTO_INFO[ev.type].color}"><b>${esc(ev.label)}</b><span>${EVENTO_INFO[ev.type].aviso}</span></div>` : ""}
        ${lista.length ? lista.map(t => tarjeta(t, { desc: true })).join("") : '<div class="empty">No hay entregas este día.</div>'}
      </div>
      <div class="dlg-foot">
        ${EDITOR ? `<button class="btn" data-nueva-dia>+ Tarea para este día</button>` : ""}
        ${EDITOR && !eventoBase(s) ? `<button class="btn" data-suspender>${manual ? "Quitar sin clases" : "Marcar sin clases"}</button>` : ""}
        <button class="btn btn-primary" data-cerrar>Cerrar</button>
      </div>`, d => {
      d.querySelectorAll("[data-tarea]").forEach(b => b.addEventListener("click", () => { d.close(); verTarea(b.dataset.tarea); }));
      const n = d.querySelector("[data-nueva-dia]");
      if (n) n.addEventListener("click", () => { d.close(); formTarea(null, { entrega: s }); });
      const sp = d.querySelector("[data-suspender]");
      if (sp) sp.addEventListener("click", () => {
        d.close();
        guardar(x => {
          const set = new Set(x.suspensiones || []);
          if (manual) set.delete(s); else set.add(s);
          x.suspensiones = [...set].sort();
        }, `${manual ? "Quitar" : "Marcar"} sin clases: ${s}`);
      });
    });
  }

  function formTarea(t, pre = {}) {
    const { materias } = estado.datos;
    if (!materias.length) { aviso("Primero agrega al menos una materia.", true); abrirMaterias(); return; }
    const v = t || { titulo: "", descripcion: "", materia: pre.materia || estado.materia || materias[0].nombre, entrega: pre.entrega || iso(sumarDias(new Date(), 1)) };
    dialogo(`
      <form method="dialog">
        <div class="dlg-head">${t ? "Editar tarea" : "Nueva tarea"}</div>
        <div class="dlg-body">
          <label class="field">Materia
            <select name="materia" required>${materias.map(m => `<option${m.nombre === v.materia ? " selected" : ""}>${esc(m.nombre)}</option>`).join("")}</select>
          </label>
          <label class="field">Tarea
            <input name="titulo" required maxlength="120" value="${esc(v.titulo)}" placeholder="Ej. Ejercicios página 45">
          </label>
          <label class="field">Fecha de entrega
            <input name="entrega" type="date" required value="${esc(v.entrega)}">
            <span class="help">La tarea deja de aparecer en pendientes el día de entrega.</span>
          </label>
          <label class="field">Descripción (opcional)
            <textarea name="descripcion" maxlength="1500" placeholder="Instrucciones, formato, etc.">${esc(v.descripcion)}</textarea>
          </label>
        </div>
        <div class="dlg-foot">
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primary">${t ? "Guardar cambios" : "Publicar"}</button>
        </div>
      </form>`, d => {
      d.querySelector("form").addEventListener("submit", async e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const datos = {
          titulo: f.get("titulo").trim(), materia: f.get("materia"),
          entrega: f.get("entrega"), descripcion: f.get("descripcion").trim()
        };
        if (!datos.titulo || !datos.entrega) return;
        d.close();
        if (t) {
          await guardar(x => { const y = x.tareas.find(z => z.id === t.id); if (y) Object.assign(y, datos); }, `Editar tarea: ${datos.titulo}`);
        } else {
          const nueva = Object.assign({ id: nuevoId(), creada: new Date().toISOString() }, datos);
          await guardar(x => { x.tareas.push(nueva); }, `Nueva tarea: ${datos.materia} – ${datos.titulo}`);
        }
      });
    });
  }

  function abrirMaterias() {
    const filas = estado.datos.materias.map(m => ({ ...m, original: m.nombre }));
    const fila = (m, i) => `<div class="mat-row" data-i="${i}">
        <input type="color" value="${esc(m.color)}" aria-label="Color">
        <input type="text" value="${esc(m.nombre)}" maxlength="40" aria-label="Nombre">
        <button type="button" class="btn btn-sm btn-danger" data-quitar="${i}">Quitar</button>
      </div>`;
    dialogo(`
      <div class="dlg-head">Materias</div>
      <div class="dlg-body"><div class="mats" style="display:flex;flex-direction:column;gap:8px"></div>
        <button type="button" class="btn btn-sm" data-agregar style="align-self:flex-start">+ Agregar materia</button>
        <span class="help">Si quitas una materia, sus tareas también se borran.</span>
      </div>
      <div class="dlg-foot"><button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primary" data-guardar>Guardar</button></div>`, d => {
      const cont = d.querySelector(".mats");
      const leer = () => cont.querySelectorAll(".mat-row").forEach(r => {
        const m = filas[+r.dataset.i];
        m.color = r.querySelector("[type=color]").value;
        m.nombre = r.querySelector("[type=text]").value.trim();
      });
      const pintar = () => {
        cont.innerHTML = filas.map((m, i) => m.quitada ? "" : fila(m, i)).join("");
        cont.querySelectorAll("[data-quitar]").forEach(b => b.addEventListener("click", () => { leer(); filas[+b.dataset.quitar].quitada = true; pintar(); }));
      };
      pintar();
      d.querySelector("[data-agregar]").addEventListener("click", () => {
        leer();
        filas.push({ nombre: "", color: COLORES[filas.length % COLORES.length], original: null });
        pintar();
        const ins = cont.querySelectorAll("[type=text]"); ins[ins.length - 1].focus();
      });
      d.querySelector("[data-guardar]").addEventListener("click", async () => {
        leer();
        const finales = filas.filter(m => !m.quitada && m.nombre);
        const nombres = finales.map(m => m.nombre.toLowerCase());
        if (new Set(nombres).size !== nombres.length) { aviso("Hay dos materias con el mismo nombre.", true); return; }
        d.close();
        await guardar(x => {
          const renombres = {};
          filas.forEach(m => { if (m.original && !m.quitada && m.nombre && m.nombre !== m.original) renombres[m.original] = m.nombre; });
          const quitadas = new Set(filas.filter(m => m.original && (m.quitada || !m.nombre)).map(m => m.original));
          x.tareas = x.tareas.filter(t => !quitadas.has(t.materia)).map(t => renombres[t.materia] ? { ...t, materia: renombres[t.materia] } : t);
          x.materias = finales.map(m => ({ nombre: m.nombre, color: m.color }));
        }, "Actualizar materias");
        if (estado.materia && !estado.datos.materias.some(m => m.nombre === estado.materia)) { estado.materia = null; render(); }
      });
    });
  }

  function abrirConexion(motivo) {
    const token = leerLS(LS_TOKEN);
    const enlaceToken = CONECTADO
      ? `https://github.com/settings/personal-access-tokens/new`
      : "https://github.com/settings/personal-access-tokens/new";
    dialogo(`
      <form method="dialog">
        <div class="dlg-head">Conexión con GitHub</div>
        <div class="dlg-body">
          ${motivo ? `<div class="notice warn" style="margin:0">${esc(motivo)}</div>` : ""}
          <div class="detail-meta">${CONECTADO ? `Repositorio: <strong>${esc(CFG.usuario)}/${esc(CFG.repositorio)}</strong>` : "Modo de prueba local (la página aún no está en GitHub Pages)."}</div>
          <div style="font-size:14px">Para publicar tareas, cada editor necesita una llave (token) de GitHub con permiso de escritura en el repositorio.
            Créala en <a href="${enlaceToken}" target="_blank" rel="noopener">GitHub → Fine-grained token</a>, elige solo este repositorio y dale
            <strong>Contents: Read and write</strong>.</div>
          <label class="field">Llave de GitHub
            <input name="token" type="password" autocomplete="off" placeholder="github_pat_…" value="">
            <span class="help">${token ? "Ya hay una llave guardada en este navegador. Escribe otra para reemplazarla." : "Se guarda solo en este navegador."}</span>
          </label>
        </div>
        <div class="dlg-foot">
          ${token ? '<button type="button" class="btn btn-danger" data-olvidar>Quitar llave</button><span class="spacer"></span>' : ""}
          <button type="button" class="btn" data-cerrar>Cerrar</button>
          <button type="submit" class="btn btn-primary">Guardar llave</button>
        </div>
      </form>`, d => {
      const o = d.querySelector("[data-olvidar]");
      if (o) o.addEventListener("click", () => { escribirLS(LS_TOKEN, null); d.close(); render(); aviso("Llave quitada de este navegador."); });
      d.querySelector("form").addEventListener("submit", async e => {
        e.preventDefault();
        const v = new FormData(e.target).get("token").trim();
        if (!v) return;
        escribirLS(LS_TOKEN, v);
        d.close(); render();
        if (CONECTADO) {
          try {
            const r = await fetch(`https://api.github.com/repos/${CFG.usuario}/${CFG.repositorio}`, { headers: { Authorization: `Bearer ${v}`, Accept: "application/vnd.github+json" } });
            const j = r.ok ? await r.json() : null;
            if (j && j.permissions && j.permissions.push) aviso("Llave conectada. Ya puedes publicar.");
            else aviso("La llave se guardó, pero no parece tener permiso de escritura en este repositorio.", true, 6000);
          } catch { aviso("Llave guardada."); }
        } else aviso("Llave guardada.");
      });
    });
  }

  // ---------- sorpresa del título (easter egg) ----------
  const SORPRESA_BASE = { emoji: "🎉", titulo: "¡Lo lograste!", mensaje: "Gracias por usar la app del grupo.", color: "#4f46e5" };
  function sorpresaActual() {
    const s = { ...SORPRESA_BASE, ...(estado.datos.sorpresa || {}) };
    if (!/^#[0-9a-f]{6}$/i.test(s.color)) s.color = SORPRESA_BASE.color;
    return s;
  }

  function mostrarSorpresa() {
    const s = sorpresaActual();
    dialogo(`
      <div class="dlg-body sorpresa" style="--c:${s.color}">
        <div class="sorpresa-emoji">${esc(s.emoji)}</div>
        <div class="sorpresa-titulo">${esc(s.titulo)}</div>
        <div class="sorpresa-msg">${esc(s.mensaje)}</div>
      </div>
      <div class="dlg-foot"><span class="spacer"></span><button class="btn btn-primary" data-cerrar>Cerrar</button></div>`);
  }

  // Solo en el editor: personalizar lo que se ve al tocar el título cuatro veces.
  function editarSorpresa() {
    const s = sorpresaActual();
    dialogo(`
      <form method="dialog">
        <div class="dlg-head">Sorpresa del título</div>
        <div class="dlg-body">
          <div class="detail-meta">Se abre cuando alguien toca cuatro veces el título de la app. Al publicar, todos la verán.</div>
          <label class="field">Emoji
            <input name="emoji" maxlength="4" value="${esc(s.emoji)}">
          </label>
          <label class="field">Título
            <input name="titulo" maxlength="60" value="${esc(s.titulo)}">
          </label>
          <label class="field">Mensaje
            <textarea name="mensaje" maxlength="300">${esc(s.mensaje)}</textarea>
          </label>
          <label class="field">Color
            <input name="color" type="color" value="${esc(s.color)}">
          </label>
        </div>
        <div class="dlg-foot">
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-primary">Publicar</button>
        </div>
      </form>`, d => {
      d.querySelector("form").addEventListener("submit", e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const nueva = {
          emoji: String(f.get("emoji") || "").trim().slice(0, 4) || SORPRESA_BASE.emoji,
          titulo: String(f.get("titulo") || "").trim().slice(0, 60) || SORPRESA_BASE.titulo,
          mensaje: String(f.get("mensaje") || "").trim().slice(0, 300),
          color: String(f.get("color") || SORPRESA_BASE.color)
        };
        d.close();
        guardar(datos => { datos.sorpresa = nueva; }, "Edita la sorpresa del título");
      });
    });
  }

  // Cuatro toques en menos de dos segundos sobre el título abren la sorpresa.
  let toquesTitulo = [];
  app.addEventListener("click", e => {
    if (!e.target.closest(".titulo-app")) return;
    const ahora = Date.now();
    toquesTitulo = toquesTitulo.filter(t => ahora - t < 2000).concat(ahora);
    if (toquesTitulo.length >= 4) { toquesTitulo = []; mostrarSorpresa(); }
  });

  // ---------- eventos ----------
  app.addEventListener("click", e => {
    const el = e.target.closest("button, .cal-day");
    if (!el) return;
    const ds = el.dataset;
    if (ds.tab) { estado.tab = ds.tab; escribirLS(LS_TAB, ds.tab); if (ds.tab !== "materias") estado.materia = null; animarVista = true; render(); return; }
    if (ds.tarea) { e.stopPropagation(); verTarea(ds.tarea); return; }
    if (ds.semana !== undefined) { estado.semana = ds.semana === "0" ? 0 : estado.semana + Number(ds.semana); animarVista = true; render(); return; }
    if (ds.mes !== undefined) { estado.mes = ds.mes === "0" ? 0 : estado.mes + Number(ds.mes); animarVista = true; render(); return; }
    if (ds.abrirMateria) { estado.materia = ds.abrirMateria; animarVista = true; render(); window.scrollTo(0, 0); return; }
    if ("volver" in ds) { estado.materia = null; animarVista = true; render(); return; }
    if (ds.dia) { verDia(ds.dia); return; }
    switch (ds.accion) {
      case "nueva": formTarea(null, { materia: ds.materia }); break;
      case "materias": abrirMaterias(); break;
      case "conexion": abrirConexion(); break;
      case "sorpresa": editarSorpresa(); break;
      case "push": abrirPush(); break;
      case "recargar": cargar(); break;
      case "blur":
        BLUR_ON = !BLUR_ON;
        escribirLS(LS_BLUR, BLUR_ON ? "1" : "0");
        document.documentElement.classList.toggle("no-blur", !BLUR_ON);
        blurPop = true; render(); blurPop = false;
        break;
    }
  });

  // Deslizar o flechas cambian de semana (Semana) o de mes (Calendario).
  function navegar(dir) {
    if (estado.tab === "semana") estado.semana += dir;
    else if (estado.tab === "calendario") estado.mes += dir;
    else return;
    if (navigator.vibrate) navigator.vibrate(6);
    animarVista = true; render();
  }
  let gesto = null;
  app.addEventListener("pointerdown", e => { gesto = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  app.addEventListener("pointerup", e => {
    if (!gesto) return;
    const dx = e.clientX - gesto.x, dy = e.clientY - gesto.y, dt = Date.now() - gesto.t;
    gesto = null;
    // Solo gestos claramente horizontales y rápidos, para no estorbar el scroll vertical.
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) navegar(dx < 0 ? 1 : -1);
  });
  app.addEventListener("pointercancel", () => { gesto = null; });
  document.addEventListener("keydown", e => {
    if (document.querySelector("dialog[open]") || e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft") navegar(-1);
    else if (e.key === "ArrowRight") navegar(1);
  });

  // Al cambiar de día (o al volver a la pestaña) se actualiza lo pendiente.
  let ultimoDia = hoy();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (hoy() !== ultimoDia) { ultimoDia = hoy(); render(); }
      if (!EDITOR) cargar();
    }
  });
  setInterval(() => { if (hoy() !== ultimoDia) { ultimoDia = hoy(); render(); } }, 60 * 1000);

  cargar();
  iniciarPush();
})();
