# Estrategia de lanzamiento y comunidad — 23 sep 2026

## Objetivo y estado

Publicar GhostAPI como herramienta open source para desarrolladores de agentes, conseguir usuarios que prueben operaciones derivadas en aplicaciones reales y construir una identidad técnica `jaf333` separada de la cuenta personal de X del mantenedor. Medir instalaciones reproducidas, informes de descubrimiento y contribuciones útiles; seguidores y estrellas son señales secundarias.

`jaf333/ghostapi` existe en GitHub y sigue privado. Tiene licencia MIT, Issues, Discussions, documentación, plantillas, vídeo y borradores de lanzamiento. Hay 15 gates documentados como completados; G16 sigue abierto. El paquete `ghostapi` no existía en npm el 23 sep 2026, pero el nombre no está reservado. Ya existe [otro proyecto público llamado GhostAPI](https://github.com/yiaany/ghostapi) con una función distinta. Antes de fijar marca, revisar nombre, dominio y handle; no dar ninguno por disponible.

## Mensaje demostrable

Hoy el repositorio prueba que GhostAPI observa acciones y tráfico en su aplicación de referencia, deriva operaciones tipadas, muestra su evidencia, las reproduce por HTTP y las exporta como MCP, Agent Skill y cliente TypeScript. El anuncio amplio requiere G16: una operación útil reproducida en una aplicación ajena y un registro de lo que falló. Seguir [el procedimiento de G16](real-target-validation.md).

Evitar “cualquier web”, “un agente tarda 40 segundos” y “ahorra tokens” como resultados generales. El benchmark actual compara un replay programado en navegador con una llamada API, dentro de la aplicación local de referencia; ninguno usa un LLM. Si se publica una cifra, repetir la medición y mostrar entorno, muestra y alcance.

## Identidad en X

Crear una **cuenta técnica del mantenedor**, idealmente `@jaf333` si X lo permite. Nombre visible sugerido: “Jesús Antolín · jaf333”. Biografía: “Building open source tools for AI agents and developer workflows. Creator of GhostAPI. Code and experiments: github.com/jaf333”. Usar el mismo avatar o una identidad visual coherente con GitHub, y enlazar ambos perfiles. GhostAPI será el primer proyecto destacado y podrá tener su propia cuenta más adelante si aparece una comunidad que la necesite. Escribir en inglés para el público técnico internacional. Esta cuenta evita usar su X personal, pero no promete anonimato.

La [política de autenticidad de X](https://help.x.com/en/rules-and-policies/authenticity) permite cuentas para proyectos con fines distintos y prohíbe identidades engañosas, amplificación artificial y respuestas masivas no solicitadas. Participar manualmente con demos, comandos, pruebas, fallos y correcciones; no comprar seguidores ni automatizar respuestas.

En X, las conversaciones técnicas sobre [CLI para agentes y navegador](https://x.com/blackanger/status/2010613981640270247) y [coste y latencia de herramientas de navegador](https://x.com/ctatedev/status/2041928222766399805) muestran que el ángulo interesa. Son ejemplos de conversación, no pruebas de que GhostAPI funcione en sitios externos ni garantía de alcance. El contenido propio debe enseñar una operación derivada, su evidencia y sus límites.

## Plan

### Antes de abrir el repositorio

1. Completar G16 con tres aplicaciones permitidas, incluida una SPA sin API documentada; verificar al menos un replay HTTP y explicar un fallo. Redactar las fixtures para no publicar sesiones ni datos privados.
2. Resolver la colisión de nombre; comprobar handle, dominio y nombres npm. Si se conserva GhostAPI, usar siempre un subtítulo diferenciador.
3. Reservar npm y `@ghostapi`, verificar autenticación, publicar los nueve paquetes desde el mismo SHA y probar `npx ghostapi doctor` en un entorno limpio. El `npx` del README aún no es utilizable desde npm.
4. Repetir `pnpm verify`, benchmark y captura de CLI; revisar vídeo y posts si cambia una cifra. Revisar historial y contenido que se hará público, además del gate de redacción.
5. Preparar preview social, crear la cuenta de X y abrir el repositorio cuando el paquete y la prueba externa sean utilizables.

Coordinar validación, integración y publicación desde builder-1 conforme a la operación común. GitHub Actions está retirado. Registrar SHA, comandos y resultado. El [guion de lanzamiento](launch-day.md) se reconcilia con el estado real del día.

### Primera audiencia y anuncio

Durante una o dos semanas, publicar desde `jaf333` un clip del flujo, una explicación de correlación, otra de redacción y una prueba fallida de G16. Responder manualmente a conversaciones pertinentes sobre browser agents, CDP, MCP y herramientas para agentes con aportaciones útiles. Contactar a 5–10 desarrolladores que construyan agentes o automatizaciones internas y ofrecer una prueba breve en una aplicación que controlen; pedir operación esperada, salida observada y bloqueo.

Anunciar con un vídeo, enlace directo al repo, comando reproducible, evidencia externa, límites y petición de informes de descubrimiento. Actualizar [el borrador de X](x-post.md) con el SHA y la medición del día. Adaptar Show HN y Reddit a cada comunidad y atender respuestas; no pedir votos.

### Primeros 30 días

Publicar dos notas técnicas semanales: un caso reproducible y una lección de fallo o mejora. Hacer triage semanal de informes `discovery_report`, publicar correcciones y cambios pequeños. Medir aplicaciones ajenas probadas, operaciones reproducidas, informes útiles, issues resueltos y contribuyentes externos. A día 30, ajustar README, onboarding y foco de producto según uso repetido y fallos observados.

## Apoyos y créditos

[GitHub Sponsors](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/about-github-sponsors-for-open-source-contributors) permite solicitar patrocinio a colaboradores en regiones admitidas. El [programa OSS de Vercel](https://vercel.com/open-source-program) ofrece créditos y comunidad a proyectos activos con impacto o potencial y uso de Vercel; solo encaja si GhostAPI aloja allí una parte real. [Project Alexandria de Cloudflare](https://www.cloudflare.com/lp/project-alexandria/) acepta solicitudes de apoyo OSS según sus condiciones. Ningún beneficio está concedido. Preparar solicitudes cuando haya repo público, demo verificable y primeros usuarios; comprobar convocatorias vigentes ese día.

## Decisiones del mantenedor

- Confirmar el identificador `@jaf333` en el registro de X; la búsqueda pública no acredita disponibilidad.
- Elegir nombre definitivo tras revisar colisión y handle.
- Elegir las aplicaciones propias o autorizadas para G16 y operar sus sesiones.
- Autenticarse en npm y X. La preparación local no acredita control de esas cuentas.
