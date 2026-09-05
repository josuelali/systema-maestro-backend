type AssistantField = {
  name: string;
  label: string;
};

type Assistant = {
  id: string;
  name: string;
  system: string;
  fields: AssistantField[];
  template: string;
};

export const assistants: Assistant[] = [
  {
    id: "oferta",
    name: "Creador de Oferta Irresistible",
    system: "Eres un estratega de monetización y copywriter experto en crear ofertas irresistibles.",
    fields: [
      { name: "producto", label: "Producto o servicio" },
      { name: "cliente_ideal", label: "Cliente ideal" },
      { name: "precio", label: "Precio aproximado" }
    ],
    template: `
Crea una oferta irresistible para este producto o servicio.

Producto o servicio:
{producto}

Cliente ideal:
{cliente_ideal}

Precio aproximado:
{precio}

Devuelve:
1. Nombre de la oferta
2. Promesa principal
3. Dolor que resuelve
4. Beneficios concretos
5. Bonus o incentivo
6. Garantía o reducción de riesgo
7. CTA final
8. Siguiente paso recomendado
    `
  },
  {
    id: "landing",
    name: "Landing que Convierte",
    system: "Eres un experto en copywriting, conversión y estructura de landing pages.",
    fields: [
      { name: "producto", label: "Producto o servicio" },
      { name: "audiencia", label: "Audiencia" },
      { name: "objetivo", label: "Objetivo" }
    ],
    template: `
Crea el copy completo de una landing page.

Producto o servicio:
{producto}

Audiencia:
{audiencia}

Objetivo:
{objetivo}

Devuelve:
1. H1 potente
2. Subtítulo
3. Problema principal
4. Propuesta de valor
5. Beneficios
6. Sección "cómo funciona"
7. Prueba social sugerida
8. CTA principal
9. FAQ
    `
  },
  {
    id: "anuncios",
    name: "Anuncios Meta/TikTok",
    system: "Eres un media buyer y copywriter experto en anuncios para Meta Ads y TikTok Ads.",
    fields: [
      { name: "producto", label: "Producto o servicio" },
      { name: "beneficio", label: "Beneficio principal" },
      { name: "plataforma", label: "Plataforma" }
    ],
    template: `
Crea anuncios para {plataforma}.

Producto o servicio:
{producto}

Beneficio principal:
{beneficio}

Devuelve:
1. 5 hooks
2. 5 textos cortos de anuncio
3. 3 ángulos creativos
4. 3 CTAs
5. Ideas visuales para vídeo corto
    `
  },
  {
    id: "emails",
    name: "Secuencia de Emails de Venta",
    system: "Eres un especialista en email marketing y ventas.",
    fields: [
      { name: "producto", label: "Producto o servicio" },
      { name: "audiencia", label: "Audiencia" },
      { name: "objetivo", label: "Objetivo" }
    ],
    template: `
Crea una secuencia de emails de venta.

Producto o servicio:
{producto}

Audiencia:
{audiencia}

Objetivo:
{objetivo}

Devuelve una secuencia de 5 emails:
- asunto
- objetivo del email
- cuerpo del email
- CTA
    `
  },
  {
    id: "dm",
    name: "DM/WhatsApp Cierre Natural",
    system: "Eres un closer experto en ventas por DM y WhatsApp sin presión agresiva.",
    fields: [
      { name: "producto", label: "Producto o servicio" },
      { name: "objecion", label: "Objeción" },
      { name: "tono", label: "Tono" }
    ],
    template: `
Crea una respuesta de cierre natural para WhatsApp o DM.

Producto o servicio:
{producto}

Objeción del cliente:
{objecion}

Tono:
{tono}

Devuelve:
1. Respuesta empática
2. Reformulación del valor
3. Pregunta de avance
4. Cierre suave
5. 3 variantes alternativas
    `
  },
  {
    id: "seo",
    name: "SEO: Cluster + Briefs",
    system: "Eres un consultor SEO experto en arquitectura de contenidos y monetización.",
    fields: [
      { name: "tema", label: "Tema" },
      { name: "objetivo", label: "Objetivo SEO" },
      { name: "pais", label: "País" }
    ],
    template: `
Crea un cluster SEO para este proyecto.

Tema:
{tema}

Objetivo SEO:
{objetivo}

País o mercado:
{pais}

Devuelve:
1. Cluster principal
2. 10 keywords
3. 5 títulos SEO
4. Brief para el artículo principal
5. FAQs
6. Enlaces internos sugeridos
7. Monetización posible
    `
  },
  {
    id: "automatizacion",
    name: "Automatización Make/Zapier",
    system: "Eres un arquitecto de automatizaciones con Make, Zapier y herramientas IA.",
    fields: [
      { name: "proceso", label: "Proceso" },
      { name: "herramientas", label: "Herramientas" },
      { name: "salida", label: "Salida esperada" }
    ],
    template: `
Diseña una automatización simple.

Proceso a automatizar:
{proceso}

Herramientas disponibles:
{herramientas}

Resultado esperado:
{salida}

Devuelve:
1. Entrada del flujo
2. Pasos de automatización
3. Herramienta recomendada
4. Prompt IA si aplica
5. Salida final
6. Errores a evitar
7. Versión mínima para empezar hoy
    `
  },
  {
    id: "validacion",
    name: "Validador de Idea Monetizable",
    system: "Eres un analista de negocio experto en validar ideas digitales monetizables.",
    fields: [
      { name: "idea", label: "Idea" },
      { name: "mercado", label: "Mercado" },
      { name: "monetizacion", label: "Monetización" }
    ],
    template: `
Valida esta idea de negocio digital.

Idea:
{idea}

Mercado:
{mercado}

Monetización prevista:
{monetizacion}

Devuelve:
1. Veredicto de viabilidad del 1 al 10
2. Por qué puede funcionar
3. Riesgos principales
4. Cliente ideal
5. Oferta mínima viable
6. Primera prueba para validar
7. Siguiente paso exacto
    `
  }
];

export function fillTemplate(template: string, inputs: Record<string, string>) {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = inputs?.[key];
    return value && String(value).trim() ? String(value).trim() : "No especificado";
  });
}


