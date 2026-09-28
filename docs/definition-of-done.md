# Definition of Done — Proyecto NIDO

Una historia de usuario solo se mueve a **"Done"** en el tablero si cumple **TODAS** las reglas siguientes.

1. **Cumple todos sus criterios de aceptación** (Dado/Cuando/Entonces), probados también en modo sin conexión (DevTools → Network → Offline).
   - *Cómo se verifica:* el autor lo prueba y lo anota en la descripción del PR.

2. **Entró a `develop` por Pull Request revisado y aprobado** por al menos otro integrante. Nadie hace push directo a `develop` ni a `main`.
   - *Cómo se verifica:* el PR tiene un approve de alguien distinto al autor.

3. **Está desplegado y funcionando** en la URL pública del proyecto.
   - *Cómo se verifica:* link a la URL en el PR o en el issue.

4. **El issue se cierra desde el PR** con "Closes #N", la tarjeta queda en "Done" del tablero y la consola del navegador no muestra errores.
   - *Cómo se verifica:* issue cerrado automáticamente y tarjeta en Done.
