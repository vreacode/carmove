# SPDX-License-Identifier: GPL-3.0-only
from pathlib import Path
import re,math,json,shutil
import argparse
parser=argparse.ArgumentParser(description='Import the pinned FlClash/prism_ui glyph definitions as SVG.')
parser.add_argument('--flclash-source',type=Path,required=True)
parser.add_argument('--prism-source',type=Path,required=True)
options=parser.parse_args()
r=Path(__file__).resolve().parents[1];a=options.flclash_source;p=options.prism_source
def defs(path):return dict(re.findall(r'static const (\w+) = (.*?);',path.read_text(),re.S))
app=defs(a/'lib/ui/icons/app_glyphs.dart');prism=defs(p/'lib/icons/glyphs.dart')
def f(v):return f'{v:.4f}'.rstrip('0').rstrip('.') or '0'
def point(v):return ' '.join(f(x) for x in v)
def number(s):return float(eval(s.strip().replace('math.pi','pi'),{'__builtins__':{}},{'pi':math.pi}))
def tokens(s):
 out=[];start=0;depth=0;quote=None
 for i,c in enumerate(s):
  if quote:
   if c==quote and (i==0 or s[i-1]!='\\'):quote=None
  elif c in "'\"":quote=c
  elif c in '([{':depth+=1
  elif c in ')]}':depth-=1
  elif c==',' and depth==0:out.append(s[start:i].strip());start=i+1
 if s[start:].strip():out.append(s[start:].strip())
 return out

def polygon(vertices,closed):
 def corner(i):
  x,y,rad=vertices[i];prev=vertices[(i-1)%len(vertices)];nxt=vertices[(i+1)%len(vertices)]
  pts=[]
  for v in [prev,nxt]:
   dx,dy=v[0]-x,v[1]-y;length=math.hypot(dx,dy);t=min(rad,length/2)/length if length else 0;pts.append((x+dx*t,y+dy*t))
  return pts
 if not vertices:return ''
 path='M '+point(corner(0)[1] if closed else vertices[0][:2])
 for i in range(1,len(vertices)+(1 if closed else 0)):
  j=i%len(vertices)
  if not closed and j==len(vertices)-1:path+=' L '+point(vertices[j][:2]);break
  en,ex=corner(j);path+=' L '+point(en)+' Q '+point(vertices[j][:2])+' '+point(ex)
 return path+(' Z' if closed else '')
def render(name,lib=app):
 expr=lib[name].strip()
 if expr.startswith('Glyphs.'):return render(expr[7:],prism)
 if re.fullmatch(r'\w+',expr):return render(expr,lib)
 shapes=[]
 for m in re.finditer(r'(GlyphBox|GlyphCircle|GlyphOval|GlyphPath|GlyphPolyline|GlyphLink|GlyphArc)\(',expr):
  start=m.end();depth=1;quote=None;end=start
  while depth:
   c=expr[end]
   if quote:
    if c==quote and expr[end-1]!='\\':quote=None
   elif c in "'\"":quote=c
   elif c=='(':depth+=1
   elif c==')':depth-=1
   end+=1
  args=expr[start:end-1];parts=tokens(args);pos=[s for s in parts if not re.match(r'\w+\s*:',s)]
  fill=' fill="currentColor" stroke="none"' if 'solid: true' in args else ''
  tag=m.group(1)
  if tag=='GlyphCircle':
   x,y,rad=map(number,pos);shapes.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(rad)}"{fill}/>')
  elif tag=='GlyphBox':
   x,y,x2,y2,rad=map(number,pos);shapes.append(f'<rect x="{f(x)}" y="{f(y)}" width="{f(x2-x)}" height="{f(y2-y)}" rx="{f(rad)}"/>')
  elif tag=='GlyphOval':
   x,y,x2,y2=map(number,pos);shapes.append(f'<ellipse cx="{f((x+x2)/2)}" cy="{f((y+y2)/2)}" rx="{f((x2-x)/2)}" ry="{f((y2-y)/2)}"/>')
  elif tag=='GlyphPath':
   data=''.join(re.findall(r"'([^']*)'",pos[0]));shapes.append(f'<path d="{data}"{fill}/>')
  elif tag=='GlyphPolyline':
   vertices=[]
   for values in re.findall(r'GlyphVertex\(([^)]+)\)',pos[0]):
    vs=list(map(number,values.split(',')));vertices.append(vs+[0]*(3-len(vs)))
   shapes.append(f'<path d="{polygon(vertices,"closed: true" in args)}"{fill}/>')
  elif tag=='GlyphArc':
   x,y,rad,start,sweep=map(number,pos);startpoint=(x+rad*math.cos(start),y+rad*math.sin(start));endpoint=(x+rad*math.cos(start+sweep),y+rad*math.sin(start+sweep))
   shapes.append(f'<path d="M {point(startpoint)} A {f(rad)} {f(rad)} 0 {int(abs(sweep)>math.pi)} {int(sweep>0)} {point(endpoint)}"/>')
  elif tag=='GlyphLink':
   v=[tuple(map(number,re.search(r'Offset\(([^)]+)\)',s).group(1).split(','))) for s in pos[:2]];rad=number(pos[2])+1.8;dx=v[1][0]-v[0][0];dy=v[1][1]-v[0][1];length=math.hypot(dx,dy);start=(v[0][0]+rad*dx/length,v[0][1]+rad*dy/length);end=(v[1][0]-rad*dx/length,v[1][1]-rad*dy/length);shapes.append(f'<path d="M {point(start)} L {point(end)}"/>')
 if not shapes:raise ValueError(name)
 return ''.join(shapes)
