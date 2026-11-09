import React from 'react';
import {normalizeName} from '../shared/graph-plan.mjs';
export function otherNames(title,aliases=[]){const seen=new Set([normalizeName(title||'')]);return aliases.filter(name=>{if(typeof name!=='string'||!name.trim())return false;const key=normalizeName(name);if(seen.has(key))return false;seen.add(key);return true;});}
export default function Aliases({title,aliases,className=''}){const names=otherNames(title,aliases);return names.length?<span className={`alias-list ${className}`} aria-label="다른 이름">{names.map(name=><span className="alias-name" key={name}>{name}</span>)}</span>:null;}
