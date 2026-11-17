const LIMIT = 12;

export class CanvasLayerCache {
  private readonly layers = new Map<string, HTMLCanvasElement>();

  draw(
    ctx: CanvasRenderingContext2D,
    key: string,
    width: number,
    height: number,
    render: (ctx: CanvasRenderingContext2D) => void,
  ): boolean {
    if (typeof document === 'undefined') return false;
    const transform = ctx.getTransform();
    const density = Math.min(2, Math.max(1, Math.hypot(transform.a, transform.b)));
    key = `${key}@${density.toFixed(3)}`;
    let layer = this.layers.get(key);
    if (layer) {
      this.layers.delete(key);
      this.layers.set(key, layer);
    } else {
      layer = document.createElement('canvas');
      layer.width = Math.ceil(width * density);
      layer.height = Math.ceil(height * density);
      const layerContext = layer.getContext('2d');
      if (!layerContext) return false;
      layerContext.scale(layer.width / width, layer.height / height);
      render(layerContext);
      this.layers.set(key, layer);
      while (this.layers.size > LIMIT) this.layers.delete(this.layers.keys().next().value!);
    }
    ctx.drawImage(layer, 0, 0, width, height);
    return true;
  }

  clear(): void {
    this.layers.clear();
  }
}
