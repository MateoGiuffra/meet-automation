// Frases de despedida frecuentes en chat de clase (ES/EN). Solo dispara
// el chequeo del juez LLM — el juez es quien decide si es despedida
// individual (ignorar) o colectiva/fin de clase (salir).
export const FAREWELL_KEYWORDS: RegExp[] = [
  /buen\s+fin\s*de?\s*semana/i,
  /nos\s+vemos/i,
  /gracias\s+profe/i,
  /me\s+tengo\s+que\s+ir/i,
  /me\s+bajo/i,
  /\bchau\b/i,
  /adi[oó]s/i,
  /hasta\s+la\s+pr[oó]xima/i,
  /hasta\s+luego/i,
  /\bbye\b/i,
  /see\s+you/i,
  /have\s+a\s+good\s+weekend/i,
  /thanks?\s+(professor|teacher)/i,
];
