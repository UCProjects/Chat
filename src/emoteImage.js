const UPNG = require('upng-js');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALPHA_THRESHOLD = 128;
const MAX_COLORS = 255;
const MIN_DELAY = 20;
const TARGET_BYTES = 250000;

function isAnimatedPng(buffer) {
  if (buffer.length < 12 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let position = 8;
  while (position + 8 <= buffer.length) {
    const type = buffer.toString('ascii', position + 4, position + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
    position += 12 + buffer.readUInt32BE(position);
  }
  return false;
}

function exactPalette(frames) {
  const colors = new Map();
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 4) {
      if (frame[i + 3] < ALPHA_THRESHOLD) continue;
      const key = (frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2];
      if (!colors.has(key)) {
        if (colors.size >= MAX_COLORS) return null;
        colors.set(key, colors.size);
      }
    }
  }
  return [...colors.keys()].map((key) => [key >> 16, (key >> 8) & 255, key & 255]);
}

function quantizedPalette(frames) {
  const all = new Uint8Array(frames.reduce((total, frame) => total + frame.length, 0));
  let offset = 0;
  frames.forEach((frame) => {
    all.set(frame, offset);
    offset += frame.length;
  });
  return quantize(all, MAX_COLORS, { format: 'rgb565', oneBitAlpha: ALPHA_THRESHOLD })
    .slice(0, MAX_COLORS)
    .map(([r, g, b]) => [r, g, b]);
}

function exactIndexes(frame, palette, transparentIndex) {
  const lookup = new Map(palette.map(([r, g, b], index) => [(r << 16) | (g << 8) | b, index]));
  const indexes = new Uint8Array(frame.length / 4);
  for (let pixel = 0; pixel < indexes.length; pixel++) {
    const i = pixel * 4;
    indexes[pixel] = frame[i + 3] < ALPHA_THRESHOLD
      ? transparentIndex
      : lookup.get((frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2]);
  }
  return indexes;
}

function quantizedIndexes(frame, palette, transparentIndex) {
  const indexes = applyPalette(frame, palette, 'rgb565');
  for (let pixel = 0; pixel < indexes.length; pixel++) {
    if (frame[pixel * 4 + 3] < ALPHA_THRESHOLD) indexes[pixel] = transparentIndex;
  }
  return indexes;
}

function encodeGif(width, height, frames, delays) {
  let palette = exactPalette(frames);
  const exact = !!palette;
  if (!exact) palette = quantizedPalette(frames);
  const transparentIndex = palette.length;
  const fullPalette = [...palette, [0, 0, 0]];
  const toIndexes = exact ? exactIndexes : quantizedIndexes;
  const images = frames.map((frame) => toIndexes(frame, palette, transparentIndex));

  const clearAfter = images.map((indexes, index) => {
    const next = images[index + 1];
    if (!next) return true;
    for (let pixel = 0; pixel < indexes.length; pixel++) {
      if (next[pixel] === transparentIndex && indexes[pixel] !== transparentIndex) return true;
    }
    return false;
  });

  const encoder = GIFEncoder();
  images.forEach((indexes, index) => {
    let output = indexes;
    if (index > 0 && !clearAfter[index - 1]) {
      const previous = images[index - 1];
      output = indexes.map((value, pixel) => (value === previous[pixel] ? transparentIndex : value));
    }
    encoder.writeFrame(output, width, height, {
      palette: fullPalette,
      delay: Math.max(MIN_DELAY, delays[index]),
      transparent: true,
      transparentIndex,
      dispose: clearAfter[index] ? 2 : 1,
      repeat: 0,
    });
  });
  encoder.finish();
  return Buffer.from(encoder.bytes());
}

function apngToGif(buffer, maxBytes = TARGET_BYTES) {
  const image = UPNG.decode(buffer);
  const frames = UPNG.toRGBA8(image).map((frame) => new Uint8Array(frame));
  const delays = image.frames.map(({ delay }) => delay);
  let gif;
  for (let step = 1; step <= frames.length; step++) {
    const keptFrames = [];
    const keptDelays = [];
    frames.forEach((frame, index) => {
      if (index % step === 0) {
        keptFrames.push(frame);
        keptDelays.push(0);
      }
      keptDelays[keptDelays.length - 1] += delays[index];
    });
    gif = encodeGif(image.width, image.height, keptFrames, keptDelays);
    if (gif.length <= maxBytes || keptFrames.length <= 2) break;
  }
  return gif;
}

function prepareEmoteImage(buffer, mime) {
  if (mime === 'image/png' && isAnimatedPng(buffer)) {
    return { buffer: apngToGif(buffer), mime: 'image/gif' };
  }
  return { buffer, mime };
}

module.exports = { isAnimatedPng, apngToGif, prepareEmoteImage };
