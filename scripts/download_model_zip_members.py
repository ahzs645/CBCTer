#!/usr/bin/env python3
"""Read selected public ZIP members via HTTP ranges, without downloading every model.
Use --root outside the repository. ZIP CRC is validated; verify publisher/checkpoint hashes separately.
"""
import io,urllib.request,time,zipfile,json
from pathlib import Path
class HTTPFile(io.RawIOBase):
 def __init__(self,url,size):self.url=url;self.size=size;self.pos=0;self.cache={};self.network=0;self.block=16*1024*1024
 def readable(self):return True
 def seekable(self):return True
 def tell(self):return self.pos
 def seek(self,offset,whence=0):
  self.pos=offset if whence==0 else self.pos+offset if whence==1 else self.size+offset
  return self.pos
 def read(self,n=-1):
  if n<0:n=self.size-self.pos
  if n==0 or self.pos>=self.size:return b''
  out=bytearray();end=min(self.size,self.pos+n)
  while self.pos<end:
   b=self.pos//self.block
   if b not in self.cache:
    lo=b*self.block;hi=min(self.size,lo+self.block)-1
    url=self.url+('?cbct_range='+str(lo)+'_'+str(int(time.time())) if 'github.com' in self.url else '?download=1&cbct_range='+str(lo))
    req=urllib.request.Request(url,headers={'Range':f'bytes={lo}-{hi}','User-Agent':'CBCTer-model-evaluation'})
    with urllib.request.urlopen(req,timeout=90) as r:
     if r.status!=206:raise RuntimeError(f'Range request rejected: {r.status}')
     data=r.read(hi-lo+2)
     if len(data)!=hi-lo+1:raise RuntimeError('Range byte count mismatch')
    if len(self.cache)>=2:self.cache.pop(next(iter(self.cache)))
    self.cache[b]=data;self.network+=len(data)
   off=self.pos-b*self.block;amount=min(end-self.pos,len(self.cache[b])-off)
   out.extend(self.cache[b][off:off+amount]);self.pos+=amount
  return bytes(out)
if __name__=='__main__':
 import argparse
 ap=argparse.ArgumentParser();ap.add_argument('--url',required=True);ap.add_argument('--bytes',required=True,type=int);ap.add_argument('--root',required=True);ap.add_argument('--select',nargs='*');a=ap.parse_args()
 h=HTTPFile(a.url,a.bytes)
 with zipfile.ZipFile(h) as z:
  names=z.namelist();Path(a.root).mkdir(parents=True,exist_ok=True)
  (Path(a.root)/'archive-members.json').write_text(json.dumps(names,indent=2))
  if not a.select:
   print('\n'.join(names));raise SystemExit()
  for name in names:
   if not any(s.lower() in name.lower() for s in a.select):continue
   if name.endswith('/'):continue
   if not name.endswith(('plans.json','dataset.json','checkpoint_best.pth','checkpoint_final.pth')):continue
   p=(Path(a.root)/name).resolve()
   if not p.is_relative_to(Path(a.root).resolve()):raise ValueError('Unsafe archive member path')
   p.parent.mkdir(parents=True,exist_ok=True)
   if p.exists() and p.stat().st_size==z.getinfo(name).file_size:continue
   if name.endswith('checkpoint_final.pth') and any('best-only'==s for s in a.select):continue
   print('extract',name,z.getinfo(name).file_size,flush=True)
   with z.open(name) as src,p.open('wb') as dst:
    while block:=src.read(16*1024*1024):dst.write(block)
 print('network bytes',h.network,flush=True)
