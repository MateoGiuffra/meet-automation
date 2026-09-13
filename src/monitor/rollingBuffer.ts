/** Buffer simple de eventos con timestamp, que descarta lo más viejo que `windowMs`. */
export class RollingBuffer<T extends { timestamp: number }> {
  private items: T[] = [];

  constructor(private readonly windowMs: number) {}

  push(item: T): void {
    this.items.push(item);
    this.prune();
  }

  /** Todos los items dentro de la ventana, más viejo primero. */
  all(): T[] {
    this.prune();
    return this.items;
  }

  latest(): T | undefined {
    this.prune();
    return this.items[this.items.length - 1];
  }

  oldest(): T | undefined {
    this.prune();
    return this.items[0];
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.items.length > 0 && this.items[0].timestamp < cutoff) {
      this.items.shift();
    }
  }
}
