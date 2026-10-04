import { describe, expect, it, vi } from 'vitest';

import { ScanFolderSourceKind } from '../../types';
import {
  FOLDER_MESSAGE,
  HANDOFF_PROTOCOL,
  READY_MESSAGE,
  isHandoffRequested,
  isOriginAllowed,
  listenForHandoff,
  parseAllowedOrigins,
  toScanFolderSource,
} from './embeddedHandoff';

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name);

describe('embedded handoff', () => {
  it('only listens when framed and asked to', () => {
    expect(isHandoffRequested('?handoff=postmessage', true)).toBe(true);
    expect(isHandoffRequested('?handoff=postmessage', false)).toBe(false);
    expect(isHandoffRequested('', true)).toBe(false);
  });

  it('reads an origin allowlist; empty allows any parent', () => {
    const allowed = parseAllowedOrigins(
      ' https://mere.example/ , http://localhost:4200',
    );
    expect(allowed).toEqual(['https://mere.example', 'http://localhost:4200']);
    expect(isOriginAllowed('https://mere.example', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('https://anything.example', [])).toBe(true);
  });

  it('turns a folder message into a scan folder source', () => {
    const source = toScanFolderSource({
      type: FOLDER_MESSAGE,
      protocol: HANDOFF_PROTOCOL,
      label: 'Dental CBCT 2026-02-12',
      entries: [
        {
          name: 'IM0001.dcm',
          relativePath: 'CBCT/IM0001.dcm',
          file: file('IM0001.dcm'),
        },
        {
          name: 'IM0002.dcm',
          relativePath: 'CBCT/IM0002.dcm',
          file: file('IM0002.dcm'),
        },
      ],
    });
    expect(source?.kind).toBe(ScanFolderSourceKind.Handoff);
    expect(source?.label).toBe('Dental CBCT 2026-02-12');
    expect(source?.entries.map((entry) => entry.relativePath)).toEqual([
      'CBCT/IM0001.dcm',
      'CBCT/IM0002.dcm',
    ]);
  });

  it('drops entries without a file or with a path that climbs out', () => {
    const source = toScanFolderSource({
      type: FOLDER_MESSAGE,
      protocol: HANDOFF_PROTOCOL,
      entries: [
        { name: 'a.dcm', relativePath: '../a.dcm', file: file('a.dcm') },
        { name: 'b.dcm', relativePath: 'b.dcm', file: 'not a file' },
        { name: 'c.dcm', relativePath: 'c.dcm', file: file('c.dcm') },
      ],
    });
    expect(source?.entries.map((entry) => entry.name)).toEqual(['c.dcm']);
  });

  it('ignores other messages', () => {
    expect(toScanFolderSource({ type: 'something-else' })).toBeNull();
    expect(
      toScanFolderSource({ type: FOLDER_MESSAGE, protocol: 2, entries: [] }),
    ).toBeNull();
  });

  it('signals ready and takes the folder only from its parent', () => {
    const parent = { postMessage: vi.fn() };
    const listeners: Array<(event: MessageEvent) => void> = [];
    const win = {
      parent,
      addEventListener: (_: string, fn: (event: MessageEvent) => void) =>
        listeners.push(fn),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const onSource = vi.fn();

    listenForHandoff(onSource, { win, allowedOrigins: [] });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: READY_MESSAGE, protocol: HANDOFF_PROTOCOL },
      '*',
    );

    const data = {
      type: FOLDER_MESSAGE,
      protocol: HANDOFF_PROTOCOL,
      entries: [{ name: 'x.dcm', relativePath: 'x.dcm', file: file('x.dcm') }],
    };
    listeners[0]({
      source: {},
      origin: 'https://a.example',
      data,
    } as MessageEvent);
    expect(onSource).not.toHaveBeenCalled();
    listeners[0]({
      source: parent,
      origin: 'https://a.example',
      data,
    } as unknown as MessageEvent);
    expect(onSource).toHaveBeenCalledTimes(1);
  });
});
