/**
 * Prepare a phone photo for upload: downscale to ≤1600 px and re-encode as JPEG.
 * Re-encoding through a canvas also drops EXIF metadata (including GPS location).
 */
export async function preparePhoto(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  const source: CanvasImageSource & { width: number; height: number } = bitmap ?? (await loadImage(file));
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas not available');
  g.drawImage(source, 0, 0, w, h);
  bitmap?.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process the photo');
  return blob;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unsupported image'));
    };
    img.src = url;
  });
}
