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
      tareas: Array.isArray(d.tareas) ? d.tareas.filter(t => t && t.id && t.entrega) : []
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

  // Manda una notificación a todos los suscritos al canal de ntfy.
  async function notificar(t) {
    if (!CFG.avisos || !CONECTADO) return;
    const enlace = `https://${location.host}${location.pathname.replace(/editor\.html$/, "")}`;
    try {
      await fetch("https://ntfy.sh/", {
        method: "POST",
        body: JSON.stringify({
          topic: CFG.avisos,
          title: `Nueva tarea de ${t.materia}`,
          message: `${t.titulo}\nEntrega: ${fechaLarga(t.entrega)}`,
          tags: ["books"],
          click: enlace
        })
      });
    } catch { /* si falla el aviso, la tarea ya quedó publicada */ }
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
            <h1>${esc(CFG.nombreGrupo)}${EDITOR ? '<span class="badge">Editor</span>' : ""}</h1>
            <div class="subtitle">Hoy es ${fechaLarga(h).toLowerCase()} de ${deIso(h).getFullYear()}</div>
          </div>
          ${EDITOR ? `<div class="actions">
            <button class="btn btn-light" data-accion="nueva">+ Nueva tarea</button>
            <button class="btn btn-ghost-light" data-accion="materias">Materias</button>
            <button class="btn btn-ghost-light" data-accion="conexion">Conexión</button>
            ${botonAvisos()}
            ${botonBlur()}
          </div>` : `<div class="actions"><button class="btn btn-ghost-light" data-accion="recargar">Actualizar</button>${botonAvisos()}${botonBlur()}</div>`}
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

  function botonAvisos() {
    return CFG.avisos ? `<button class="btn btn-ghost-light" data-accion="avisos">🔔 Avisos</button>` : "";
  }

  function abrirAvisos() {
    const canal = CFG.avisos;
    dialogo(`
      <div class="dlg-head">🔔 Recibir avisos de tareas nuevas</div>
      <div class="dlg-body">
        <div style="font-size:14px">Cada vez que se publique una tarea nueva te llega una notificación al celular.</div>
        <ol class="pasos">
          <li>Instala la app gratis <strong>ntfy</strong>:
            <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> ·
            <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a></li>
          <li>Ábrela y toca <strong>+</strong> (Subscribe to topic).</li>
          <li>Escribe este canal y dale <strong>Subscribe</strong>:</li>
        </ol>
        <div class="topic"><code>${esc(canal)}</code><button type="button" class="btn btn-sm" data-copiar>Copiar</button></div>
        <div class="help">En computadora puedes abrir <a href="https://ntfy.sh/${encodeURIComponent(canal)}" target="_blank" rel="noopener">ntfy.sh/${esc(canal)}</a> y activar las notificaciones del navegador.</div>
      </div>
      <div class="dlg-foot"><button class="btn btn-primary" data-cerrar>Listo</button></div>`, d => {
      d.querySelector("[data-copiar]").addEventListener("click", async e => {
        try { await navigator.clipboard.writeText(canal); e.target.textContent = "¡Copiado!"; }
        catch { e.target.textContent = "Cópialo a mano"; }
      });
    });
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
          return `<div class="cal-day${cls}" data-dia="${s}" style="--d:${DIA_COLORES[diaSemana(d)]}">
            <div class="cal-num">${d.getDate()}</div>
            ${lista.map(t => `<button class="chip${pendiente(t) ? "" : " done"}" style="--c:${esc(colorDe(t.materia))}" data-tarea="${esc(t.id)}" title="${esc(t.materia)}: ${esc(t.titulo)}">${esc(t.titulo)}</button>`).join("")}
          </div>`;
        }).join("")}
      </div>`;
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
    dialogo(`
      <div class="dlg-head" style="--c:${DIA_COLORES[diaSemana(deIso(s))]}">${fechaLarga(s)}</div>
      <div class="dlg-body">${lista.length ? lista.map(t => tarjeta(t, { desc: true })).join("") : '<div class="empty">No hay entregas este día.</div>'}</div>
      <div class="dlg-foot">
        ${EDITOR ? `<button class="btn" data-nueva-dia>+ Tarea para este día</button>` : ""}
        <button class="btn btn-primary" data-cerrar>Cerrar</button>
      </div>`, d => {
      d.querySelectorAll("[data-tarea]").forEach(b => b.addEventListener("click", () => { d.close(); verTarea(b.dataset.tarea); }));
      const n = d.querySelector("[data-nueva-dia]");
      if (n) n.addEventListener("click", () => { d.close(); formTarea(null, { entrega: s }); });
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
          const ok = await guardar(x => { x.tareas.push(nueva); }, `Nueva tarea: ${datos.materia} – ${datos.titulo}`);
          if (ok) notificar(nueva);
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
      case "avisos": abrirAvisos(); break;
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
})();
