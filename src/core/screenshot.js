/** @param {Date} date */
export function screenshotFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `galaxy-${d}-${t}.png`;
}

/**
 * Render one frame and read the canvas in the same task. The drawing buffer
 * is still intact until the browser composites, so preserveDrawingBuffer
 * (which costs performance every frame) is not needed.
 *
 * @param {{ canvas: HTMLCanvasElement, render: () => void }} options
 */
export function captureScreenshot({ canvas, render }) {
  render();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = screenshotFilename();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
