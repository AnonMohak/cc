import { describe, it, expect } from 'vitest';
import { pickVideo, seekTarget, INTRO_VIDEO_FILES, PORTRAIT_VIDEO_FILES, VIDEO_DRIFT } from './introVideo.js';

describe('pickVideo', () => {
  it('takes the first file the browser can play, under the base path', () => {
    expect(pickVideo(() => 'probably', '/three/galaxy-sandbox/')).toBe(`/three/galaxy-sandbox/${INTRO_VIDEO_FILES[0][0]}`);
    const onlyMp4 = (type) => (type.startsWith('video/mp4') ? 'maybe' : '');
    expect(pickVideo(onlyMp4)).toBe(`/${INTRO_VIDEO_FILES[1][0]}`);
    expect(pickVideo(() => '')).toBeNull();
  });

  it('takes the portrait files for a portrait screen', () => {
    expect(pickVideo(() => 'probably', '/', true)).toBe(`/${PORTRAIT_VIDEO_FILES[0][0]}`);
    const onlyMp4 = (type) => (type.startsWith('video/mp4') ? 'maybe' : '');
    expect(pickVideo(onlyMp4, '/', true)).toBe(`/${PORTRAIT_VIDEO_FILES[1][0]}`);
  });
});

describe('seekTarget', () => {
  it('leaves small drift alone and jumps on large drift', () => {
    expect(seekTarget(10, 10 + VIDEO_DRIFT * 0.5, 66)).toBeNull();
    expect(seekTarget(10, 12, 66)).toBe(12);
  });

  it('stays inside the video', () => {
    expect(seekTarget(0, 80, 66)).toBeCloseTo(65.95, 9);
    expect(seekTarget(5, -1, 66)).toBe(0);
  });
});
