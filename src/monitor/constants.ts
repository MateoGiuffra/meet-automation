// Frases de despedida frecuentes en chat de clase (español rioplatense). Solo
// dispara el chequeo del juez LLM — el juez es quien decide si es despedida
// individual (ignorar) o colectiva/fin de clase (salir).
export const FAREWELL_KEYWORDS: RegExp[] = [
  /buen\s+fin\s*de?\s*semana/i,
  /nos\s+vemos/i,
  /nos\s+vimos/i,
  /gracias\s+profe/i,
  /me\s+tengo\s+que\s+ir/i,
  /me\s+tengo\s+que\s+ir\s+yendo/i,
  /me\s+bajo/i,
  /me\s+voy\s+yendo/i,
  /\bchau\b/i,
  /\bchauchau\b/i,
  /adi[oó]s/i,
  /hasta\s+la\s+pr[oó]xima/i,
  /hasta\s+luego/i,
  /hasta\s+ma[ñn]ana/i,
  /nos\s+estamos\s+viendo/i,
  /que\s+tengan?\s+buen\s+d[ií]a/i,
  /buenas\s+noches\s+a\s+todos/i,
  /muchas\s+gracias\s+profe/i,
];
