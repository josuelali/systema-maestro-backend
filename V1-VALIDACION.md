# Sistema Maestro IA WEB V1 — entorno aislado

Base: backend 91477e9665ab33153320aace51c8533fb6493a87; frontend acdbaf5df3b750680fae2f91a7d57195f49ca212.
Rama local en ambos: feature/smia-web-v1. No push ni deploy autorizado a producción.

## Ejecutar y verificar

1. `npm ci` y `npm test` desde backend.
2. Configurar variables del proceso siguiendo `.env.example`, sin versionar secretos.
3. `npm start`; panel local: http://127.0.0.1:18370.
4. Frontend y backend comparten origen. El servidor sirve únicamente panel.html, panel.js, panel.css y favicon; redirige las rutas antiguas al panel.

Sin DATABASE_URL se usa PostgreSQL embebido PGlite en `.local-data` (solo desarrollo). En producción DATABASE_URL es obligatoria. Para preview remoto se necesita base separada y origen HTTPS; no apuntar a datos ni servicios de producción. La configuración Vercel de esta rama no redirige peticiones al backend de producción.

Las pruebas automatizadas utilizan una base PostgreSQL embebida temporal y proveedores simulados. Verifican cuotas, aislamiento, contexto, autenticación y ciclo de suscripción; NO acreditan un pago real en Stripe.

## Costes y límites

Modelo: gpt-4.1-mini-2025-04-14. Máximo 1200 tokens de salida y 16000 bytes de mensajes. Tarifa de referencia: 0,40 USD/M entrada y 1,60 USD/M salida. Se almacenan modelo, tokens y coste estimado de cada resultado.
Gratis: 3 generaciones totales. Pro: 100 por periodo pagado. Una petición en curso por usuario; 30 intentos/hora. Los fallos no consumen cuota comercial.
El servidor de preview reserva 0,01 USD por intento en su base local, con máximo global 0,09 USD, incluyendo fallos de consumo incierto. No borrar esa base para reiniciar el presupuesto. La reserva es conservadora y deja margen para las dos pruebas iniciales externas a esta base.

## Stripe pendiente de integración real

Solo se aceptan claves y eventos Test. Necesita STRIPE_SECRET_KEY (preferiblemente restringida), STRIPE_PRICE_ID (19,99 EUR mensual Test) y STRIPE_WEBHOOK_SECRET. Checkout, clientes, suscripciones, precios y portal necesitan permisos adecuados. Nunca introducir una clave Live.
Webhook: /api/billing/webhook. Eventos: checkout.session.completed, checkout.session.async_payment_succeeded, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed. Verifica firma sobre cuerpo crudo; procesa idempotentemente y consulta el estado actual de Stripe antes de actualizar acceso.
El portal requiere configuración de cancelación en el sandbox. Cancelación al final del periodo mantiene acceso hasta su fin; impago, baja o expiración retiran nuevas generaciones Pro. Historial se conserva. El retorno de Checkout no concede Pro por sí solo.
Los impuestos no se han cambiado ni activado: confirmar el tratamiento del precio final de 19,99 EUR antes de cualquier paso a Live.

## Pendiente antes de producción

- Completar checkout y eventos contra Stripe Test, incluyendo renovación/cancelación.
- PostgreSQL remoto aislado, TLS, backups, migración y prueba con conexiones concurrentes reales.
- Recuperación/verificación de email y política de alta para prevenir abuso de pruebas gratuitas; el preview incluye registro/login/logout, no recuperación por correo.
- Adaptar textos de privacidad y condiciones al almacenamiento por usuario antes de abrir altas públicas.
- Revisar calidad de los ocho asistentes con casos representativos: las tres pruebas reales realizadas han usado oferta. No se garantiza ausencia de alucinaciones; cada salida requiere revisión.
- Autorizar por separado despliegue, configuración Live y comercialización. Este preview no está listo para producción.
