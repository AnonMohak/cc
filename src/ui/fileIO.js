/** Save a Blob as a file download. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save text as a file download. */
export function downloadText(filename, text, type = 'application/json') {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Sortable local timestamp for file names, e.g. 20261006-213015. */
export function fileStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * Ask the user for a text file. Resolves with its contents, or null if the
 * dialog is cancelled.
 */
export function pickTextFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
