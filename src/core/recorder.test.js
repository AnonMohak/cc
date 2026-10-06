import { describe, it, expect } from 'vitest';
import { pickVideoType, formatClock } from './recorder.js';
import { fileStamp } from '../ui/fileIO.js';

describe('pickVideoType', () => {
  it('prefers VP9 WebM, falls back to MP4 (Safari), or null', () => {
    expect(pickVideoType(() => true)).toBe('video/webm;codecs=vp9');
    expect(pickVideoType((t) => t === 'video/mp4')).toBe('video/mp4');
    expect(pickVideoType(() => false)).toBeNull();
  });
});

describe('formatClock', () => {
  it('formats m:ss', () => {
    expect(formatClock(7.9)).toBe('0:07');
    expect(formatClock(65)).toBe('1:05');
  });
});

describe('fileStamp', () => {
  it('is a sortable local timestamp', () => {
    expect(fileStamp(new Date(2026, 9, 6, 21, 3, 5))).toBe('20261006-210305');
  });
});
