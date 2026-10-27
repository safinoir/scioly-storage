import { LIMITS } from './domain.js';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be opened. Try a JPEG, PNG, or WebP photo.'));
    img.src = src;
  });
}

function drawJpeg(img, maxDimension, quality) {
  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is unavailable in this browser.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', quality);
  canvas.width = canvas.height = 1;
  return data;
}

export async function compressPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose an image smaller than 30 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    for (const dimension of [800, 640, 480, 320, 160]) {
      for (const quality of [0.78, 0.65, 0.5, 0.35]) {
        const data = drawJpeg(img, dimension, quality);
        if (data.startsWith('data:image/jpeg;base64,') && data.length <= LIMITS.photo) return data;
      }
    }
    throw new Error('This photo is too large after compression. Try another photo.');
  } finally { URL.revokeObjectURL(url); }
}

export async function makeThumbnail(data) {
  const img = await loadImage(data);
  return {
    data: drawJpeg(img, 160, 0.65),
    width: 120 * Math.min(1, img.naturalWidth / img.naturalHeight),
    height: 120 * Math.min(1, img.naturalHeight / img.naturalWidth),
  };
}
