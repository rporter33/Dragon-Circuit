import { describe, expect, it } from 'vitest';
import {
  compassWord,
  formatDelta,
  formatDistance,
  formatPlayTime,
  formatTime,
  kmh,
  medalFor,
  timeOfDayName,
  titleCase,
  weatherName,
} from './format';

describe('formatTime', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(59870)).toBe('0:59.87');
    expect(formatTime(101230)).toBe('1:41.23');
    expect(formatTime(605009)).toBe('10:05.00');
  });
  it('truncates (never rounds up into the next hundredth)', () => {
    expect(formatTime(1999)).toBe('0:01.99');
  });
  it('treats junk as zero', () => {
    expect(formatTime(-5)).toBe('0:00.00');
    expect(formatTime(Number.NaN)).toBe('0:00.00');
  });
});

describe('formatDelta', () => {
  it('signs ahead (negative) with a real minus and behind with a plus', () => {
    expect(formatDelta(-420)).toBe('−0.42');
    expect(formatDelta(1310)).toBe('+1.31');
    expect(formatDelta(0)).toBe('+0.00');
  });
  it('switches to m:ss for big gaps', () => {
    expect(formatDelta(-75000)).toBe('−1:15.00');
  });
});

describe('units and names', () => {
  it('converts m/s to whole km/h', () => {
    expect(kmh(10)).toBe(36);
    expect(kmh(-3)).toBe(0);
  });
  it('rounds distances to 5 m, then km', () => {
    expect(formatDistance(83)).toBe('85 m');
    expect(formatDistance(1234)).toBe('1.2 km');
  });
  it('picks the medal a time earns', () => {
    const t = { gold: 60000, silver: 70000, bronze: 80000 };
    expect(medalFor(59000, t)).toBe('gold');
    expect(medalFor(60000, t)).toBe('gold');
    expect(medalFor(65000, t)).toBe('silver');
    expect(medalFor(79000, t)).toBe('bronze');
    expect(medalFor(90000, t)).toBe('none');
  });
  it('title-cases ids', () => {
    expect(titleCase('roost-loop')).toBe('Roost Loop');
    expect(titleCase('ember')).toBe('Ember');
  });
  it('names the hour, the weather and compass directions', () => {
    expect(timeOfDayName(0.27)).toBe('Dawn');
    expect(timeOfDayName(0.5)).toBe('Midday');
    expect(timeOfDayName(0.72)).toBe('Dusk');
    expect(timeOfDayName(0.95)).toBe('Night');
    expect(weatherName('clear')).toBe('Clear skies');
    expect(compassWord(0)).toBe('north');
    expect(compassWord(Math.PI / 2)).toBe('east');
    expect(compassWord(Math.PI * 1.75)).toBe('north-west');
  });
  it('formats play time', () => {
    expect(formatPlayTime(30)).toBe('< 1 min');
    expect(formatPlayTime(12 * 60)).toBe('12 min');
    expect(formatPlayTime(3 * 3600 + 14 * 60)).toBe('3 h 14 min');
  });
});
