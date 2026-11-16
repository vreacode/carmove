// Palette calculations follow prism_ui 63450c0, lib/color.dart (vivid, default seed).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const library=import.meta.resolve('@material/material-color-utilities');
const { Hct }=await import(new URL('hct/hct.js',library));
const { TonalPalette }=await import(new URL('palettes/tonal_palette.js',library));
const { hexFromArgb }=await import(new URL('utils/string_utils.js',library));
const root=fileURLToPath(new URL('..',import.meta.url));
const seed=Hct.fromInt(0xff007aff);
const tone=(h,c,t)=>Hct.from(h,c,t).toInt();
const primaryPalette=TonalPalette.fromHueAndChroma(seed.hue,seed.chroma);
const neutral=TonalPalette.fromHueAndChroma(seed.hue,seed.chroma/8);
const variant=TonalPalette.fromHueAndChroma(seed.hue,seed.chroma/8+4);
const error=TonalPalette.fromHueAndChroma(25,84);
const success=TonalPalette.fromInt(0xff4caf50),warning=TonalPalette.fromInt(0xffff9800);
const schemes={};
for(const dark of [false,true]) {
 const primary=tone(seed.hue,seed.chroma,Math.min(dark?75:60,Math.max(dark?50:35,seed.tone+(dark?3:0))));
 const roles={primary,onPrimary:0xffffffff,
  primaryContainer:tone(seed.hue,Math.min(seed.chroma,48),dark?30:90),
  onPrimaryContainer:tone(seed.hue,Math.min(seed.chroma,48),dark?90:30),
  page:tone(seed.hue,Math.min(seed.chroma/8,3),dark?6:94),
  panel:tone(seed.hue,Math.min(seed.chroma/8,dark?3:1.5),dark?15:98),
  block:tone(seed.hue,Math.min(seed.chroma/8,3),dark?21:94),
  inset:tone(seed.hue,Math.min(seed.chroma/8,3),dark?27:90),
  onSurface:neutral.tone(dark?97:10),onSurfaceVariant:variant.tone(dark?80:30),
  outline:variant.tone(dark?60:50),outlineVariant:tone(seed.hue,Math.min(seed.chroma/8+4,4),dark?30:80),
  error:error.tone(dark?80:40),errorContainer:error.tone(dark?30:90),onErrorContainer:error.tone(dark?90:30),
  destructive:dark?0xffff4245:0xffff383c,
  success:success.tone(dark?80:40),successContainer:success.tone(dark?30:90),
  onSuccessContainer:success.tone(dark?90:30),warning:warning.tone(dark?80:40),warningContainer:warning.tone(dark?30:90),
  onWarningContainer:warning.tone(dark?90:30)};
 schemes[dark?'dark':'light']=Object.fromEntries(Object.entries(roles).map(([k,v])=>[k,hexFromArgb(v)]));
}
const rgb=hex=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)).join(' ');
const map={page:'page',panel:'panel',card:'block',divider:'outlineVariant',base:'outlineVariant',primary:'onSurface',secondary:'onSurfaceVariant',tertiary:'onSurfaceVariant',muted:'onSurfaceVariant',disabled:'outline'};
let css='/* SPDX-License-Identifier: GPL-3.0-only\n   Generated from FlClash default #007AFF, vivid style; prism_ui 63450c0.\n   Generator and upstream license: public/licenses/flclash/. */\n';
for(const [theme,roles]of Object.entries(schemes)) {
 css+=(theme==='light'?':root, .dashboard-workspace':':root[data-theme="dark"], [data-theme="dark"] .dashboard-workspace')+' {\n';
 for(const [key,hex]of Object.entries(roles)) css+=`  --fl-${key.replace(/[A-Z]/g,s=>'-'+s.toLowerCase())}: ${rgb(hex)};\n`;
 for(const[key,role]of Object.entries(map)) css+=`  --color-${key}: ${rgb(roles[role])};\n`;
 for(const n of [50,100,200,300,400,500,600,700])css+=`  --color-accent-${n}: ${rgb(n<400?roles.primaryContainer:roles.primary)};\n`;
 css+=`  --fl-modal-opacity: ${theme==='dark'?'.48':'.2'};\n  --live-video: #000000;\n  --live-video-ink: #ffffff;\n}\n`;
}
fs.mkdirSync(root+'/src/theme',{recursive:true});
fs.writeFileSync(root+'/src/theme/flclash-tokens.json',JSON.stringify({source:'FlClash be84736 / prism_ui 63450c0',seed:'#007AFF',style:'vivid',schemes},null,2)+'\n');
fs.writeFileSync(root+'/src/flclash-theme.css',css);
console.log(JSON.stringify({light:schemes.light,dark:schemes.dark}));