mapping={'ArrowDownTrayIcon':'export','ArchiveBoxIcon':'resources','ArrowLeftIcon':'arrowBack','ArrowPathIcon':'refresh','ArrowUpRightIcon':'openExternal','BoltIcon':'bolt','BookOpenIcon':'resources','CameraIcon':'camera','ChartBarIcon':'dataUsage','CheckCircleIcon':'checkCircle','ChevronDownIcon':'chevronDown','ChevronLeftIcon':'chevronBack','ChevronRightIcon':'chevronForward','ChevronUpIcon':'chevronUp','CircleStackIcon':'memory','ClockIcon':'clock','CpuChipIcon':'cpu','ExclamationTriangleIcon':'warning','LockClosedIcon':'lock','LockOpenIcon':'lockOpen','MagnifyingGlassIcon':'search','MapIcon':'proxies','MapPinIcon':'locate','PhotoIcon':'photos','RadioIcon':'wifi','ShieldCheckIcon':'verified','TrashIcon':'delete','VideoCameraIcon':'camera','WifiIcon':'wifi','WrenchScrewdriverIcon':'settings','XMarkIcon':'close','DashboardIcon':'dashboard'}
svg={};bad=[]
for export,name in mapping.items():
 try:svg[export]=render(name)
 except Exception as e:bad.append((name,str(e)))
assert not bad,bad
svg['ArrowRightIcon']='<g transform="rotate(180 12 12)">'+render('arrowBack')+'</g>'
svg['PlayIcon']=f'<path d="{polygon([[8.3,5.6,1.2],[18.8,12,1.2],[8.3,18.4,1.2]],True)}"/>'
svg['PauseIcon']='<g transform="rotate(90 12 12)">'+''.join(f'<path d="{polygon([[5.9,y,1.2],[18.1,y,1.2],[18.1,y+2.2,1.2],[5.9,y+2.2,1.2]],True)}"/>' for y in [6.9,14.9])+'</g>'
svg['PlayCircleIcon']=svg['PlayIcon'];svg['PauseCircleIcon']=svg['PauseIcon']
header='''/* SPDX-License-Identifier: GPL-3.0-only
 * SVG adapters of FlClash AppGlyphs (be84736) / prism_ui Glyphs (63450c0).
 * Rounded-polyline coordinates and 1.8px strokes follow upstream. GlyphBox's
 * Flutter superellipse is represented by SVG rounded rectangles.
 * See public/licenses/flclash/NOTICE.md and GPL-3.0.txt.
 */
import type { SVGProps } from "react";

const paths: Record<string, string> = '''
content=header+json.dumps(svg,ensure_ascii=False,indent=2)+''';
function glyph(name: string) {
  return function FlClashIcon(props: SVGProps<SVGSVGElement>) {
    return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon-source="flclash" {...props} dangerouslySetInnerHTML={{ __html: paths[name] }} />;
  };
}
'''
for name in svg:content+=f'export const {name} = glyph("{name}");\n'
content+='\n// Vehicle-specific symbols not defined by the reference icon set.\nexport { ArrowsPointingOutIcon, Battery50Icon, HandRaisedIcon, StopIcon, StopCircleIcon } from "@heroicons/react/24/outline";\n'
(r/'src/components/FlClashIcons.tsx').write_text(content)
for file in (r/'src').rglob('*.tsx'):
 if file.name=='FlClashIcons.tsx':continue
 s=file.read_text();relative='./components/FlClashIcons' if file.parent==r/'src' else './FlClashIcons'
 s=s.replace('"@heroicons/react/24/outline"','"'+relative+'"');file.write_text(s)
# The monitoring workspace uses the upstream dashboard glyph; connection summaries keep Wi-Fi.
pth=r/'src/components/SidebarMenu.tsx';s=pth.read_text().replace('RadioIcon,','DashboardIcon,').replace('icon: RadioIcon','icon: DashboardIcon');pth.write_text(s)
lic=r/'public/licenses/flclash';lic.mkdir(parents=True,exist_ok=True);shutil.copy2(a/'LICENSE',lic/'GPL-3.0.txt')
(lic/'icon-source.json').write_text(json.dumps({'flclash':'be84736605527034689c95bf27828ff27d912c5e','prism_ui':'63450c0ac0e8e1b2c0f3ed4ad7926dc94e083185','icons':mapping,'fallbacks':['fullscreen','battery','hand','stop','stop-circle']},indent=2)+'\n')
print('Generated source glyph adapters:',len(svg),'Vehicle-specific fallbacks:',5)
