import { describe, expect, it } from 'vitest';
import { adbCandidates, parseDevices, pickDevice, powerOffArgs, validSerial } from './adb';
import { Limiter, pulseMillis } from './pulse';

const OUTPUT =
  '* daemon started successfully\r\nList of devices attached\r\nR52Y208M6XE\tdevice\r\nAAA\tunauthorized\r\nBBB\toffline\r\n\r\n';

describe('adb device choice', () => {
  it('only a ready device is picked', () => {
    const devices = parseDevices(OUTPUT);
    expect(devices).toHaveLength(3);
    expect(pickDevice(devices)).toBe('R52Y208M6XE');
    expect(pickDevice(devices, 'AAA')).toBeUndefined();
    expect(pickDevice(devices, 'R52Y208M6XE')).toBe('R52Y208M6XE');
  });

  it('arms a one-shot sleep command only for the ready tablet with lock enabled', () => {
    const devices = parseDevices(OUTPUT);
    expect(powerOffArgs(true, pickDevice(devices))).toEqual([
      '-s',
      'R52Y208M6XE',
      'shell',
      'input',
      'keyevent',
      '223',
    ]);
    expect(powerOffArgs(false, pickDevice(devices))).toBeNull();
    expect(powerOffArgs(true, pickDevice(devices, 'AAA'))).toBeNull();
  });

  it('two ready devices need a serial', () => {
    const devices = parseDevices('List of devices attached\nA\tdevice\nB\tdevice\n');
    expect(pickDevice(devices)).toBeUndefined();
    expect(pickDevice(devices, 'B')).toBe('B');
  });

  it('a serial cannot smuggle arguments', () => {
    expect(validSerial('R52Y208M6XE')).toBe(true);
    expect(validSerial('a b')).toBe(false);
    expect(validSerial('')).toBe(false);
  });

  it('looks in the override, else the SDK folders, then PATH', () => {
    expect(adbCandidates('D:\\adb.exe')).toEqual(['D:\\adb.exe']);
    expect(adbCandidates().at(-1)).toBe('adb.exe');
    expect(adbCandidates()).toHaveLength(4);
  });
});

describe('pulses', () => {
  it('a burst plays once until the pulse ends', () => {
    const limiter = new Limiter();
    expect(limiter.admit(1000, 30)).toBe(true);
    expect(limiter.admit(1010, 8)).toBe(false);
    expect(limiter.admit(1054, 8)).toBe(false);
    expect(limiter.admit(1056, 8)).toBe(true);
  });

  it('strength scales the length', () => {
    expect(pulseMillis('tick', 'light')).toBe(15);
    expect(pulseMillis('tap', 'medium')).toBe(40);
    expect(pulseMillis('confirm', 'strong')).toBe(112);
  });
});
