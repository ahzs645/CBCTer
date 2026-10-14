import { describe, expect, it } from 'vitest';
import { blockedHostMessage, buildShareLink, readShareLink } from './shareLink';

describe('share links', () => {
  it('explains hosts that refuse cross-site reads', () => {
    for (const link of [
      'https://drive.google.com/file/d/1Gf6OoEWP070WNZfjsdhXRZMjTU3anNxb/view?usp=sharing',
      'https://drive.usercontent.google.com/download?id=x&export=download',
      'https://www.dropbox.com/s/abc/scan.cbct.zip?dl=0',
      'https://1drv.ms/u/s!abc',
    ])
      expect(blockedHostMessage(link)).toMatch(/Download the file/);
    expect(
      blockedHostMessage('https://huggingface.co/x/resolve/main/a.cbct.zip'),
    ).toBeNull();
    expect(blockedHostMessage('not a url')).toBeNull();
  });
  it('round-trips a link with a tooth and ignores unsafe URLs', () => {
    const link = buildShareLink('https://x.github.io/CBCTer/?old=1#y', {
      url: 'https://h.example/a b.cbct.zip?sig=1&x=2',
      tooth: 33,
    });
    expect(link.startsWith('https://x.github.io/CBCTer/#url=')).toBe(true);
    const parsed = new URL(link);
    expect(readShareLink(parsed)).toEqual({
      url: 'https://h.example/a b.cbct.zip?sig=1&x=2',
      tooth: 33,
    });
    expect(
      readShareLink({ hash: '', search: '?url=https://a/b.cbct.zip' }),
    ).toEqual({ url: 'https://a/b.cbct.zip' });
    expect(
      readShareLink({ hash: '#url=javascript:alert(1)', search: '' }),
    ).toBeNull();
    expect(
      readShareLink({ hash: '#url=https://a/b&tooth=99', search: '' }),
    ).toEqual({ url: 'https://a/b' });
  });
});
