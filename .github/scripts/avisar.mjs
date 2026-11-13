// Compara tareas.json antes y después del push y avisa de las tareas nuevas.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { ONESIGNAL_API_KEY, ANTES, AHORA, SITIO } = process.env;

const appId = (readFileSync("config.js", "utf8").match(/onesignalAppId:\s*"([^"]*)"/) || [])[1];
if (!appId) { console.log("Sin onesignalAppId en config.js; no se mandan avisos."); process.exit(0); }
if (!ONESIGNAL_API_KEY) { console.log("Falta el secreto ONESIGNAL_API_KEY; no se mandan avisos."); process.exit(0); }

const leer = ref => {
  try { return JSON.parse(execSync(`git show ${ref}:tareas.json`, { encoding: "utf8" })).tareas || []; }
  catch { return []; }
};
const sinCommitPrevio = !ANTES || /^0+$/.test(ANTES);
const antes = new Set(sinCommitPrevio ? [] : leer(ANTES).map(t => t.id));
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const nuevas = leer(AHORA).filter(t => !antes.has(t.id) && t.entrega > hoy);

if (!nuevas.length) { console.log("No hay tareas nuevas."); process.exit(0); }

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fecha = s => { const [y, m, d] = s.split("-").map(Number); const f = new Date(y, m - 1, d); return `${DIAS[f.getDay()]} ${d} de ${MESES[m - 1]}`; };

const titulo = nuevas.length === 1 ? `Nueva tarea de ${nuevas[0].materia}` : `${nuevas.length} tareas nuevas`;
const texto = nuevas.length === 1
  ? `${nuevas[0].titulo} · Entrega: ${fecha(nuevas[0].entrega)}`
  : nuevas.map(t => `${t.materia}: ${t.titulo}`).join("\n");

const r = await fetch("https://api.onesignal.com/notifications?c=push", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Key ${ONESIGNAL_API_KEY}` },
  body: JSON.stringify({
    app_id: appId,
    target_channel: "push",
    included_segments: ["Total Subscriptions"],
    headings: { en: titulo, es: titulo },
    contents: { en: texto, es: texto },
    url: SITIO
  })
});
const cuerpo = await r.text();
console.log(r.status, cuerpo);
if (!r.ok) process.exit(1);
