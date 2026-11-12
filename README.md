# Tareas del grupo

App web para las tareas del grupo, publicada con GitHub Pages.

- **Vista de consulta** (para todos): `https://USUARIO.github.io/REPOSITORIO/`
- **Editor** (para quienes publican): `https://USUARIO.github.io/REPOSITORIO/editor.html`

Pestañas: **Semana** (lunes a viernes con lo pendiente de cada día), **Materias** (tareas de una sola materia) y **Calendario** (mes completo).
Las tareas dejan de contar como pendientes el día de entrega.

## Cómo publicarla

1. En github.com crea un repositorio **público** (por ejemplo `tareas-grupo`).
2. En el repositorio: **Add file → Upload files**, arrastra todos los archivos de esta carpeta y da **Commit changes**.
3. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama **main**, carpeta **/ (root)** y guarda.
4. En 1–2 minutos la página estará en `https://USUARIO.github.io/tareas-grupo/`.

## Cómo dar permiso a los editores

Las tareas se guardan en `tareas.json` dentro del repositorio. Para publicar, el editor necesita una llave de GitHub:

1. Cada editor necesita cuenta de GitHub. El dueño los agrega en **Settings → Collaborators**.
2. Cada editor crea su llave en GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**:
   - *Repository access*: **Only select repositories** → este repositorio.
   - *Permissions → Repository permissions → Contents*: **Read and write**.
3. En `editor.html`, botón **Conexión**, pega la llave. Se guarda solo en ese navegador.

Nunca compartas la llave en el grupo ni la pegues en la vista de consulta. Quien no tiene llave puede abrir `editor.html` pero no puede publicar.

## Notas

- El nombre que aparece arriba se cambia en `config.js` (`nombreGrupo`).
- Los cambios se ven al instante para quien recarga la página. Si hay mucha gente en la misma red, a veces tarda ~1 minuto.
