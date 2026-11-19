interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LOAD_TIMEOUT_MS = 15_000;
const INK_SCALE = 4;

// Ink bounds match WPF SvgPresenter, which measures the drawing, not the viewport. willReadFrequently keeps
// this scratch canvas off the GPU; as the first accelerated canvas it cost the GPU process about 130 MiB.
function inkBounds(image: HTMLImageElement): Bounds | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(image.naturalWidth * INK_SCALE);
  canvas.height = Math.ceil(image.naturalHeight * INK_SCALE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let top = canvas.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  if (right <= left) {
    return undefined;
  }
  return {
    x: left / INK_SCALE,
    y: top / INK_SCALE,
    width: (right - left) / INK_SCALE,
    height: (bottom - top) / INK_SCALE,
  };
}

export class ImageSet {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly bounds = new Map<string, Bounds>();
  private loading: Promise<void> | undefined;
  private settled = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly urls: Readonly<Record<string, string>>,
    private readonly trimmed: (name: string) => boolean = () => false,
  ) {}

  get revision(): number {
    return this.settled;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  acquire(): Promise<void> {
    if (typeof Image === 'undefined') {
      return Promise.resolve();
    }
    this.loading ??= Promise.all(
      Object.entries(this.urls).map(([name, url]) => this.load(name, url)),
    ).then(() => undefined);
    return this.loading;
  }

  private load(name: string, url: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const image = new Image();
      this.images.set(name, image);
      let done = false;
      const finish = () => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        this.settled++;
        for (const listener of this.listeners) {
          listener();
        }
        resolve();
      };
      const timeout = setTimeout(() => {
        finish();
        image.src = '';
      }, LOAD_TIMEOUT_MS);
      image.onload = () => {
        try {
          if (this.trimmed(name)) {
            const bounds = inkBounds(image);
            if (bounds) {
              this.bounds.set(name, bounds);
            }
          }
        } catch {
          // Raster inspection can be unavailable; the untrimmed image stays usable.
          this.bounds.delete(name);
        } finally {
          finish();
        }
      };
      image.onerror = finish;
      // plugin.localhost is another origin: without CORS the canvas is tainted and ink bounds cannot be read.
      image.crossOrigin = 'anonymous';
      image.src = url;
    });
  }

  draw(
    ctx: CanvasRenderingContext2D,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const image = this.images.get(name);
    if (!image?.complete || !image.naturalWidth) {
      return;
    }
    const bounds = this.bounds.get(name) ?? {
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    const scale = Math.min(width / bounds.width, height / bounds.height);
    ctx.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      x + (width - bounds.width * scale) / 2,
      y + (height - bounds.height * scale) / 2,
      bounds.width * scale,
      bounds.height * scale,
    );
  }
}
